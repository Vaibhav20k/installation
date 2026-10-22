/**
 * Additional work and customer-facing installation charges. Charges, internal estimates, approved budgets and
 * actual costs stay separate; free-of-charge never means no effort, and nothing here is called profit.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { forbidSelfApproval, requireProjectScope, requireRole, type Actor } from "../auth/permissions";
import { projectFilter } from "../queries/common";
import { conflict, validation } from "../errors";
import { iso, one, parse, zId, zMinor, type Ctx } from "./context";
import { expenseSummary } from "../queries/dashboard";

async function nextId(q: Queryable, prefix: string, table: string) {
  const [r] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int), 0) + 1 n from ${table}`);
  return `${prefix}-${String(r?.n ?? 1).padStart(3, "0")}`;
}

export async function requestAdditionalWork(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, orderId: zId, visitId: zId.optional(), description: z.string().min(5).max(500),
    requestedBy: z.enum(["customer", "sales", "site_team", "design", "other"]), reason: z.string().min(3).max(300), estimatedMinutes: z.number().int().min(0).max(100_000).optional() }), input);
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    await one(q, "select 1 from sales_order where id = $1 and project_id = $2", [d.orderId, d.projectId], "Order on this project");
    if (d.visitId) await one(q, "select 1 from visit where id = $1 and project_id = $2", [d.visitId, d.projectId], "Visit on this project");
    const bid = await nextId(q, "AW", "additional_work");
    const [a] = await q.query<{ id: string }>(`insert into additional_work(business_id, project_id, order_id, visit_id, description, requested_by, reason, estimated_minutes, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [bid, d.projectId, d.orderId, d.visitId ?? null, d.description, d.requestedBy, d.reason, d.estimatedMinutes ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "request_additional_work", objectType: "additional_work", objectId: a!.id, after: d, correlationId: ctx.correlationId });
    return { id: a!.id, businessId: bid };
  });
}

export async function decideAdditionalWork(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ id: zId, decision: z.enum(["approved", "rejected"]), chargeType: z.enum(["chargeable", "free_of_charge", "waived"]).optional(),
    quotedAmountMinor: zMinor.optional(), commercialRef: z.string().max(80).optional(), plannedCostMinor: zMinor.optional(), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "manager", "approving additional work");
  if (d.decision === "approved" && !d.chargeType) throw validation("Choose whether the work is chargeable, free of charge or waived.");
  if (d.decision === "approved" && d.chargeType === "chargeable" && d.quotedAmountMinor === undefined) throw validation("Enter the quoted amount for chargeable work.");
  return ctx.db.tx(async (q) => {
    const a = await one<{ project_id: string; status: string; created_by: string | null }>(q, "select project_id, status, created_by from additional_work where id = $1 for update", [d.id], "Additional work");
    await requireProjectScope(q, ctx.actor, a.project_id);
    if (a.created_by) forbidSelfApproval(ctx.actor, a.created_by, "additional work request");
    if (a.status !== "requested") throw conflict(`This request is already ${a.status}.`);
    await q.query(`update additional_work set status = $2, charge_type = $3, quoted_amount_minor = $4, commercial_ref = $5, planned_cost_minor = $6, decided_by = $7, decided_at = $8, decision_note = $9 where id = $1`,
      [d.id, d.decision, d.decision === "approved" ? d.chargeType : null, d.quotedAmountMinor ?? null, d.commercialRef ?? null, d.plannedCostMinor ?? null, ctx.actor.id, iso(ctx.now), d.note ?? null]);
    await audit(q, { actorId: ctx.actor.id, action: `additional_work_${d.decision}`, objectType: "additional_work", objectId: d.id, after: d, correlationId: ctx.correlationId });
    return { id: d.id, decision: d.decision };
  });
}

export async function setInstallationCharge(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, orderId: zId, quotedMinor: zMinor, waivedMinor: zMinor.default(0), source: z.string().min(2).max(80), reference: z.string().max(80).optional() }), input);
  requireRole(ctx.actor, "manager", "installation charges");
  if (d.waivedMinor > d.quotedMinor) throw validation("The waiver cannot exceed the quoted charge.");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    await one(q, "select 1 from sales_order where id = $1 and project_id = $2", [d.orderId, d.projectId], "Order on this project");
    await q.query("update installation_charge set is_current = false where order_id = $1 and is_current", [d.orderId]);
    const [c] = await q.query<{ id: string }>("insert into installation_charge(project_id, order_id, quoted_minor, waived_minor, source, reference, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [d.projectId, d.orderId, d.quotedMinor, d.waivedMinor, d.source, d.reference ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "installation_charge", objectType: "sales_order", objectId: d.orderId, after: d, correlationId: ctx.correlationId });
    return { id: c!.id };
  });
}

/** Separate commercial and cost figures for one project. No combined "profit" is computed. */
export async function commercialSummary(q: Queryable, actor: Actor, projectId: string) {
  await requireProjectScope(q, actor, projectId);
  const [charges, work, [costs]] = await Promise.all([
    q.query<{ order: string; order_id: string; quoted_minor: number; waived_minor: number; source: string; reference: string | null }>(
      "select o.business_id \"order\", o.id order_id, c.quoted_minor, c.waived_minor, c.source, c.reference from installation_charge c join sales_order o on o.id = c.order_id where c.project_id = $1 and c.is_current order by o.business_id", [projectId]),
    q.query<{ id: string; business_id: string; order: string; visit: string | null; description: string; requested_by: string; reason: string; estimated_minutes: number | null; status: string;
      charge_type: string | null; quoted_amount_minor: number | null; commercial_ref: string | null; planned_cost_minor: number | null; created_by_name: string | null; created_by: string | null; decided_by_name: string | null; decision_note: string | null; created_at: number }>(
      `select a.id, a.business_id, o.business_id "order", v.business_id visit, a.description, a.requested_by, a.reason, a.estimated_minutes, a.status, a.charge_type, a.quoted_amount_minor, a.commercial_ref,
         a.planned_cost_minor, ec.name created_by_name, a.created_by, ed.name decided_by_name, a.decision_note, a.created_at
       from additional_work a join sales_order o on o.id = a.order_id left join visit v on v.id = a.visit_id left join employee ec on ec.id = a.created_by left join employee ed on ed.id = a.decided_by
       where a.project_id = $1 order by a.created_at desc`, [projectId]),
    expenseSummary(q, actor, { projectId }),
  ]);
  const quoted = charges.reduce((n, c) => n + Number(c.quoted_minor), 0), waived = charges.reduce((n, c) => n + Number(c.waived_minor), 0);
  const approvedWork = work.filter((w) => w.status === "approved");
  return { charges, work, totals: { quoted, waived, charged: quoted - waived, additionalChargeable: approvedWork.filter((w) => w.charge_type === "chargeable").reduce((n, w) => n + Number(w.quoted_amount_minor ?? 0), 0),
    freeOfCharge: approvedWork.filter((w) => w.charge_type !== "chargeable").length, estimate: costs?.estimate ?? null, budget: costs?.budget ?? null, actual: costs?.actual ?? null, budgetVarianceMinor: costs?.budgetVarianceMinor ?? null } };
}

/** Requests waiting for a manager decision, within the actor's projects; never the actor's own requests. */
export async function pendingAdditionalWork(q: Queryable, actor: Actor) {
  if (actor.role !== "manager" && actor.role !== "admin") return [];
  const f = projectFilter(actor, "p", 2);
  return q.query<{ id: string; business_id: string; project: string; project_id: string; order: string; description: string; reason: string; requested_by: string; by: string | null; estimated_minutes: number | null }>(
    `select a.id, a.business_id, p.name project, p.id project_id, o.business_id "order", a.description, a.reason, a.requested_by, e.name by, a.estimated_minutes
     from additional_work a join project p on p.id = a.project_id join sales_order o on o.id = a.order_id left join employee e on e.id = a.created_by
     where a.status = 'requested' and a.created_by is distinct from $1 and ${f.sql} order by a.created_at`, [actor.id, ...f.params]);
}
