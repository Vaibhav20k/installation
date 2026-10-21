/**
 * Quality cases, cross-functional issues/actions and savings verification (phase 9).
 * A later complaint reopens through a linked case; the original acceptance date is never rewritten.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { requireCapability, requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { iso, one, parse, zDate, zId, zMinor, type Ctx } from "./context";

const FUNCTIONS = ["Factory", "Purchase", "Logistics", "Services", "Site", "Installation", "Customer", "Unknown"] as const;

async function nextId(q: Queryable, table: string, prefix: string) {
  const [n] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from ${table}`);
  return `${prefix}-${String(n!.n).padStart(3, "0")}`;
}

export async function openQualityCase(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    projectId: zId, orderId: zId.optional(), componentId: zId.optional(), visitId: zId.optional(), kind: z.enum(["complaint", "rework"]),
    category: z.string().min(2).max(80), reportedOn: zDate, rootCause: z.string().max(300).optional(), responsibleFunction: z.enum(FUNCTIONS).optional(),
    correctiveAction: z.string().max(300).optional(), ownerId: zId.optional(),
  }), input);
  requireRole(ctx.actor, "supervisor", "recording quality cases");
  await requireProjectScope(ctx.db, ctx.actor, d.projectId);
  return ctx.db.tx(async (q) => {
    const bid = await nextId(q, "quality_case", "QC");
    const [r] = await q.query<{ id: string }>(
      `insert into quality_case(business_id, project_id, order_id, component_id, visit_id, kind, category, reported_on, root_cause, responsible_function, corrective_action, owner_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [bid, d.projectId, d.orderId ?? null, d.componentId ?? null, d.visitId ?? null, d.kind, d.category, d.reportedOn, d.rootCause ?? null, d.responsibleFunction ?? null, d.correctiveAction ?? null, d.ownerId ?? ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "open_quality_case", objectType: "quality_case", objectId: r!.id, after: d, correlationId: ctx.correlationId });
    return { id: r!.id, businessId: bid };
  });
}

export async function closeQualityCase(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ caseId: zId, closedOn: zDate, closureEvidence: z.string().min(3).max(500), rootCause: z.string().max(300).optional(), correctiveAction: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "closing quality cases");
  return ctx.db.tx(async (q) => {
    const c = await one<{ project_id: string; status: string }>(q, "select project_id, status from quality_case where id = $1 for update", [d.caseId], "Quality case");
    await requireProjectScope(q, ctx.actor, c.project_id);
    if (c.status === "closed") throw conflict("This case is already closed.");
    await q.query("update quality_case set status = 'closed', closed_on = $2, closure_evidence = $3, root_cause = coalesce($4, root_cause), corrective_action = coalesce($5, corrective_action) where id = $1",
      [d.caseId, d.closedOn, d.closureEvidence, d.rootCause ?? null, d.correctiveAction ?? null]);
    await audit(q, { actorId: ctx.actor.id, action: "close_quality_case", objectType: "quality_case", objectId: d.caseId, after: d, correlationId: ctx.correlationId });
  });
}

export async function reopenQualityCase(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ caseId: zId, reportedOn: zDate, category: z.string().min(2).max(80) }), input);
  requireRole(ctx.actor, "supervisor", "reopening quality cases");
  return ctx.db.tx(async (q) => {
    const c = await one<{ project_id: string; order_id: string | null; component_id: string | null; visit_id: string | null; kind: string; status: string }>(q,
      "select project_id, order_id, component_id, visit_id, kind, status from quality_case where id = $1", [d.caseId], "Quality case");
    await requireProjectScope(q, ctx.actor, c.project_id);
    if (c.status !== "closed") throw conflict("Only a closed case can be reopened.");
    const bid = await nextId(q, "quality_case", "QC");
    const [r] = await q.query<{ id: string }>(
      `insert into quality_case(business_id, project_id, order_id, component_id, visit_id, kind, category, reported_on, status, reopened_from, owner_id)
       values ($1,$2,$3,$4,$5,'complaint',$6,$7,'reopened',$8,$9) returning id`,
      [bid, c.project_id, c.order_id, c.component_id, c.visit_id, d.category, d.reportedOn, d.caseId, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "reopen_quality_case", objectType: "quality_case", objectId: r!.id, after: { from: d.caseId }, correlationId: ctx.correlationId });
    return { id: r!.id, businessId: bid };
  });
}

export async function createIssue(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    projectId: zId, orderId: zId.optional(), delayEventId: zId.optional(), qualityCaseId: zId.optional(), raisedOn: zDate,
    function: z.enum(FUNCTIONS), category: z.string().min(2).max(80), impact: z.string().max(300).optional(),
    delayDays: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(), estimatedCostMinor: zMinor.optional(), description: z.string().min(5).max(1000),
    ownerId: zId, escalationOwnerId: zId.optional(), nextAction: z.string().max(300).optional(), dueDate: zDate.optional(), recurrenceOf: zId.optional(),
  }), input);
  requireRole(ctx.actor, "supervisor", "raising issues");
  await requireProjectScope(ctx.db, ctx.actor, d.projectId);
  return ctx.db.tx(async (q) => {
    const bid = await nextId(q, "issue", "ISS");
    const [r] = await q.query<{ id: string }>(
      `insert into issue(business_id, raised_on, project_id, order_id, delay_event_id, quality_case_id, function, category, impact, delay_days, estimated_cost_minor, description,
         owner_id, escalation_owner_id, next_action, due_date, recurrence_of) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [bid, d.raisedOn, d.projectId, d.orderId ?? null, d.delayEventId ?? null, d.qualityCaseId ?? null, d.function, d.category, d.impact ?? null, d.delayDays ?? null,
        d.estimatedCostMinor ?? null, d.description, d.ownerId, d.escalationOwnerId ?? null, d.nextAction ?? null, d.dueDate ?? null, d.recurrenceOf ?? null]);
    await audit(q, { actorId: ctx.actor.id, action: "create_issue", objectType: "issue", objectId: r!.id, after: d, correlationId: ctx.correlationId });
    return { id: r!.id, businessId: bid };
  });
}

/** closeAction: a named owner closes with evidence. */
export async function closeAction(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ issueId: zId, closedOn: zDate, closureEvidence: z.string().min(3).max(500), version: z.number().int().positive() }), input);
  return ctx.db.tx(async (q) => {
    const i = await one<{ project_id: string; owner_id: string | null; status: string; version: number }>(q, "select project_id, owner_id, status, version from issue where id = $1 for update", [d.issueId], "Issue");
    await requireProjectScope(q, ctx.actor, i.project_id);
    if (i.owner_id !== ctx.actor.id) requireRole(ctx.actor, "manager", "closing another owner's action");
    if (i.status === "closed") throw conflict("This action is already closed.");
    if (i.version !== d.version) throw conflict("Someone else changed this issue. Reload before closing.");
    await q.query("update issue set status = 'closed', closed_on = $2, closure_evidence = $3, version = version + 1 where id = $1", [d.issueId, d.closedOn, d.closureEvidence]);
    await audit(q, { actorId: ctx.actor.id, action: "close_action", objectType: "issue", objectId: d.issueId, after: d, correlationId: ctx.correlationId });
  });
}

export async function createSavingsClaim(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId.optional(), loadRef: z.string().max(60).optional(), scope: z.string().min(3).max(200), period: z.string().min(3).max(40), baselineMinor: zMinor.optional(), actualMinor: zMinor.optional(), proposedSavingMinor: zMinor.optional() }), input);
  requireRole(ctx.actor, "manager", "proposing savings");
  if (d.projectId) await requireProjectScope(ctx.db, ctx.actor, d.projectId);
  return ctx.db.tx(async (q) => {
    const [r] = await q.query<{ id: string }>("insert into savings_claim(project_id, load_ref, scope, period, baseline_minor, actual_minor, proposed_saving_minor) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [d.projectId ?? null, d.loadRef ?? null, d.scope, d.period, d.baselineMinor ?? null, d.actualMinor ?? null, d.proposedSavingMinor ?? null]);
    await audit(q, { actorId: ctx.actor.id, action: "propose_savings", objectType: "savings_claim", objectId: r!.id, after: d, correlationId: ctx.correlationId });
    return { id: r!.id };
  });
}

/** verifySavings: Finance confirms a comparable baseline and verified actual; proposals alone stay unverified. */
export async function verifySavings(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ claimId: zId, baselineMinor: zMinor, actualMinor: zMinor, evidence: z.string().min(5).max(500), scopeMatched: z.literal(true) }), input);
  requireCapability(ctx.actor, "finance_verify", "Savings verification");
  if (d.actualMinor > d.baselineMinor) throw validation("Actual cost is above the baseline; there is no saving to verify.");
  return ctx.db.tx(async (q) => {
    await one(q, "select 1 from savings_claim where id = $1", [d.claimId], "Savings claim");
    await q.query("update savings_claim set baseline_minor = $2, actual_minor = $3, finance_verified = true, verified_by = $4, verified_at = $5, evidence = $6 where id = $1",
      [d.claimId, d.baselineMinor, d.actualMinor, ctx.actor.id, iso(ctx.now), d.evidence]);
    await audit(q, { actorId: ctx.actor.id, action: "verify_savings", objectType: "savings_claim", objectId: d.claimId, after: d, correlationId: ctx.correlationId });
  });
}
