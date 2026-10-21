/**
 * Planning helpers shared by planning, booking and execution services.
 */
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { conflict, validation } from "../errors";
import { addDays, dayDiff, localDateOf, startOfLocalDay } from "@/lib/dates";
import { Dec } from "@/domain/decimal";
import { estimateFromRate, type ProductivityRate } from "@/domain/effort";
import type { Ctx } from "./context";

export interface VisitRow {
  id: string; business_id: string; project_id: string; plan_id: string; sequence: number; visit_type: string; exec_status: string;
  planned_start: string | null; planned_end: string | null; departure_at: number | null; return_at: number | null;
  team_size: number; continuity: "none" | "preferred" | "mandatory"; preferred_team_id: string | null; outstation: boolean;
  timezone: string; version: number; repeat_reason: string | null;
}

export const VISIT_SELECT = `select v.id, v.business_id, v.project_id, v.plan_id, v.sequence, v.visit_type, v.exec_status, v.planned_start::text planned_start,
  v.planned_end::text planned_end, v.departure_at, v.return_at, v.team_size, v.continuity, v.preferred_team_id, v.outstation, p.timezone, v.version, v.repeat_reason
  from visit v join project p on p.id = v.project_id`;

export async function loadVisit(q: Queryable, visitId: string, lock = false): Promise<VisitRow> {
  const [v] = await q.query<VisitRow>(`${VISIT_SELECT} where v.id = $1${lock ? " for update of v" : ""}`, [visitId]);
  if (!v) throw validation("Visit not found");
  return v;
}

/** Reservation span: itinerary when outstation/known, otherwise whole local work dates. */
export function visitSpan(v: Pick<VisitRow, "planned_start" | "planned_end" | "departure_at" | "return_at" | "timezone">) {
  if (v.departure_at && v.return_at) return { start: v.departure_at, end: v.return_at };
  if (!v.planned_start || !v.planned_end) return null;
  return { start: startOfLocalDay(v.planned_start, v.timezone), end: startOfLocalDay(addDays(v.planned_end, 1), v.timezone) };
}

export function spanDayCount(span: { start: number; end: number }, tz: string) {
  return dayDiff(localDateOf(span.start, tz), localDateOf(span.end - 1, tz)) + 1;
}

interface RevisionRow { id: string; revision_no: number; approval_state: string; snapshot: unknown }

export async function latestRevision(q: Queryable, planId: string): Promise<RevisionRow> {
  const [r] = await q.query<RevisionRow>(
    "select id, revision_no, approval_state, snapshot from plan_revision where plan_id = $1 order by revision_no desc limit 1", [planId]);
  if (!r) throw validation("Plan has no revision");
  return r;
}

/**
 * Plan edits need an open draft revision. An approved or returned revision is never edited:
 * a new draft revision (with a change reason) is created instead, which triggers reapproval.
 */
export async function ensureDraftRevision(q: Queryable, ctx: Ctx, planId: string, changeReason?: string) {
  const [plan] = await q.query<{ status: string }>("select status from plan where id = $1 for update", [planId]);
  if (!plan) throw validation("Plan not found");
  if (plan.status !== "active") throw conflict(`This plan is ${plan.status}; it cannot be edited.`);
  const latest = await latestRevision(q, planId);
  if (latest.approval_state === "draft") return latest;
  if (latest.approval_state === "submitted") throw conflict("This plan revision is awaiting review. Wait for the decision before editing.");
  if (!changeReason || changeReason.trim().length < 3) {
    throw validation(`Revision ${latest.revision_no} is ${latest.approval_state}. Give a change reason to start revision ${latest.revision_no + 1}.`, ["changeReason: required"]);
  }
  const [r] = await q.query<RevisionRow>(
    `insert into plan_revision(plan_id, revision_no, approval_state, snapshot, change_reason, created_by)
     values ($1,$2,'draft',$3,$4,$5) returning id, revision_no, approval_state, snapshot`,
    [planId, latest.revision_no + 1, JSON.stringify(latest.snapshot), changeReason.trim(), ctx.actor.id]);
  await audit(q, { actorId: ctx.actor.id, action: "create_revision", objectType: "plan", objectId: planId, after: { revision: r!.revision_no }, reason: changeReason, correlationId: ctx.correlationId });
  return r!;
}

/** Best rate for a task: an approved version if one is effective, otherwise the latest non-approved (provisional). */
export async function rateFor(q: Queryable, task: { activity: string; quantity_kind: string; unit: string }, onDate: string | null) {
  const rows = await q.query<{ id: string; business_id: string; version: number; activity: string; quantity_kind: string; unit: string; basis: ProductivityRate["basis"]; value: string; crew_size: number | null; net_day_minutes: number | null; status: ProductivityRate["status"] }>(
    `select id, business_id, version, activity, quantity_kind, unit, basis, value, crew_size, net_day_minutes, status from productivity_rate
     where activity = $1 and quantity_kind = $2 and unit = $3 and effective_from <= coalesce($4::date, current_date)
       and (effective_to is null or effective_to >= coalesce($4::date, current_date))
     order by (status = 'approved') desc, version desc limit 1`,
    [task.activity, task.quantity_kind, task.unit, onDate]);
  const r = rows[0];
  if (!r) return null;
  return { ...r, label: `${r.business_id} v${r.version}`, rate: { id: r.business_id, activity: r.activity, quantityKind: r.quantity_kind, unit: r.unit, basis: r.basis, value: r.value, crewSize: r.crew_size, netDayMinutes: r.net_day_minutes, status: r.status, version: r.version } satisfies ProductivityRate };
}

export interface VisitEstimateLine {
  visitTaskId: string; taskBusinessId: string; component: string; activity: string; quantity: string; unit: string; quantityKind: string;
  rateId: string | null; provisional: boolean; personMinutes: string | null; teamDays: string | null; personDays: string | null; issues: string[]; explanation: string[];
}

export async function estimateVisitScope(q: Queryable, visitId: string) {
  const v = await loadVisit(q, visitId);
  const tasks = await q.query<{ vt_id: string; scoped_quantity: string; business_id: string; activity: string; quantity_kind: string; unit: string; component: string }>(
    `select vt.id vt_id, vt.scoped_quantity, t.business_id, t.activity, t.quantity_kind, t.unit, c.name component
     from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id
     where vt.visit_id = $1 and vt.status = 'active' order by c.business_id, t.step_order`, [visitId]);
  const lines: VisitEstimateLine[] = [];
  let total = Dec.zero;
  let complete = true;
  for (const t of tasks) {
    const found = await rateFor(q, t, v.planned_start);
    if (!found) {
      complete = false;
      lines.push({ visitTaskId: t.vt_id, taskBusinessId: t.business_id, component: t.component, activity: t.activity, quantity: t.scoped_quantity, unit: t.unit, quantityKind: t.quantity_kind, rateId: null, provisional: true, personMinutes: null, teamDays: null, personDays: null, issues: ["No productivity rate exists for this activity, quantity kind and unit."], explanation: [] });
      continue;
    }
    const est = estimateFromRate({ value: t.scoped_quantity, unit: t.unit, quantityKind: t.quantity_kind }, found.rate);
    if (est.ok && est.personMinutes) total = total.add(est.personMinutes); else complete = false;
    lines.push({
      visitTaskId: t.vt_id, taskBusinessId: t.business_id, component: t.component, activity: t.activity, quantity: t.scoped_quantity, unit: t.unit, quantityKind: t.quantity_kind,
      rateId: found.label, provisional: est.provisional, personMinutes: est.personMinutes ?? null, teamDays: est.teamDays ?? null, personDays: est.personDays ?? null,
      issues: est.issues.map((i) => i.message), explanation: est.explanation,
    });
  }
  return { lines, totalPersonMinutes: total.toString(), complete, provisional: lines.some((l) => l.provisional) };
}

/** Builds the reproducible revision snapshot: scope, staffing, dates, requirements, rates, estimates, clearances. */
export async function buildSnapshot(q: Queryable, planId: string) {
  const visits = await q.query<VisitRow>(`${VISIT_SELECT} where v.plan_id = $1 order by v.sequence`, [planId]);
  const out = [];
  for (const v of visits) {
    const scope = await q.query(`select vt.id, t.business_id task, vt.scoped_quantity, vt.kind, vt.status from visit_task vt join installation_task t on t.id = vt.task_id where vt.visit_id = $1 order by t.business_id`, [v.id]);
    const requirements = await q.query(`select s.code skill, r.min_level, r.headcount, r.mode, r.applies_to_roles, r.concurrency_group from skill_requirement r join skill s on s.id = r.skill_id where r.visit_id = $1 order by s.code`, [v.id]);
    const staffing = await q.query(`select e.business_id employee, r.role, r.state, lower(r.span) "from", upper(r.span) "to" from reservation r join employee e on e.id = r.employee_id where r.visit_id = $1 and r.state in ('proposed','held','confirmed') order by e.business_id`, [v.id]);
    const orders = await q.query(`select o.business_id from visit_order vo join sales_order o on o.id = vo.order_id where vo.visit_id = $1 order by 1`, [v.id]);
    const clearances = await q.query(`select gate, status, valid_until::text from clearance where visit_id = $1 order by gate`, [v.id]);
    const estimate = await estimateVisitScope(q, v.id);
    out.push({
      visitId: v.id, businessId: v.business_id, sequence: v.sequence, type: v.visit_type, plannedStart: v.planned_start, plannedEnd: v.planned_end,
      departureAt: v.departure_at, returnAt: v.return_at, teamSize: v.team_size, continuity: v.continuity, outstation: v.outstation,
      orders: orders.map((o) => (o as { business_id: string }).business_id), scope, requirements, staffing, clearances,
      estimate: { totalPersonMinutes: estimate.totalPersonMinutes, provisional: estimate.provisional, complete: estimate.complete, lines: estimate.lines.map((l) => ({ task: l.taskBusinessId, rate: l.rateId, personMinutes: l.personMinutes, teamDays: l.teamDays })) },
    });
  }
  return { capturedAt: new Date().toISOString(), visits: out };
}
