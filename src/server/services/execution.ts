/**
 * Visit execution: lifecycle, frozen daily targets, progress, delays, acceptance, follow-up
 * visits from remaining scope, scope transfer and schedule revisions (phase 6).
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, forbidden, validation } from "../errors";
import { assertExecution, type ExecutionState } from "@/domain/lifecycle";
import { acceptedCompleted, validateProgressEvent, remainingQuantity } from "@/domain/progress";
import { Dec } from "@/domain/decimal";
import { localDateOf, dayDiff, addDays } from "@/lib/dates";
import { clearanceGate, readinessGate } from "./clearance";
import { ensureDraftRevision, loadVisit, visitSpan } from "./plan-support";
import { insertVisit, taskUsage } from "./planning";
import { bumpVersion, iso, one, parse, zDate, zId, zQty, zVersion, type Ctx } from "./context";

export async function transitionVisit(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, to: z.enum(["scheduled", "in_progress", "completed", "closed", "on_hold", "cancelled", "unscheduled"]), version: zVersion, reason: z.string().max(500).optional() }), input);
  requireRole(ctx.actor, "supervisor", "visit status changes");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId, true);
    await requireProjectScope(q, ctx.actor, v.project_id);
    assertExecution(v.exec_status as ExecutionState, d.to);
    const today = localDateOf(ctx.now, v.timezone);
    if (d.to === "in_progress" && v.exec_status === "scheduled") {
      // Departure: clearance validity and exception conditions are revalidated, plus readiness.
      const gate = await clearanceGate(q, d.visitId, today);
      const ready = await readinessGate(q, d.visitId, today);
      const blockers = [...gate.blockers, ...ready.blockers];
      if (blockers.length) throw forbidden(`Deployment is blocked: ${blockers.join("; ")}.`);
      const [c] = await q.query<{ n: number }>("select count(*)::int n from reservation where visit_id = $1 and state = 'confirmed'", [d.visitId]);
      if (!c!.n) throw conflict("No confirmed staff are booked for this visit.");
    }
    if (d.to === "scheduled" && v.exec_status === "unscheduled") throw conflict("A visit becomes scheduled by firm booking.");
    if (d.to === "completed") {
      const open = await openScope(q, d.visitId);
      if (open.length) throw conflict("Accept or transfer the remaining scope before completing the visit.", open.map((o) => `${o.task}: ${o.remaining} ${o.unit} remaining`));
    }
    if (["on_hold", "cancelled"].includes(d.to) && !d.reason?.trim()) throw validation("Give a reason.", ["reason: required"]);
    await bumpVersion(q, "visit", d.visitId, d.version);
    await q.query("update visit set exec_status = $2, updated_at = now() where id = $1", [d.visitId, d.to]);
    let released = 0;
    if (d.to === "cancelled") {
      // Future capacity is released in the same transaction; recorded actuals are untouched.
      released = (await q.query("update reservation set state = case when state='proposed' then 'cancelled' else 'released' end where visit_id = $1 and state in ('proposed','held','confirmed') returning id", [d.visitId])).length;
    }
    // On hold keeps reservations until an explicit release decision.
    await audit(q, { actorId: ctx.actor.id, action: `visit_${d.to}`, objectType: "visit", objectId: d.visitId, before: { status: v.exec_status }, reason: d.reason, after: { released }, correlationId: ctx.correlationId });
    return { status: d.to, released };
  });
}

/** Active visit tasks with unaccepted quantity. */
export async function openScope(q: Queryable, visitId: string) {
  const rows = await q.query<{ id: string; task: string; unit: string; scoped: string; accepted: string }>(
    `select vt.id, t.business_id task, t.unit, vt.scoped_quantity::text scoped,
       coalesce((select sum(quantity_delta) from progress_event pe where pe.visit_task_id = vt.id and pe.accepted), 0)::text accepted
     from visit_task vt join installation_task t on t.id = vt.task_id where vt.visit_id = $1 and vt.status = 'active'`, [visitId]);
  return rows.map((r) => ({ ...r, remaining: remainingQuantity(r.scoped, r.accepted).remaining })).filter((r) => Dec.of(r.remaining).isPositive());
}

/** Daily targets are frozen before execution; later edits supersede them with a dated, reasoned record. */
export async function setDailyTarget(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitTaskId: zId, planDate: zDate, targetQuantity: zQty, changeReason: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "daily targets");
  return ctx.db.tx(async (q) => {
    const vt = await one<{ project_id: string; activity: string; scoped: string }>(q,
      `select v.project_id, t.activity, vt.scoped_quantity::text scoped from visit_task vt join visit v on v.id = vt.visit_id join installation_task t on t.id = vt.task_id where vt.id = $1`, [d.visitTaskId], "Visit task");
    await requireProjectScope(q, ctx.actor, vt.project_id);
    if (Dec.of(d.targetQuantity).cmp(vt.scoped) > 0) throw validation("A daily target cannot exceed the scoped quantity.");
    const [cur] = await q.query<{ id: string; frozen_at: number | null }>("select id, frozen_at from daily_target where visit_task_id = $1 and plan_date = $2 and step = $3 and is_current", [d.visitTaskId, d.planDate, vt.activity]);
    if (cur?.frozen_at && !d.changeReason?.trim()) throw validation("This target is frozen. Give a reason; the original stays in history.", ["changeReason: required"]);
    if (cur) await q.query("update daily_target set is_current = false where id = $1", [cur.id]);
    const [t] = await q.query<{ id: string }>(
      `insert into daily_target(visit_task_id, plan_date, step, target_quantity, supersedes_id, change_reason, created_by, frozen_at, frozen_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [d.visitTaskId, d.planDate, vt.activity, d.targetQuantity, cur?.id ?? null, d.changeReason ?? null, ctx.actor.id, cur?.frozen_at ? iso(ctx.now) : null, cur?.frozen_at ? ctx.actor.id : null]);
    await audit(q, { actorId: ctx.actor.id, action: cur ? "revise_target" : "set_target", objectType: "daily_target", objectId: t!.id, after: d, reason: d.changeReason, correlationId: ctx.correlationId });
    // A retroactive target edit never creates additional-scope authorization; that is a separate approved visit task.
    return { id: t!.id };
  });
}

export async function freezeDailyTargets(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, planDate: zDate }), input);
  requireRole(ctx.actor, "supervisor", "freezing targets");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId);
    await requireProjectScope(q, ctx.actor, v.project_id);
    const rows = await q.query("update daily_target set frozen_at = $3, frozen_by = $4 where plan_date = $2 and is_current and frozen_at is null and visit_task_id in (select id from visit_task where visit_id = $1) returning id", [d.visitId, d.planDate, iso(ctx.now), ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "freeze_targets", objectType: "visit", objectId: d.visitId, after: { date: d.planDate, count: rows.length }, correlationId: ctx.correlationId });
    return { frozen: rows.length };
  });
}

/** Records output. Supervisors' entries are accepted; employees' entries await acceptance. Reversals reference the original. */
export async function recordProgress(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitTaskId: zId, quantityDelta: z.string().regex(/^-?\d+(\.\d{1,6})?$/), reversesEventId: zId.optional(), evidence: z.string().max(500).optional() }), input);
  return ctx.db.tx(async (q) => {
    const vt = await one<{ project_id: string; activity: string; scoped: string; exec_status: string; visit_id: string; task_id: string; kind: string }>(q,
      `select v.project_id, t.activity, vt.scoped_quantity::text scoped, v.exec_status, v.id visit_id, vt.task_id, vt.kind from visit_task vt join visit v on v.id = vt.visit_id
       join installation_task t on t.id = vt.task_id where vt.id = $1 for update of vt`, [d.visitTaskId], "Visit task");
    await requireProjectScope(q, ctx.actor, vt.project_id);
    if (!["in_progress", "completed"].includes(vt.exec_status)) throw conflict(`Progress is recorded on visits in progress (this one is ${vt.exec_status}).`);
    const accepted = ctx.actor.role !== "employee";
    const existing = await q.query<{ id: string; quantity_delta: string; reverses_event_id: string | null; accepted: boolean }>(
      "select id, quantity_delta::text, reverses_event_id, accepted from progress_event where visit_task_id = $1", [d.visitTaskId]);
    const errors = validateProgressEvent(vt.scoped, existing.map((e) => ({ id: e.id, quantityDelta: e.quantity_delta, reversesEventId: e.reverses_event_id, accepted: e.accepted })),
      { id: "new", quantityDelta: d.quantityDelta, reversesEventId: d.reversesEventId ?? null, accepted });
    if (errors.length) throw validation("This progress entry is not valid.", errors);
    const [e] = await q.query<{ id: string }>(
      `insert into progress_event(visit_task_id, step, quantity_delta, reverses_event_id, accepted, accepted_by, actor_id, at, evidence) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [d.visitTaskId, vt.activity, d.quantityDelta, d.reversesEventId ?? null, accepted, accepted ? ctx.actor.id : null, ctx.actor.id, iso(ctx.now), d.evidence ?? null]);
    await audit(q, { actorId: ctx.actor.id, action: Dec.of(d.quantityDelta).isNegative() ? "reverse_progress" : "record_progress", objectType: "progress_event", objectId: e!.id, after: d, correlationId: ctx.correlationId });
    const total = acceptedCompleted([...existing.map((x) => ({ id: x.id, quantityDelta: x.quantity_delta, accepted: x.accepted })), { id: e!.id, quantityDelta: d.quantityDelta, accepted }]);
    return { id: e!.id, acceptedQuantity: total.toString(), remaining: remainingQuantity(vt.scoped, total).remaining };
  });
}

export async function acceptProgress(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ progressEventId: zId }), input);
  requireRole(ctx.actor, "supervisor", "accepting progress");
  return ctx.db.tx(async (q) => {
    const e = await one<{ actor_id: string; project_id: string; accepted: boolean; scoped: string; visit_task_id: string }>(q,
      `select pe.actor_id, v.project_id, pe.accepted, vt.scoped_quantity::text scoped, pe.visit_task_id from progress_event pe join visit_task vt on vt.id = pe.visit_task_id join visit v on v.id = vt.visit_id where pe.id = $1`, [d.progressEventId], "Progress event");
    await requireProjectScope(q, ctx.actor, e.project_id);
    if (e.actor_id === ctx.actor.id) throw forbidden("You cannot accept your own progress entry.");
    if (e.accepted) return;
    await q.query("update progress_event set accepted = true, accepted_by = $2 where id = $1", [d.progressEventId, ctx.actor.id]);
    const [sum] = await q.query<{ s: string }>("select coalesce(sum(quantity_delta),0)::text s from progress_event where visit_task_id = $1 and accepted", [e.visit_task_id]);
    if (Dec.of(sum!.s).cmp(e.scoped) > 0) throw validation("Accepting this would exceed the approved scope.");
    await audit(q, { actorId: ctx.actor.id, action: "accept_progress", objectType: "progress_event", objectId: d.progressEventId, correlationId: ctx.correlationId });
  });
}

export async function recordDelay(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    visitId: zId, taskId: zId.optional(), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }),
    cause: z.enum(["materials", "site_access", "equipment", "customer", "other_function", "weather", "employee", "unknown"]), impact: z.string().max(300).optional(),
    responsibleFunction: z.enum(["Factory", "Purchase", "Logistics", "Services", "Site", "Installation", "Customer", "Unknown"]).optional(),
    employeeFault: z.enum(["not_assessed", "no", "yes"]).default("not_assessed"), evidence: z.string().max(500).optional(),
  }), input);
  if (Date.parse(d.end) <= Date.parse(d.start)) throw validation("Delay end must be after its start.");
  // Responsibility is a separate field; it is never inferred from who reported the delay.
  if (d.employeeFault === "yes") requireRole(ctx.actor, "manager", "recording employee fault");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId);
    await requireProjectScope(q, ctx.actor, v.project_id);
    const [r] = await q.query<{ id: string }>(
      `insert into delay_event(visit_id, task_id, span, cause, impact, responsible_function, employee_fault, evidence, reported_by)
       values ($1,$2,tstzrange($3::timestamptz,$4::timestamptz),$5,$6,$7,$8,$9,$10) returning id`,
      [d.visitId, d.taskId ?? null, d.start, d.end, d.cause, d.impact ?? null, d.responsibleFunction ?? null, d.employeeFault, d.evidence ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "record_delay", objectType: "delay_event", objectId: r!.id, after: d, correlationId: ctx.correlationId });
    return { id: r!.id };
  });
}

export async function recordAcceptance(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, orderItemId: zId.optional(), signedOff: z.boolean(), signedByName: z.string().max(120).optional(), acceptedOn: zDate.optional(), evidence: z.string().max(500).optional() }), input);
  requireRole(ctx.actor, "supervisor", "recording customer acceptance");
  if (d.signedOff && (!d.acceptedOn || !d.evidence)) throw validation("A sign-off needs the accepted date and evidence.");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId);
    await requireProjectScope(q, ctx.actor, v.project_id);
    const [r] = await q.query<{ id: string }>(
      "insert into acceptance(visit_id, order_item_id, signed_off, signed_by_name, accepted_on, evidence, recorded_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [d.visitId, d.orderItemId ?? null, d.signedOff, d.signedByName ?? null, d.acceptedOn ?? null, d.evidence ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "record_acceptance", objectType: "acceptance", objectId: r!.id, after: d, correlationId: ctx.correlationId });
    return { id: r!.id };
  });
}

/** Moves a visit task's unaccepted quantity out of the visit (to a follow-up) with a reason. */
export async function transferOutstandingScope(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitTaskId: zId, reason: z.string().min(3).max(300), cancel: z.boolean().default(false) }), input);
  requireRole(ctx.actor, "manager", "transferring scope");
  return ctx.db.tx(async (q) => {
    const vt = await one<{ project_id: string; status: string }>(q, "select v.project_id, vt.status from visit_task vt join visit v on v.id = vt.visit_id where vt.id = $1", [d.visitTaskId], "Visit task");
    await requireProjectScope(q, ctx.actor, vt.project_id);
    if (vt.status !== "active") throw conflict(`This scope is already ${vt.status}.`);
    await q.query("update visit_task set status = $2, status_reason = $3 where id = $1", [d.visitTaskId, d.cancel ? "cancelled" : "transferred", d.reason]);
    await audit(q, { actorId: ctx.actor.id, action: d.cancel ? "cancel_scope" : "transfer_scope", objectType: "visit_task", objectId: d.visitTaskId, reason: d.reason, correlationId: ctx.correlationId });
  });
}

/**
 * Creates a follow-up or final visit pre-filled with uncommitted original scope of the source visit's tasks.
 * Completed work returns only through explicit rework scope (commitScope with kind "rework").
 */
export async function createFollowUpVisit(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    fromVisitId: zId, visitType: z.enum(["follow_up", "final"]), repeatReason: z.enum(["planned_phasing", "material_shortage", "customer_change", "failed_readiness", "rework", "other_documented"]),
    repeatReasonNote: z.string().max(300).optional(), plannedStart: zDate.optional(), plannedEnd: zDate.optional(), changeReason: z.string().max(300).optional(),
  }), input);
  requireRole(ctx.actor, "supervisor", "planning follow-up visits");
  const src = await loadVisit(ctx.db, d.fromVisitId);
  await requireProjectScope(ctx.db, ctx.actor, src.project_id);
  return ctx.db.tx(async (q) => {
    const orders = await q.query<{ order_id: string }>("select order_id from visit_order where visit_id = $1", [d.fromVisitId]);
    const created = await insertVisit(q, ctx, {
      planId: src.plan_id, visitType: d.visitType, repeatReason: d.repeatReason, repeatReasonNote: d.repeatReasonNote, plannedStart: d.plannedStart, plannedEnd: d.plannedEnd,
      orderIds: orders.map((o) => o.order_id), changeReason: d.changeReason, continuity: "preferred",
    });
    const tasks = await q.query<{ task_id: string; required: string; business_id: string }>(
      `select distinct t.id task_id, t.required_quantity::text required, t.business_id from visit_task vt join installation_task t on t.id = vt.task_id
       where vt.visit_id = $1 and vt.kind = 'original' order by t.business_id`, [d.fromVisitId]);
    const carried: Array<{ task: string; quantity: string }> = [];
    for (const t of tasks) {
      await q.query("select id from installation_task where id = $1 for update", [t.task_id]);
      const usage = await taskUsage(q, t.task_id);
      const left = Dec.of(t.required).sub(usage.accepted).sub(usage.activeRemaining.reduce((a, b) => a.add(b), Dec.zero));
      if (!left.isPositive()) continue;
      await q.query("insert into visit_task(visit_id, task_id, scoped_quantity, kind) values ($1,$2,$3,'original')", [created.id, t.task_id, left.toString()]);
      carried.push({ task: t.business_id, quantity: left.toString() });
    }
    await audit(q, { actorId: ctx.actor.id, action: "create_follow_up", objectType: "visit", objectId: created.id, after: { from: src.business_id, carried }, correlationId: ctx.correlationId });
    return { ...created, carried };
  });
}

/**
 * Proposes moving a visit's work and travel after a delay or early finish: shows downstream
 * conflicts and per-person-day cost impact without changing anything.
 */
export async function proposeScheduleRevision(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, plannedStart: zDate, plannedEnd: zDate }), input);
  requireRole(ctx.actor, "supervisor", "schedule revisions");
  const v = await loadVisit(ctx.db, d.visitId);
  await requireProjectScope(ctx.db, ctx.actor, v.project_id);
  if (d.plannedEnd < d.plannedStart) throw validation("Planned end is before planned start.");
  const shift = v.planned_start ? dayDiff(v.planned_start, d.plannedStart) : 0;
  const cur = visitSpan(v);
  const next = cur && v.departure_at
    ? { start: cur.start + shift * 86_400_000, end: cur.end + (dayDiff(v.planned_end!, d.plannedEnd)) * 86_400_000 }
    : visitSpan({ ...v, planned_start: d.plannedStart, planned_end: d.plannedEnd, departure_at: null, return_at: null });
  const conflicts = await ctx.db.query<{ employee: string; visit: string; state: string }>(
    `select e.business_id employee, ov.business_id visit, r2.state from reservation r join reservation r2 on r2.employee_id = r.employee_id and r2.visit_id <> r.visit_id
     join employee e on e.id = r.employee_id join visit ov on ov.id = r2.visit_id
     where r.visit_id = $1 and r.state in ('held','confirmed') and r2.state in ('held','confirmed') and r2.span && tstzrange($2::timestamptz,$3::timestamptz)`,
    [d.visitId, iso(next!.start), iso(next!.end)]);
  const [staff] = await ctx.db.query<{ n: number }>("select count(*)::int n from reservation where visit_id = $1 and state in ('held','confirmed')", [d.visitId]);
  const oldDays = v.planned_start && v.planned_end ? dayDiff(v.planned_start, v.planned_end) + 1 : 0;
  const newDays = dayDiff(d.plannedStart, d.plannedEnd) + 1;
  return {
    from: { start: v.planned_start, end: v.planned_end }, to: { start: d.plannedStart, end: d.plannedEnd },
    conflicts, personDayChange: (newDays - oldDays) * (staff?.n ?? 0),
    note: conflicts.length ? "Other approved visits are not moved automatically; resolve each conflict explicitly." : "No staffing conflicts for the proposed dates.",
    newSpan: next,
  };
}

/** Applies a schedule revision atomically: the visit and all its live reservations move together, or nothing changes. */
export async function applyScheduleRevision(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, plannedStart: zDate, plannedEnd: zDate, version: zVersion, changeReason: z.string().min(3).max(300) }), input);
  requireRole(ctx.actor, "manager", "applying schedule revisions");
  const proposal = await proposeScheduleRevision(ctx, d);
  if (proposal.conflicts.length) throw conflict("The new dates conflict with other bookings.", proposal.conflicts.map((c) => `${c.employee} is ${c.state} on ${c.visit}`));
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId, true);
    await ensureDraftRevision(q, ctx, v.plan_id, d.changeReason);
    await bumpVersion(q, "visit", d.visitId, d.version);
    const span = proposal.newSpan!;
    await q.query("update visit set planned_start = $2, planned_end = $3, departure_at = case when departure_at is null then null else $4::timestamptz end, return_at = case when return_at is null then null else $5::timestamptz end, updated_at = now() where id = $1",
      [d.visitId, d.plannedStart, d.plannedEnd, iso(span.start), iso(span.end)]);
    // The exclusion constraint rechecks every moved reservation inside this transaction.
    const moved = await q.query("update reservation set span = tstzrange($2::timestamptz,$3::timestamptz), version = version + 1 where visit_id = $1 and state in ('proposed','held','confirmed') returning id", [d.visitId, iso(span.start), iso(span.end)]);
    await audit(q, { actorId: ctx.actor.id, action: "revise_schedule", objectType: "visit", objectId: d.visitId, before: proposal.from, after: proposal.to, reason: d.changeReason, correlationId: ctx.correlationId });
    return { moved: moved.length, reapprovalRequired: true, lastDay: addDays(d.plannedEnd, 0) };
  });
}
