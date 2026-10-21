/**
 * Estimates, approved budgets, actual expenses, credits and allocations (phase 9).
 * Money is integer minor units; allocations always sum exactly to the source amount.
 */
import { z } from "zod";
import { audit } from "../audit";
import { forbidSelfApproval, requireCapability, requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { allocateMinor, EXPENSE_CATEGORIES, lineAmountMinor, sumMinor } from "@/domain/expenses";
import { idempotent, iso, one, parse, zDate, zId, zMinor, type Ctx } from "./context";

const zLine = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  basis: z.enum(["per_person_day", "per_person_night", "per_team_night", "per_trip", "per_unit", "per_room_night", "fixed"]),
  factors: z.record(z.string().regex(/^[a-z_]+$/), z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,6})?$/)])),
  unitRateMinor: zMinor,
  scope: z.string().max(200).optional(),
});

export async function createEstimate(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, visitId: zId.optional(), currency: z.string().length(3).default("INR"), source: z.string().max(40).default("internal"), lines: z.array(zLine).min(1).max(40) }), input);
  requireRole(ctx.actor, "supervisor", "estimating expenses");
  await requireProjectScope(ctx.db, ctx.actor, d.projectId);
  return ctx.db.tx(async (q) => {
    const bid = `EST-${d.visitId ? (await one<{ business_id: string }>(q, "select business_id from visit where id = $1 and project_id = $2", [d.visitId, d.projectId], "Visit")).business_id : "PRJ"}`;
    const key = `${bid}:${d.projectId.slice(0, 8)}`;
    const [v] = await q.query<{ n: number }>("select coalesce(max(version),0)+1 n from estimate where business_id = $1", [key]);
    const [e] = await q.query<{ id: string }>("insert into estimate(business_id, project_id, visit_id, source, version, currency) values ($1,$2,$3,$4,$5,$6) returning id", [key, d.projectId, d.visitId ?? null, d.source, v!.n, d.currency]);
    const amounts: number[] = [];
    for (const l of d.lines) {
      const a = lineAmountMinor(l);
      amounts.push(a.amountMinor);
      await q.query("insert into estimate_line(estimate_id, category, basis, factors, unit_rate_minor, amount_minor, scope) values ($1,$2,$3,$4,$5,$6,$7)",
        [e!.id, l.category, l.basis, JSON.stringify(l.factors), l.unitRateMinor, a.amountMinor, l.scope ?? null]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "create_estimate", objectType: "estimate", objectId: e!.id, after: d, correlationId: ctx.correlationId });
    return { id: e!.id, version: v!.n, totalMinor: sumMinor(amounts) };
  });
}

export async function approveBudget(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, approvedTotalMinor: zMinor, currency: z.string().length(3).default("INR") }), input);
  // Finance verification is a cross-project capability, so it is not limited to the approver's managed projects.
  requireCapability(ctx.actor, "finance_verify", "Budget approval");
  return ctx.db.tx(async (q) => {
    await q.query("update budget set is_current = false where project_id = $1 and is_current", [d.projectId]);
    const [b] = await q.query<{ id: string }>("insert into budget(project_id, approved_total_minor, currency, approved_by) values ($1,$2,$3,$4) returning id", [d.projectId, d.approvedTotalMinor, d.currency, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "approve_budget", objectType: "budget", objectId: b!.id, after: d, correlationId: ctx.correlationId });
    return { id: b!.id };
  });
}

export async function submitExpense(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    projectId: zId, visitId: zId.optional(), category: z.enum(EXPENSE_CATEGORIES), vendor: z.string().max(120).optional(), loadRef: z.string().max(60).optional(),
    amountMinor: z.number().int().positive(), currency: z.string().length(3).default("INR"), incurredOn: zDate, receiptRef: z.string().max(120).optional(),
    estimateLineId: zId.optional(), idempotencyKey: z.string().min(8).max(80).optional(),
  }), input);
  await requireProjectScope(ctx.db, ctx.actor, d.projectId);
  return ctx.db.tx((q) => idempotent(q, ctx.actor.id, d.idempotencyKey, "submitExpense", async () => {
    if (d.visitId) await one(q, "select 1 from visit where id = $1 and project_id = $2", [d.visitId, d.projectId], "Visit in this project");
    if (d.estimateLineId) await one(q, "select 1 from estimate_line l join estimate e on e.id = l.estimate_id where l.id = $1 and e.project_id = $2", [d.estimateLineId, d.projectId], "Estimate line in this project");
    const [n] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from expense`);
    const bid = `EXP-${String(n!.n).padStart(4, "0")}`;
    const [e] = await q.query<{ id: string }>(
      `insert into expense(business_id, claimant_id, project_id, visit_id, category, vendor, load_ref, amount_minor, currency, incurred_on, receipt_ref, estimate_line_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [bid, ctx.actor.id, d.projectId, d.visitId ?? null, d.category, d.vendor ?? null, d.loadRef ?? null, d.amountMinor, d.currency, d.incurredOn, d.receiptRef ?? null, d.estimateLineId ?? null]);
    await q.query("insert into expense_allocation(expense_id, project_id, visit_id, amount_minor) values ($1,$2,$3,$4)", [e!.id, d.projectId, d.visitId ?? null, d.amountMinor]);
    await audit(q, { actorId: ctx.actor.id, action: "submit_expense", objectType: "expense", objectId: e!.id, after: { ...d, idempotencyKey: undefined }, correlationId: ctx.correlationId });
    return { id: e!.id, businessId: bid };
  }));
}

/** Refunds are linked credit records, never unexplained negative claims. */
export async function recordExpenseCredit(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ expenseId: zId, amountMinor: z.number().int().positive(), reason: z.string().min(3).max(300) }), input);
  requireRole(ctx.actor, "supervisor", "recording expense credits");
  return ctx.db.tx(async (q) => {
    // The original is locked so concurrent credits cannot together exceed it.
    const e = await one<{ project_id: string; visit_id: string | null; amount_minor: number; currency: string; category: string; is_credit: boolean; state: string }>(q,
      "select project_id, visit_id, amount_minor, currency, category, is_credit, state from expense where id = $1 for update", [d.expenseId], "Expense");
    await requireProjectScope(q, ctx.actor, e.project_id);
    if (e.is_credit) throw validation("A credit cannot be credited again.");
    if (e.state !== "approved") throw conflict("Only an approved expense can be credited; reject or correct a pending claim instead.");
    const [c] = await q.query<{ s: number }>("select coalesce(sum(amount_minor),0)::bigint s from expense where reverses_expense_id = $1 and state <> 'rejected'", [d.expenseId]);
    if (c!.s + d.amountMinor > e.amount_minor) throw validation("Credits cannot exceed the original expense.");
    const [n] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from expense`);
    const [r] = await q.query<{ id: string }>(
      `insert into expense(business_id, claimant_id, project_id, visit_id, category, amount_minor, currency, incurred_on, reverses_expense_id, is_credit, review_note)
       values ($1,$2,$3,$4,$5,$6,$7,current_date,$8,true,$9) returning id`,
      [`EXP-${String(n!.n).padStart(4, "0")}`, ctx.actor.id, e.project_id, e.visit_id, e.category, d.amountMinor, e.currency, d.expenseId, d.reason]);
    await q.query("insert into expense_allocation(expense_id, project_id, visit_id, amount_minor) values ($1,$2,$3,$4)", [r!.id, e.project_id, e.visit_id, d.amountMinor]);
    await audit(q, { actorId: ctx.actor.id, action: "expense_credit", objectType: "expense", objectId: r!.id, after: d, reason: d.reason, correlationId: ctx.correlationId });
    return { id: r!.id };
  });
}

export async function approveExpense(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ expenseId: zId, decision: z.enum(["approved", "rejected"]), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "manager", "expense approval");
  if (d.decision === "rejected" && !d.note?.trim()) throw validation("Say why the expense is rejected.", ["note: required"]);
  return ctx.db.tx(async (q) => {
    const e = await one<{ claimant_id: string; project_id: string; state: string }>(q, "select claimant_id, project_id, state from expense where id = $1 for update", [d.expenseId], "Expense");
    forbidSelfApproval(ctx.actor, e.claimant_id, "expense");
    await requireProjectScope(q, ctx.actor, e.project_id);
    if (e.state !== "submitted") throw conflict(`This expense is already ${e.state}.`);
    await q.query("update expense set state = $2, reviewed_by = $3, reviewed_at = $4, review_note = $5, version = version + 1 where id = $1", [d.expenseId, d.decision, ctx.actor.id, iso(ctx.now), d.note ?? null]);
    await audit(q, { actorId: ctx.actor.id, action: `expense_${d.decision}`, objectType: "expense", objectId: d.expenseId, reason: d.note, correlationId: ctx.correlationId });
  });
}

/** Replaces an expense's allocation; parts sum exactly to the amount (largest remainder). */
export async function allocateExpense(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    expenseId: zId,
    targets: z.array(z.object({ projectId: zId, visitId: zId.optional(), qualityCaseId: zId.optional(), orderId: zId.optional(), weight: z.number().positive() })).min(1).max(20),
  }), input);
  requireRole(ctx.actor, "manager", "allocating expenses");
  return ctx.db.tx(async (q) => {
    const e = await one<{ amount_minor: number; project_id: string; state: string; claimant_id: string }>(q, "select amount_minor, project_id, state, claimant_id from expense where id = $1 for update", [d.expenseId], "Expense");
    await requireProjectScope(q, ctx.actor, e.project_id);
    forbidSelfApproval(ctx.actor, e.claimant_id, "expense allocation");
    if (e.state === "rejected") throw conflict("A rejected expense is not allocated.");
    for (const t of d.targets) {
      await requireProjectScope(q, ctx.actor, t.projectId);
      if (t.visitId) await one(q, "select 1 from visit where id = $1 and project_id = $2", [t.visitId, t.projectId], "Visit in the target project");
      if (t.orderId) await one(q, "select 1 from sales_order where id = $1 and project_id = $2", [t.orderId, t.projectId], "Order in the target project");
      if (t.qualityCaseId) await one(q, "select 1 from quality_case where id = $1 and project_id = $2", [t.qualityCaseId, t.projectId], "Quality case in the target project");
    }
    const parts = allocateMinor(e.amount_minor, d.targets.map((t) => t.weight));
    await q.query("delete from expense_allocation where expense_id = $1", [d.expenseId]);
    for (const [i, t] of d.targets.entries()) {
      await q.query("insert into expense_allocation(expense_id, project_id, visit_id, quality_case_id, order_id, amount_minor) values ($1,$2,$3,$4,$5,$6)",
        [d.expenseId, t.projectId, t.visitId ?? null, t.qualityCaseId ?? null, t.orderId ?? null, parts[i]]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "allocate_expense", objectType: "expense", objectId: d.expenseId, after: { parts }, correlationId: ctx.correlationId });
    return { parts };
  });
}
