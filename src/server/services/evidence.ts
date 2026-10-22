/**
 * Optional image/video evidence for worker input (spec V3 §11). Upload is authorized before bytes move,
 * content is sniffed on completion, and links follow the exact parent record: permission is re-checked when
 * issuing the upload, when linking and on every download. Evidence never changes quantities, time or approvals.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { requireEmployeeScope, requireProjectScope, type Actor } from "../auth/permissions";
import { conflict, forbidden, notFound, validation } from "../errors";
import { evidenceStorage, signUpload, sniff } from "@/integrations/storage";
import { canSeeLeave } from "./attendance";
import { iso, one, parse, zId, type Ctx } from "./context";

/** Engineering limits (not business policy): see docs/example-policy-audit.md. */
export const EVIDENCE_LIMITS = { imageBytes: 15 * 1024 * 1024, videoBytes: 200 * 1024 * 1024, filesPerForm: 10 } as const;
export const PARENT_TYPES = ["progress_event", "visit_task", "attendance_event", "shift_instance", "attendance_correction", "time_entry", "ot_request", "expense",
  "leave_request", "delay_event", "readiness_check", "schedule_day", "quality_case", "issue", "acceptance", "additional_work", "package_exception", "design_request",
  "communication_log", "employee_skill", "site_restriction", "appliance_dependency"] as const;
export type ParentType = (typeof PARENT_TYPES)[number];

/** Where each parent type's project lives, for project-scoped records. */
const PROJECT_OF: Partial<Record<ParentType, string>> = {
  progress_event: "select v.project_id from progress_event e join visit_task vt on vt.id = e.visit_task_id join visit v on v.id = vt.visit_id where e.id = $1",
  visit_task: "select v.project_id from visit_task vt join visit v on v.id = vt.visit_id where vt.id = $1",
  delay_event: "select v.project_id from delay_event d join visit v on v.id = d.visit_id where d.id = $1",
  readiness_check: "select v.project_id from readiness_check r join visit v on v.id = r.visit_id where r.id = $1",
  schedule_day: "select v.project_id from visit_schedule_day s join visit v on v.id = s.visit_id where s.id = $1",
  quality_case: "select project_id from quality_case where id = $1",
  issue: "select project_id from issue where id = $1",
  acceptance: "select v.project_id from acceptance a join visit v on v.id = a.visit_id where a.id = $1",
  additional_work: "select project_id from additional_work where id = $1",
  package_exception: "select project_id from package_exception where id = $1",
  design_request: "select project_id from design_request where id = $1",
  communication_log: "select project_id from communication_log where id = $1",
  site_restriction: "select project_id from site_restriction where id = $1",
  appliance_dependency: "select project_id from appliance_dependency where id = $1",
};
/** Where each parent type's owning employee lives, for personal records. */
const OWNER_OF: Partial<Record<ParentType, string>> = {
  shift_instance: "select employee_id from shift_instance where id = $1",
  attendance_event: "select s.employee_id from attendance_event a join shift_instance s on s.id = a.shift_id where a.id = $1",
  attendance_correction: "select employee_id from attendance_correction where id = $1",
  time_entry: "select employee_id from time_entry where id = $1",
  ot_request: "select employee_id from ot_request where id = $1",
  expense: "select claimant_id employee_id from expense where id = $1",
  leave_request: "select employee_id from leave_request where id = $1",
  employee_skill: "select employee_id from employee_skill where id = $1",
};

/** Throws unless the actor may attach to (mode "link") or view (mode "read") evidence on this exact record. */
export async function authorizeParent(q: Queryable, actor: Actor, type: ParentType, id: string, mode: "link" | "read") {
  if (type === "leave_request") {
    const [r] = await q.query<{ employee_id: string }>(OWNER_OF.leave_request!, [id]);
    if (!r) throw notFound("Leave request");
    const ok = mode === "link" ? r.employee_id === actor.id : await canSeeLeave(q, actor.id, actor.role, r.employee_id);
    if (!ok) throw forbidden("Leave evidence is visible only to the requester, their manager chain and administrators.");
    return;
  }
  const ownerSql = OWNER_OF[type];
  if (ownerSql) {
    const [r] = await q.query<{ employee_id: string }>(ownerSql, [id]);
    if (!r) throw notFound("Record");
    if (r.employee_id === actor.id) return;
    if (actor.role === "employee") throw forbidden("You can add evidence only to your own records.");
    await requireEmployeeScope(q, actor, r.employee_id);
    return;
  }
  const projectSql = PROJECT_OF[type];
  if (!projectSql) throw validation("Unsupported evidence parent.");
  const [p] = await q.query<{ project_id: string }>(projectSql, [id]);
  if (!p) throw notFound("Record");
  await requireProjectScope(q, actor, p.project_id);
}

const zContext = z.string().regex(/^[a-z_]+(\.[a-z0-9_]+)?$/).max(60);
const zDraft = z.string().uuid();

export async function createEvidenceUpload(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ draftKey: zDraft, context: zContext, fileName: z.string().min(1).max(200), mime: z.string().max(100), size: z.number().int().positive(),
    idempotencyKey: z.string().min(8).max(80), capturedAt: z.number().int().optional() }), input);
  const storage = evidenceStorage();
  if (storage.kind === "unconfigured") throw conflict("Photo and video storage is not configured on this server. Your entry still saves without attachments.");
  const mediaType = d.mime.startsWith("image/") ? "image" : d.mime.startsWith("video/") ? "video" : null;
  if (!mediaType) throw validation("Only photos and videos can be attached here.", [`${d.fileName}: unsupported type ${d.mime || "unknown"}`]);
  const limit = mediaType === "image" ? EVIDENCE_LIMITS.imageBytes : EVIDENCE_LIMITS.videoBytes;
  if (d.size > limit) throw validation(`${d.fileName} is larger than the ${Math.round(limit / 1048576)} MB limit for ${mediaType}s.`);
  return ctx.db.tx(async (q) => {
    const [dup] = await q.query<{ id: string; asset_id: string; expires_at: number }>("select id, asset_id, expires_at from upload_session where actor_id = $1 and idempotency_key = $2", [ctx.actor.id, d.idempotencyKey]);
    if (dup) return { sessionId: dup.id, assetId: dup.asset_id, uploadUrl: `/api/evidence/upload/${dup.id}?e=${Number(dup.expires_at)}&t=${signUpload(dup.id, Number(dup.expires_at))}` };
    const [count] = await q.query<{ n: number }>("select count(*)::int n from upload_session where actor_id = $1 and draft_key = $2", [ctx.actor.id, d.draftKey]);
    if ((count?.n ?? 0) >= EVIDENCE_LIMITS.filesPerForm) throw validation(`Up to ${EVIDENCE_LIMITS.filesPerForm} files per entry.`);
    const [a] = await q.query<{ id: string }>("insert into evidence_asset(uploader_id, storage_key, original_name, media_type, mime, byte_size, captured_at) values ($1, gen_random_uuid()::text, $2, $3, $4, $5, $6) returning id",
      [ctx.actor.id, d.fileName, mediaType, d.mime, d.size, d.capturedAt ? iso(d.capturedAt) : null]);
    const expires = ctx.now + 15 * 60_000;
    const [s] = await q.query<{ id: string }>("insert into upload_session(actor_id, draft_key, context, asset_id, expected_mime, expected_size, idempotency_key, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [ctx.actor.id, d.draftKey, d.context, a!.id, d.mime, d.size, d.idempotencyKey, iso(expires)]);
    return { sessionId: s!.id, assetId: a!.id, uploadUrl: `/api/evidence/upload/${s!.id}?e=${expires}&t=${signUpload(s!.id, expires)}` };
  });
}

/** Called by the upload route after the token check: streams bytes to storage under a server-chosen key. */
export async function receiveUpload(q: Queryable, actorId: string, sessionId: string, body: ReadableStream<Uint8Array>, now: number) {
  const s = await one<{ id: string; actor_id: string; asset_id: string; expected_size: number; expires_at: number; completed_at: number | null }>(q,
    "select id, actor_id, asset_id, expected_size, expires_at, completed_at from upload_session where id = $1", [sessionId], "Upload session");
  if (s.actor_id !== actorId) throw forbidden("This upload belongs to someone else.");
  if (Number(s.expires_at) < now) throw conflict("This upload link has expired. Retry the file.");
  if (s.completed_at) return { bytes: Number(s.expected_size) };
  const a = await one<{ storage_key: string; media_type: string; state: string }>(q, "select storage_key, media_type, state from evidence_asset where id = $1", [s.asset_id], "Asset");
  const key = `${s.asset_id}.bin`;
  const storage = evidenceStorage();
  if (a.state === "uploading" && a.storage_key !== key) await q.query("update evidence_asset set storage_key = $2 where id = $1", [s.asset_id, key]);
  await storage.remove(key);
  const limit = a.media_type === "image" ? EVIDENCE_LIMITS.imageBytes : EVIDENCE_LIMITS.videoBytes;
  const bytes = await storage.write(key, body, limit);
  await q.query("update evidence_asset set state = 'validating', byte_size = $2, received_at = $3 where id = $1", [s.asset_id, bytes, iso(now)]);
  return { bytes };
}

export async function completeEvidenceUpload(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ sessionId: zId }), input);
  const s = await one<{ actor_id: string; asset_id: string; expected_mime: string }>(ctx.db, "select actor_id, asset_id, expected_mime from upload_session where id = $1", [d.sessionId], "Upload session");
  if (s.actor_id !== ctx.actor.id) throw forbidden();
  const a = await one<{ id: string; storage_key: string; state: string; media_type: string; byte_size: number }>(ctx.db, "select id, storage_key, state, media_type, byte_size from evidence_asset where id = $1", [s.asset_id], "Asset");
  if (a.state === "ready") return { assetId: a.id, state: "ready" };
  if (a.state === "uploading") throw conflict("The file has not finished uploading yet.");
  const storage = evidenceStorage();
  const head = await storage.head(a.storage_key, 64);
  const found = sniff(head);
  const fail = async (why: string) => {
    await ctx.db.query("update evidence_asset set state = 'failed', failure = $2 where id = $1", [a.id, why]);
    await storage.remove(a.storage_key);
    throw validation(why);
  };
  if (!found) return fail("This file is not a supported photo or video (JPEG, PNG, WebP, HEIC, MP4, MOV, WebM).");
  if (found.mediaType !== a.media_type) return fail(`The file contents are a ${found.mediaType}, not a ${a.media_type}.`);
  const hash = createHash("sha256");
  await new Promise<void>((res, rej) => storage.stream(a.storage_key).on("data", (c) => hash.update(c)).on("end", () => res()).on("error", rej));
  await ctx.db.query("update evidence_asset set state = 'ready', mime = $2, sha256 = $3 where id = $1", [a.id, found.mime, hash.digest("hex")]);
  await ctx.db.query("update upload_session set completed_at = $2 where id = $1", [d.sessionId, iso(ctx.now)]);
  return { assetId: a.id, state: "ready" };
}

/** Link every ready asset uploaded under this form's draft key to the saved record. Idempotent. */
export async function linkEvidence(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ draftKey: zDraft, parentType: z.enum(PARENT_TYPES), parentId: zId, parentRevision: z.number().int().positive().optional(),
    captions: z.record(z.string().uuid(), z.string().max(200)).optional() }), input);
  return ctx.db.tx(async (q) => {
    await authorizeParent(q, ctx.actor, d.parentType, d.parentId, "link");
    const ready = await q.query<{ asset_id: string; context: string }>(
      `select s.asset_id, s.context from upload_session s join evidence_asset a on a.id = s.asset_id where s.actor_id = $1 and s.draft_key = $2 and a.state = 'ready'`, [ctx.actor.id, d.draftKey]);
    let linked = 0;
    for (const r of ready) {
      const res = await q.query(`insert into evidence_link(asset_id, parent_type, parent_id, parent_revision, context, caption, actor_id) values ($1,$2,$3,$4,$5,$6,$7) on conflict (asset_id, parent_type, parent_id) do nothing returning id`,
        [r.asset_id, d.parentType, d.parentId, d.parentRevision ?? null, r.context, d.captions?.[r.asset_id] ?? null, ctx.actor.id]);
      linked += res.length;
    }
    if (linked) await audit(q, { actorId: ctx.actor.id, action: "link_evidence", objectType: d.parentType, objectId: d.parentId, after: { linked }, correlationId: ctx.correlationId });
    const [pending] = await q.query<{ n: number }>(`select count(*)::int n from upload_session s join evidence_asset a on a.id = s.asset_id where s.actor_id = $1 and s.draft_key = $2 and a.state in ('uploading','validating')`, [ctx.actor.id, d.draftKey]);
    return { linked, pending: pending?.n ?? 0 };
  });
}

/** A worker may remove their own attachment only while it is not yet linked to a saved record. */
export async function removeDraftEvidence(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ assetId: zId }), input);
  return ctx.db.tx(async (q) => {
    const a = await one<{ uploader_id: string; storage_key: string }>(q, "select uploader_id, storage_key from evidence_asset where id = $1 for update", [d.assetId], "Attachment");
    if (a.uploader_id !== ctx.actor.id) throw forbidden();
    const [linked] = await q.query("select 1 from evidence_link where asset_id = $1 and status = 'active'", [d.assetId]);
    if (linked) throw conflict("This attachment is part of a saved record. Add a correction instead; history keeps the original.");
    await q.query("update evidence_asset set state = 'failed', failure = 'removed before saving' where id = $1", [d.assetId]);
    await evidenceStorage().remove(a.storage_key);
    return { removed: true };
  });
}

export interface EvidenceItem { id: string; mediaType: "image" | "video"; mime: string; name: string; caption: string | null; at: number; by: string }

/** Evidence on one record, for reviewers and the author. Authorization is checked first. */
export async function evidenceFor(q: Queryable, actor: Actor, type: ParentType, id: string): Promise<EvidenceItem[]> {
  await authorizeParent(q, actor, type, id, "read");
  return q.query<EvidenceItem>(
    `select a.id, a.media_type "mediaType", a.mime, a.original_name name, l.caption, l.created_at at, e.name by
     from evidence_link l join evidence_asset a on a.id = l.asset_id join employee e on e.id = l.actor_id
     where l.parent_type = $1 and l.parent_id = $2 and l.status = 'active' and a.state = 'ready' order by l.created_at`, [type, id]);
}

/** Download check: the uploader, or anyone who may read a record the asset is linked to. */
export async function authorizeAssetRead(q: Queryable, actor: Actor, assetId: string) {
  const a = await one<{ uploader_id: string; storage_key: string; mime: string; state: string; original_name: string }>(q,
    "select uploader_id, storage_key, mime, state, original_name from evidence_asset where id = $1", [assetId], "Attachment");
  if (a.state !== "ready") throw notFound("Attachment");
  if (a.uploader_id === actor.id) return a;
  const links = await q.query<{ parent_type: ParentType; parent_id: string }>("select parent_type, parent_id from evidence_link where asset_id = $1 and status = 'active'", [assetId]);
  for (const l of links) {
    try { await authorizeParent(q, actor, l.parent_type, l.parent_id, "read"); return a; } catch { /* try the next link */ }
  }
  throw forbidden("You cannot open this attachment.");
}
