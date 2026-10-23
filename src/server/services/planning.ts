/**
 * Planning operations: createPlan, createVisit, commitScope, setSkillRequirements,
 * createPlanRevision, submitPlan, approvePlan, returnPlan, cancelPlan (phases 5 and 6).
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { forbidSelfApproval, requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, forbidden, validation } from "../errors";
import { assertApproval, type ApprovalState } from "@/domain/lifecycle";
import { canCommitScope } from "@/domain/progress";
import { itineraryProblems } from "@/domain/scheduling";
import { Dec, sumDec } from "@/domain/decimal";
import { buildSnapshot, ensureDraftRevision, latestRevision, loadVisit } from "./plan-support";
import { iso, one, parse, zDate, zId, zQty, type Ctx } from "./context";

export async function createPlan(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId }), input);
  requireRole(ctx.actor, "supervisor", "drafting plans");
  await requireProjectScope(ctx.db, ctx.actor, d.projectId);
  return ctx.db.tx(async (q) => {
    const [n] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from plan`);
    const bid = `PLN-${String(n!.n).padStart(3, "0")}`;
    const [p] = await q.query<{ id: string }>("insert into plan(business_id, project_id, created_by) values ($1,$2,$3) returning id", [bid, d.projectId, ctx.actor.id]);
    await q.query(`insert into plan_revision(plan_id, revision_no, approval_state, snapshot, change_reason, created_by) values ($1,1,'draft','{"visits":[]}','Initial plan',$2)`, [p!.id, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "create", objectType: "plan", objectId: p!.id, after: d, correlationId: ctx.correlationId });
    return { id: p!.id, businessId: bid };
  });
}

const visitInput = z.object({
  planId: zId,
  changeReason: z.string().max(300).optional(),
  visitType: z.enum(["fresh", "follow_up", "final"]),
  repeatReason: z.enum(["planned_phasing", "material_shortage", "customer_change", "failed_readiness", "rework", "other_documented"]).optional(),
  repeatReasonNote: z.string().max(300).optional(),
  requestedStart: zDate.optional(),
  requestedStartMeaning: z.enum(["travel_start", "installation_start"]).optional(),
  plannedStart: zDate.optional(),
  plannedEnd: zDate.optional(),
  outstation: z.boolean().default(false),
  departureAt: z.string().datetime({ offset: true }).optional(),
  returnAt: z.string().datetime({ offset: true }).optional(),
  teamSize: z.number().int().min(1).max(12).optional(),
  continuity: z.enum(["none", "preferred", "mandatory"]).default("preferred"),
  preferredTeamId: zId.optional(),
  orderIds: z.array(zId).min(1, "Select at least one order"),
});

export async function createVisit(ctx: Ctx, input: unknown) {
  const d = parse(visitInput, input);
  requireRole(ctx.actor, "supervisor", "planning visits");
  return ctx.db.tx((q) => insertVisit(q, ctx, d));
}

/** Inserts a visit with its order links, clearance gates and readiness checklist inside the caller's transaction. */
export async function insertVisit(q: Queryable, ctx: Ctx, input: z.input<typeof visitInput>) {
  const d = parse(visitInput, input);
  if (d.visitType !== "fresh" && !d.repeatReason) throw validation("A follow-up or final visit needs a repeat-visit reason.", ["repeatReason: required"]);
  if (d.plannedStart && d.plannedEnd && d.plannedEnd < d.plannedStart) throw validation("Planned end is before planned start.");
  if (d.requestedStart && !d.requestedStartMeaning) throw validation("Say whether the requested start is the travel start or the installation start.", ["requestedStartMeaning: required"]);
  if ((d.departureAt && !d.returnAt) || (!d.departureAt && d.returnAt)) throw validation("Give both departure and return for an itinerary.");
  if (d.departureAt && d.returnAt && Date.parse(d.returnAt) <= Date.parse(d.departureAt)) throw validation("Return must be after departure.");
  {
    const plan = await one<{ project_id: string }>(q, "select project_id from plan where id = $1", [d.planId], "Plan");
    await requireProjectScope(q, ctx.actor, plan.project_id);
    await ensureDraftRevision(q, ctx, d.planId, d.changeReason);
    const teamSize = d.teamSize ?? Number((await q.query<{ value: number }>("select value from app_setting where key = 'default_team_size'"))[0]?.value ?? 3);
    const [seq] = await q.query<{ n: number }>("select coalesce(max(sequence),0)+1 n from visit where plan_id = $1", [d.planId]);
    const [bn] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from visit`);
    const bid = `VIS-${String(bn!.n).padStart(3, "0")}`;
    const [v] = await q.query<{ id: string }>(
      `insert into visit(business_id, project_id, plan_id, sequence, visit_type, requested_start, requested_start_meaning, planned_start, planned_end,
         departure_at, return_at, repeat_reason, repeat_reason_note, team_size, continuity, preferred_team_id, outstation)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [bid, plan.project_id, d.planId, seq!.n, d.visitType, d.requestedStart ?? null, d.requestedStartMeaning ?? null, d.plannedStart ?? null, d.plannedEnd ?? null,
        d.departureAt ?? null, d.returnAt ?? null, d.repeatReason ?? null, d.repeatReasonNote ?? null, teamSize, d.continuity, d.preferredTeamId ?? null, d.outstation]);
    // Composite foreign keys reject orders from another project.
    for (const orderId of d.orderIds) await q.query("insert into visit_order(visit_id, order_id, project_id) values ($1,$2,$3)", [v!.id, orderId, plan.project_id]);
    for (const gate of ["accounts", "site", "installation"]) await q.query("insert into clearance(visit_id, gate) values ($1,$2)", [v!.id, gate]);
    for (const check of ["site_access", "materials", "drawings", "tools", "customer_confirmation", "skill_coverage"]) {
      await q.query("insert into readiness_check(visit_id, check_code) values ($1,$2)", [v!.id, check]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "create", objectType: "visit", objectId: v!.id, after: d, correlationId: ctx.correlationId });
    return { id: v!.id, businessId: bid };
  }
}

export async function updateVisitDates(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    visitId: zId, changeReason: z.string().max(300).optional(), plannedStart: zDate, plannedEnd: zDate,
    departureAt: z.string().datetime({ offset: true }).nullable().optional(), returnAt: z.string().datetime({ offset: true }).nullable().optional(),
    teamSize: z.number().int().min(1).max(12).optional(), continuity: z.enum(["none", "preferred", "mandatory"]).optional(),
  }), input);
  requireRole(ctx.actor, "supervisor", "planning visits");
  if (d.plannedEnd < d.plannedStart) throw validation("Planned end is before planned start.");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId, true);
    await requireProjectScope(q, ctx.actor, v.project_id);
    if (!["unscheduled", "scheduled", "on_hold"].includes(v.exec_status)) throw conflict(`A visit that is ${v.exec_status} needs a schedule revision, not a date edit.`);
    const order = itineraryProblems({ plannedStart: d.plannedStart, plannedEnd: d.plannedEnd, departureAt: d.departureAt ? Date.parse(d.departureAt) : null, returnAt: d.returnAt ? Date.parse(d.returnAt) : null, tz: v.timezone });
    if (order.length) throw validation("The itinerary is out of order.", order);
    const live = await q.query("select 1 from reservation where visit_id = $1 and state in ('held','confirmed') limit 1", [d.visitId]);
    if (live.length) throw conflict("This visit has held or confirmed staff. Use a schedule revision so reservations move atomically.");
    await ensureDraftRevision(q, ctx, v.plan_id, d.changeReason);
    await q.query(
      `update visit set planned_start = $2, planned_end = $3, departure_at = $4, return_at = $5, team_size = coalesce($6, team_size),
         continuity = coalesce($7, continuity), version = version + 1, updated_at = now() where id = $1`,
      [d.visitId, d.plannedStart, d.plannedEnd, d.departureAt ?? null, d.returnAt ?? null, d.teamSize ?? null, d.continuity ?? null]);
    // Proposed staffing no longer matches the dates; it is withdrawn rather than silently kept.
    await q.query("update reservation set state = 'cancelled' where visit_id = $1 and state = 'proposed'", [d.visitId]);
    await audit(q, { actorId: ctx.actor.id, action: "update_dates", objectType: "visit", objectId: d.visitId, before: { start: v.planned_start, end: v.planned_end }, after: d, correlationId: ctx.correlationId });
  });
}

/**
 * Commits task quantity to a visit. The task row is locked so concurrent attempts to commit
 * the same remaining quantity serialize; at most the uncommitted quantity can be committed.
 */
export async function commitScope(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, taskId: zId, quantity: zQty, kind: z.enum(["original", "rework", "additional"]).default("original"), changeReason: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "planning scope");
  if (!Dec.of(d.quantity).isPositive()) throw validation("Quantity must be greater than zero.");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId);
    await requireProjectScope(q, ctx.actor, v.project_id);
    if (["completed", "closed", "cancelled"].includes(v.exec_status)) throw conflict(`Scope cannot be added to a ${v.exec_status} visit.`);
    const task = await one<{ required_quantity: string; project_id: string; order_id: string }>(q,
      `select t.required_quantity, o.project_id, o.id order_id from installation_task t join component c on c.id = t.component_id
       join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id where t.id = $1 for update of t`, [d.taskId], "Task");
    if (task.project_id !== v.project_id) throw validation("That task belongs to another project.");
    const linked = await q.query("select 1 from visit_order where visit_id = $1 and order_id = $2", [d.visitId, task.order_id]);
    if (!linked.length) throw validation("That task's order is not linked to this visit.");
    if (d.kind === "original") {
      const usage = await taskUsage(q, d.taskId);
      const check = canCommitScope(task.required_quantity, usage.accepted, usage.activeRemaining, d.quantity);
      if (!check.ok) throw conflict(`Only ${check.available} of this task is uncommitted. It is already allocated to another active visit or accepted.`);
    }
    if (d.kind === "rework" && !d.changeReason) throw validation("Rework scope needs an explicit reason.", ["changeReason: required"]);
    await ensureDraftRevision(q, ctx, v.plan_id, d.changeReason);
    const [vt] = await q.query<{ id: string }>(
      `insert into visit_task(visit_id, task_id, scoped_quantity, kind, status_reason) values ($1,$2,$3,$4,$5)
       on conflict (visit_id, task_id, kind) do update set scoped_quantity = visit_task.scoped_quantity + excluded.scoped_quantity
       returning id`, [d.visitId, d.taskId, d.quantity, d.kind, d.kind === "original" ? null : d.changeReason ?? null]);
    await audit(q, { actorId: ctx.actor.id, action: "commit_scope", objectType: "visit_task", objectId: vt!.id, after: d, reason: d.changeReason, correlationId: ctx.correlationId });
    return { id: vt!.id };
  });
}

/** Accepted output on original scope, and remaining quantity still held by active visits. */
export async function taskUsage(q: Queryable, taskId: string) {
  const rows = await q.query<{ status: string; exec_status: string; scoped: string; accepted: string }>(
    `select vt.status, v.exec_status, vt.scoped_quantity::text scoped,
       coalesce((select sum(pe.quantity_delta) from progress_event pe where pe.visit_task_id = vt.id and pe.accepted and pe.step = t.activity), 0)::text accepted
     from visit_task vt join visit v on v.id = vt.visit_id join installation_task t on t.id = vt.task_id
     where vt.task_id = $1 and vt.kind = 'original'`, [taskId]);
  const accepted = sumDec(rows.map((r) => r.accepted));
  const activeRemaining = rows
    .filter((r) => r.status === "active" && r.exec_status !== "cancelled")
    .map((r) => Dec.of(r.scoped).sub(r.accepted).max(0).toString());
  return { accepted, activeRemaining };
}

export async function setSkillRequirements(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    visitId: zId, changeReason: z.string().max(300).optional(), sourceComplexityLabel: z.string().max(40).optional(),
    requirements: z.array(z.object({
      skillId: zId, minLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]), headcount: z.number().int().min(1).max(12),
      mode: z.enum(["collective", "per_person"]), appliesToRoles: z.array(z.string()).default([]), concurrencyGroup: z.string().max(40).default("site"),
    })).max(20),
  }), input);
  requireRole(ctx.actor, "supervisor", "setting skill requirements");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId);
    await requireProjectScope(q, ctx.actor, v.project_id);
    await ensureDraftRevision(q, ctx, v.plan_id, d.changeReason);
    await q.query("delete from skill_requirement where visit_id = $1", [d.visitId]);
    for (const r of d.requirements) {
      await q.query(
        `insert into skill_requirement(visit_id, skill_id, min_level, headcount, mode, applies_to_roles, concurrency_group, source_complexity_label) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [d.visitId, r.skillId, r.minLevel, r.headcount, r.mode, r.appliesToRoles, r.concurrencyGroup, d.sourceComplexityLabel ?? null]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "set_requirements", objectType: "visit", objectId: d.visitId, after: d, correlationId: ctx.correlationId });
  });
}

async function transitionRevision(ctx: Ctx, planId: string, to: ApprovalState, note?: string) {
  return ctx.db.tx(async (q) => {
    const plan = await one<{ project_id: string; status: string; baseline_revision_id: string | null }>(q, "select project_id, status, baseline_revision_id from plan where id = $1 for update", [planId], "Plan");
    await requireProjectScope(q, ctx.actor, plan.project_id);
    if (plan.status !== "active") throw conflict(`This plan is ${plan.status}.`);
    const rev = await latestRevision(q, planId);
    assertApproval(rev.approval_state as ApprovalState, to);
    if (to === "submitted") {
      const snapshot = await buildSnapshot(q, planId);
      if (snapshot.visits.length === 0) throw validation("Add at least one visit before submitting.");
      const missing = snapshot.visits.flatMap((v) => [
        ...(!v.plannedStart || !v.plannedEnd ? [`${v.businessId}: planned dates`] : []),
        ...(v.scope.length === 0 ? [`${v.businessId}: scope`] : []),
      ]);
      if (missing.length) throw validation("Complete these before submitting.", missing);
      await q.query("update plan_revision set approval_state = 'submitted', snapshot = $2, submitted_at = $3, submitted_by = $4 where id = $1", [rev.id, JSON.stringify(snapshot), iso(ctx.now), ctx.actor.id]);
    } else {
      requireRole(ctx.actor, "manager", "plan review");
      // Four eyes: the reviewer may be neither the submitter nor the author of the revision.
      const [s] = await q.query<{ submitted_by: string | null; created_by: string | null }>("select submitted_by, created_by from plan_revision where id = $1", [rev.id]);
      if (s?.submitted_by) forbidSelfApproval(ctx.actor, s.submitted_by, "plan submission");
      if (s?.created_by) forbidSelfApproval(ctx.actor, s.created_by, "plan revision");
      if (to === "returned" && !note?.trim()) throw validation("Say why the plan is returned.", ["note: required"]);
      await q.query("update plan_revision set approval_state = $2, decided_at = $3, decided_by = $4, decision_note = $5 where id = $1", [rev.id, to, iso(ctx.now), ctx.actor.id, note ?? null]);
      if (to === "approved") {
        // The first approved revision becomes the immutable baseline; later approvals move only the current pointer.
        await q.query("update plan set current_revision_id = $2, baseline_revision_id = coalesce(baseline_revision_id, $2) where id = $1", [planId, rev.id]);
      }
    }
    await audit(q, { actorId: ctx.actor.id, action: `plan_${to}`, objectType: "plan", objectId: planId, after: { revision: rev.revision_no }, reason: note, correlationId: ctx.correlationId });
    return { revisionNo: rev.revision_no, state: to };
  });
}

export const submitPlan = async (ctx: Ctx, input: unknown) => { const d = parse(z.object({ planId: zId }), input); requireRole(ctx.actor, "supervisor", "submitting plans"); return transitionRevision(ctx, d.planId, "submitted"); };
export const approvePlan = async (ctx: Ctx, input: unknown) => { const d = parse(z.object({ planId: zId, note: z.string().max(500).optional() }), input); return transitionRevision(ctx, d.planId, "approved", d.note); };
export const returnPlan = async (ctx: Ctx, input: unknown) => { const d = parse(z.object({ planId: zId, note: z.string().max(500) }), input); return transitionRevision(ctx, d.planId, "returned", d.note); };

export async function createPlanRevision(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ planId: zId, changeReason: z.string().min(3).max(300) }), input);
  requireRole(ctx.actor, "supervisor", "revising plans");
  return ctx.db.tx(async (q) => {
    const plan = await one<{ project_id: string }>(q, "select project_id from plan where id = $1", [d.planId], "Plan");
    await requireProjectScope(q, ctx.actor, plan.project_id);
    const r = await ensureDraftRevision(q, ctx, d.planId, d.changeReason);
    return { revisionNo: r.revision_no };
  });
}

/** Rejecting/cancelling an unused plan releases its future reservations in the same transaction. */
export async function cancelPlan(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ planId: zId, reason: z.string().min(3).max(300) }), input);
  requireRole(ctx.actor, "manager", "cancelling plans");
  return ctx.db.tx(async (q) => {
    const plan = await one<{ project_id: string; status: string }>(q, "select project_id, status from plan where id = $1 for update", [d.planId], "Plan");
    await requireProjectScope(q, ctx.actor, plan.project_id);
    if (plan.status !== "active") throw conflict(`This plan is already ${plan.status}.`);
    const started = await q.query("select business_id from visit where plan_id = $1 and exec_status in ('in_progress','completed','closed')", [d.planId]);
    if (started.length) throw forbidden("Visits in this plan have started; cancel or transfer remaining scope per visit instead.");
    const released = await q.query<{ id: string }>(
      `update reservation set state = case when state = 'proposed' then 'cancelled' else 'released' end
       where visit_id in (select id from visit where plan_id = $1) and state in ('proposed','held','confirmed') and upper(span) > $2 returning id`, [d.planId, iso(ctx.now)]);
    await q.query("update visit set exec_status = 'cancelled', updated_at = now() where plan_id = $1 and exec_status in ('unscheduled','scheduled','on_hold')", [d.planId]);
    await q.query("update plan set status = 'cancelled' where id = $1", [d.planId]);
    await audit(q, { actorId: ctx.actor.id, action: "cancel", objectType: "plan", objectId: d.planId, after: { releasedReservations: released.length }, reason: d.reason, correlationId: ctx.correlationId });
    return { releasedReservations: released.length };
  });
}
