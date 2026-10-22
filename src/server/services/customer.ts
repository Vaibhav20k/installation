/**
 * Customer coordination and design/measurement requests (phase 10). Nothing here sends a message: logs record
 * what someone reports, and acknowledgement is only what the customer confirmed. The design revision limit is a
 * setting that stays unset until approved; drafts are always recordable.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { forbidSelfApproval, requireProjectScope, requireRole, type Actor } from "../auth/permissions";
import { conflict, forbidden, validation } from "../errors";
import { zonedToUtc } from "@/lib/dates";
import { bumpVersion, getSetting, iso, one, parse, zDate, zId, zTime, zVersion, type Ctx } from "./context";

export const JOURNEY_STAGES = ["order_confirmed", "measurement", "design_final", "dispatch", "site_ready", "installation", "handover", "closed"] as const;

export async function setJourney(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, ownerId: zId.optional(), stage: z.enum(JOURNEY_STAGES), version: zVersion.optional() }), input);
  requireRole(ctx.actor, "supervisor", "customer journey");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    const [cur] = await q.query<{ id: string; version: number }>("select id, version from customer_journey where project_id = $1 for update", [d.projectId]);
    if (cur) {
      await bumpVersion(q, "customer_journey", cur.id, d.version ?? cur.version);
      await q.query("update customer_journey set owner_id = coalesce($2, owner_id), stage = $3, updated_at = now(), updated_by = $4 where id = $1", [cur.id, d.ownerId ?? null, d.stage, ctx.actor.id]);
    } else {
      await q.query("insert into customer_journey(project_id, owner_id, stage, updated_by) values ($1,$2,$3,$4)", [d.projectId, d.ownerId ?? null, d.stage, ctx.actor.id]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "set_journey", objectType: "project", objectId: d.projectId, after: d, correlationId: ctx.correlationId });
    return { stage: d.stage };
  });
}

export async function addObligation(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, stage: z.enum(JOURNEY_STAGES), description: z.string().min(3).max(300), ownerId: zId.optional(), dueDate: zDate.optional() }), input);
  requireRole(ctx.actor, "supervisor", "journey checklist");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    const [o] = await q.query<{ id: string }>("insert into journey_obligation(project_id, stage, description, owner_id, due_date, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
      [d.projectId, d.stage, d.description, d.ownerId ?? null, d.dueDate ?? null, ctx.actor.id]);
    return { id: o!.id };
  });
}

export async function completeObligation(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ id: zId, status: z.enum(["done", "not_applicable", "open"]) }), input);
  return ctx.db.tx(async (q) => {
    const o = await one<{ project_id: string; owner_id: string | null }>(q, "select project_id, owner_id from journey_obligation where id = $1 for update", [d.id], "Checklist item");
    await requireProjectScope(q, ctx.actor, o.project_id);
    // Crew may tick only items assigned to them; supervisors and above manage the checklist.
    if (ctx.actor.role === "employee" && o.owner_id !== ctx.actor.id) throw forbidden("Only the item's owner or a supervisor can change it.");
    await q.query("update journey_obligation set status = $2, done_at = case when $2 = 'open' then null else $3::timestamptz end, done_by = case when $2 = 'open' then null else $4::uuid end where id = $1", [d.id, d.status, iso(ctx.now), ctx.actor.id]);
    return { id: d.id };
  });
}

/** Record a communication that happened. Workers on the job may log site conversations. */
export async function logCommunication(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, channel: z.enum(["call", "visit", "whatsapp", "email", "in_person", "other"]), direction: z.enum(["to_customer", "from_customer", "internal"]),
    summary: z.string().min(3).max(1000), commitment: z.string().max(300).optional(), nextAction: z.string().max(300).optional(), dueDate: zDate.optional(),
    acknowledgement: z.enum(["not_requested", "awaiting", "acknowledged_by_customer"]).default("not_requested"), date: zDate, time: zTime, timezone: z.string().default("Asia/Kolkata") }), input);
  const at = zonedToUtc(d.date, d.time, d.timezone);
  if (at > ctx.now + 60_000) throw validation("A communication log records something that already happened.");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    const [c] = await q.query<{ id: string }>(`insert into communication_log(project_id, channel, direction, summary, commitment, next_action, due_date, acknowledgement, occurred_at, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [d.projectId, d.channel, d.direction, d.summary, d.commitment ?? null, d.nextAction ?? null, d.dueDate ?? null, d.acknowledgement, iso(at), ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "log_communication", objectType: "communication_log", objectId: c!.id, after: { channel: d.channel, direction: d.direction }, correlationId: ctx.correlationId });
    return { id: c!.id };
  });
}

async function nextDesignId(q: Queryable) {
  const [r] = await q.query<{ n: number }>("select coalesce(max(substring(business_id from '\\d+$')::int), 0) + 1 n from design_request");
  return `DR-${String(r?.n ?? 1).padStart(3, "0")}`;
}

export async function createDesignRequest(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, orderItemId: zId.optional(), kind: z.enum(["design", "measurement"]), origin: z.enum(["customer", "sales", "site_team", "designer"]),
    brief: z.string().min(5).max(2000), applianceBrief: z.string().max(1000).optional(), requestedSkills: z.string().max(200).optional(), reason: z.string().min(3).max(500), submit: z.boolean().default(false) }), input);
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    if (d.orderItemId) await one(q, "select 1 from order_item oi join sales_order o on o.id = oi.order_id where oi.id = $1 and o.project_id = $2", [d.orderItemId, d.projectId], "Order item on this project");
    const bid = await nextDesignId(q);
    const [r] = await q.query<{ id: string }>(`insert into design_request(business_id, project_id, order_item_id, kind, origin, brief, appliance_brief, requested_skills, reason, status, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`, [bid, d.projectId, d.orderItemId ?? null, d.kind, d.origin, d.brief, d.applianceBrief ?? null, d.requestedSkills ?? null, d.reason, d.submit ? "submitted" : "draft", ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "design_request", objectType: "design_request", objectId: r!.id, after: { kind: d.kind, origin: d.origin }, correlationId: ctx.correlationId });
    return { id: r!.id, businessId: bid };
  });
}

/**
 * Add a revision. If an approved revision limit is configured (app setting design_revision_limit), revisions past it
 * are marked for escalation; with no limit set nothing is blocked and the UI says the rule is not configured.
 */
export async function addDesignRevision(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ requestId: zId, cause: z.enum(["customer_change", "sales_change", "designer_correction", "site_measurement"]), reason: z.string().min(3).max(500) }), input);
  return ctx.db.tx(async (q) => {
    const r = await one<{ project_id: string; status: string }>(q, "select project_id, status from design_request where id = $1 for update", [d.requestId], "Design request");
    await requireProjectScope(q, ctx.actor, r.project_id);
    if (r.status === "rejected") throw conflict("This request was rejected; start a new one.");
    const [{ n }] = (await q.query<{ n: number }>("select count(*)::int n from design_revision where request_id = $1", [d.requestId])) as [{ n: number }];
    const limit = await getSetting<number | null>(q, "design_revision_limit", null);
    const seq = n + 1;
    const needsEscalation = limit !== null && seq > limit;
    const [v] = await q.query<{ id: string }>("insert into design_revision(request_id, seq, cause, reason, needs_escalation, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
      [d.requestId, seq, d.cause, d.reason, needsEscalation, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "design_revision", objectType: "design_request", objectId: d.requestId, after: { seq, cause: d.cause, needsEscalation }, correlationId: ctx.correlationId });
    return { id: v!.id, seq, needsEscalation, limitConfigured: limit !== null };
  });
}

export async function decideDesignRequest(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ requestId: zId, decision: z.enum(["approved", "rejected"]), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "manager", "design approval");
  return ctx.db.tx(async (q) => {
    const r = await one<{ project_id: string; status: string; created_by: string | null }>(q, "select project_id, status, created_by from design_request where id = $1 for update", [d.requestId], "Design request");
    await requireProjectScope(q, ctx.actor, r.project_id);
    if (r.created_by) forbidSelfApproval(ctx.actor, r.created_by, "design request");
    if (!["draft", "submitted"].includes(r.status)) throw conflict(`This request is already ${r.status}.`);
    await q.query("update design_request set status = $2, decided_by = $3, decided_at = $4, decision_note = $5 where id = $1", [d.requestId, d.decision, ctx.actor.id, iso(ctx.now), d.note ?? null]);
    await q.query("update design_revision set approved_by = $2, approved_at = $3 where request_id = $1 and approved_by is null and $4 = 'approved'", [d.requestId, ctx.actor.id, iso(ctx.now), d.decision]);
    await audit(q, { actorId: ctx.actor.id, action: `design_${d.decision}`, objectType: "design_request", objectId: d.requestId, after: d, correlationId: ctx.correlationId });
    return { id: d.requestId, decision: d.decision };
  });
}

export async function customerDetail(q: Queryable, actor: Actor, projectId: string) {
  await requireProjectScope(q, actor, projectId);
  const [[journey], obligations, logs, designs, revisions, limit, staff] = await Promise.all([
    q.query<{ stage: string; owner: string | null; owner_id: string | null; version: number; updated_at: number }>("select j.stage, e.name owner, j.owner_id, j.version, j.updated_at from customer_journey j left join employee e on e.id = j.owner_id where j.project_id = $1", [projectId]),
    q.query<{ id: string; stage: string; description: string; owner: string | null; due_date: string | null; status: string }>(
      "select o.id, o.stage, o.description, e.name owner, o.due_date::text, o.status from journey_obligation o left join employee e on e.id = o.owner_id where o.project_id = $1 order by o.due_date nulls last, o.created_at", [projectId]),
    q.query<{ id: string; channel: string; direction: string; summary: string; commitment: string | null; next_action: string | null; due_date: string | null; acknowledgement: string; occurred_at: number; by: string | null }>(
      "select c.id, c.channel, c.direction, c.summary, c.commitment, c.next_action, c.due_date::text, c.acknowledgement, c.occurred_at, e.name by from communication_log c left join employee e on e.id = c.created_by where c.project_id = $1 order by c.occurred_at desc limit 50", [projectId]),
    q.query<{ id: string; business_id: string; kind: string; origin: string; brief: string; appliance_brief: string | null; requested_skills: string | null; reason: string; status: string; item: string | null; by: string | null; created_by: string | null; created_at: number }>(
      `select d.id, d.business_id, d.kind, d.origin, d.brief, d.appliance_brief, d.requested_skills, d.reason, d.status, oi.name item, e.name by, d.created_by, d.created_at
       from design_request d left join order_item oi on oi.id = d.order_item_id left join employee e on e.id = d.created_by where d.project_id = $1 order by d.created_at desc`, [projectId]),
    q.query<{ id: string; request_id: string; seq: number; cause: string; reason: string; needs_escalation: boolean; approved_at: number | null }>(
      "select v.id, v.request_id, v.seq, v.cause, v.reason, v.needs_escalation, v.approved_at from design_revision v join design_request d on d.id = v.request_id where d.project_id = $1 order by v.seq", [projectId]),
    getSetting<number | null>(q, "design_revision_limit", null),
    q.query<{ id: string; name: string }>("select id, name from employee where active and permission_role <> 'employee' order by name"),
  ]);
  return { journey: journey ?? null, obligations, logs, designs: designs.map((d) => ({ ...d, revisions: revisions.filter((r) => r.request_id === d.id) })), revisionLimit: limit, staff };
}
