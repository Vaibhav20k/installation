/**
 * Shared fixtures for the dispatch and complaint flow tests. Files stand in for the browser's upload queue:
 * an asset already uploaded and content-checked under a fresh draft key (the real upload path is covered in
 * evidence.test.ts). Storage, Zoho and notifications never leave the process.
 */
import type { Db } from "@/server/db/client";
import { makeCtx } from "@/server/services/context";
import { advanceDispatch, receiveDispatch } from "@/server/services/dispatch";
import { advanceComplaint } from "@/server/services/complaint";
import { dispatchDetail } from "@/server/queries/dispatch";
import { AppError } from "@/server/errors";
import { actor } from "./helpers";

export const NOW = Date.parse("2026-10-27T05:00:00Z");

/** One user per role (plus a reporting manager, an admin, an installer and an IM of another project). */
export const PEOPLE = {
  factory_dispatch: "HUB-001", accounts: "HUB-002", qc: "HUB-003", planning: "HUB-004", management: "HUB-005", store: "HUB-006",
  purchase: "HUB-007", production: "HUB-008", packaging: "HUB-009", installation_manager: "EMP-001",
  otherIm: "EMP-002", admin: "EMP-004", installer: "EMP-020", reportingManager: "HUB-005",
} as const;

export const errKind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : `thrown: ${String(e)}`; } };
export const errText = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? `${e.kind}: ${e.message} ${e.details.join(" | ")}` : String(e); } };

export function flowKit(getDb: () => Db) {
  const db = () => getDb();
  const as = async (bid: string, now = NOW) => makeCtx(db(), await actor(db(), bid), now);
  async function upload(bid: string, media: "image" | "document" = "image") {
    const [e] = await db().query<{ id: string }>("select id from employee where business_id = $1", [bid]);
    const draft = crypto.randomUUID();
    const [a] = await db().query<{ id: string }>(
      "insert into evidence_asset(uploader_id, storage_key, original_name, media_type, mime, byte_size, state) values ($1, gen_random_uuid()::text || '.bin', $2, $3, $4, 1000, 'ready') returning id",
      [e!.id, media === "image" ? "photo.jpg" : "invoice.pdf", media, media === "image" ? "image/jpeg" : "application/pdf"]);
    await db().query("insert into upload_session(actor_id, draft_key, context, asset_id, expected_mime, expected_size, idempotency_key, expires_at, completed_at) values ($1,$2,'flow.test',$3,'image/jpeg',1000,$4,now() + interval '1 hour', now())",
      [e!.id, draft, a!.id, crypto.randomUUID()]);
    return draft;
  }
  async function state(id: string) {
    const [r] = await db().query<{ stage: string; version: number; status: string; partial: boolean; hold_until: string | null }>("select stage, version, status, partial, hold_until::text from dispatch where id = $1", [id]);
    return r!;
  }
  async function cstate(id: string) {
    const [r] = await db().query<{ stage: string; version: number; status: string; outcome: string | null; superseded_by: string | null }>("select stage, version, status, outcome, superseded_by from complaint where id = $1", [id]);
    return r!;
  }
  async function step(bid: string, id: string, values: Record<string, string> = {}, files: Record<string, string> = {}) {
    const s = await state(id);
    return advanceDispatch(await as(bid), { dispatchId: id, version: s.version, stage: s.stage, values, files });
  }
  async function cstep(bid: string, id: string, values: Record<string, string> = {}) {
    const s = await cstate(id);
    return advanceComplaint(await as(bid), { complaintId: id, version: s.version, stage: s.stage, values });
  }
  async function toSite(id: string) {
    await step(PEOPLE.installation_manager, id, { status: "ready" });
    await step(PEOPLE.accounts, id, { invoice_no: "INV-1" }, { invoice_file: await upload(PEOPLE.accounts, "document") });
    await step(PEOPLE.accounts, id, { eway_no: "EWB-1" }, { eway_file: await upload(PEOPLE.accounts, "document") });
    await step(PEOPLE.factory_dispatch, id, { vehicle_no: "HR26 AB 1234", driver: "Ramesh", dispatch_date: "2026-10-27" });
  }
  async function lines(id: string) {
    return (await dispatchDetail(db(), await actor(db(), PEOPLE.installation_manager), id, NOW))!.items;
  }
  async function receive(id: string, bad: Record<string, { kind: "missing" | "damaged"; quantity: string; reason?: string; photo?: boolean }> = {}) {
    const s = await state(id);
    const ls = await lines(id);
    const out = [];
    for (const l of ls) {
      const b = bad[l.component_id];
      out.push(b ? { itemId: l.id, ok: false, kind: b.kind, quantity: b.quantity, reason: b.reason ?? "Broken in transit", photoDraftKey: b.photo === false ? undefined : await upload(PEOPLE.installation_manager) } : { itemId: l.id, ok: true });
    }
    return receiveDispatch(await as(PEOPLE.installation_manager), { dispatchId: id, version: s.version, stage: s.stage, lines: out });
  }
  /** Fixture shortcut: put a record on a stage directly (to exercise that stage's rules in isolation). */
  async function placeAt(table: "dispatch" | "complaint", id: string, stage: string) {
    await db().query(`update ${table} set stage = $2, status = 'open', version = version + 1 ${table === "dispatch" ? ", hold_reason = null, hold_until = null" : ""} where id = $1`, [id, stage]);
  }
  return { as, upload, state, cstate, step, cstep, toSite, lines, receive, placeAt };
}
