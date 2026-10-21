/**
 * Timesheet, mobile daily-work and approval-queue reads.
 * Recorded activity, outside-schedule time, eligibility and monthly settlement are kept separate.
 */
import type { Queryable } from "../db/client";
import { requireEmployeeScope, type Actor } from "../auth/permissions";
import { addDays, localDateOf, monthOf, startOfLocalDay } from "@/lib/dates";
import { durationMinutes, intersect, subtract } from "@/domain/intervals";
import { scheduleIntervals } from "@/domain/time";
import { employeeCalendar } from "../services/time";
import { gatherMonth } from "../services/reconciliation";
import { employeeFilter, projectFilter } from "./common";

export async function timesheet(q: Queryable, actor: Actor, employeeId: string, opts: { from: string; days: number }, now: number) {
  await requireEmployeeScope(q, actor, employeeId);
  const cal = await employeeCalendar(q, employeeId);
  const tz = cal.timezone;
  const start = startOfLocalDay(opts.from, tz);
  const end = startOfLocalDay(addDays(opts.from, opts.days), tz);
  const range = [new Date(start).toISOString(), new Date(end).toISOString()];
  const entries = await q.query<{
    id: string; activity: string; state: string; start: number; end: number; project: string | null; project_id: string | null; visit: string | null; visit_id: string | null; overhead_category: string | null;
    is_exception: boolean; exception_resolved: boolean; note: string | null; review_note: string | null; revision_no: number; supersedes_id: string | null; version: number; first_submitted_at: number | null;
  }>(
    `select t.id, t.activity, t.state, lower(t.span) "start", upper(t.span) "end", p.name project, t.project_id, v.business_id visit, t.visit_id, t.overhead_category,
       t.is_exception, t.exception_resolved, t.note, t.review_note, t.revision_no, t.supersedes_id, t.version, t.first_submitted_at
     from time_entry t left join project p on p.id = t.project_id left join visit v on v.id = t.visit_id
     where t.employee_id = $1 and t.is_current and t.state <> 'voided' and t.span && tstzrange($2::timestamptz,$3::timestamptz) order by lower(t.span)`, [employeeId, ...range]);
  const ids = entries.map((e) => e.id);
  const breaks = ids.length ? await q.query<{ time_entry_id: string; start: number; end: number }>("select time_entry_id, lower(span) \"start\", upper(span) \"end\" from break_interval where time_entry_id = any($1::uuid[])", [ids]) : [];
  const requests = ids.length ? await q.query<{ id: string; time_entry_id: string; start: number; end: number; claimed_reason: string; verified_reason: string | null; decision: string; decision_explanation: string | null; reviewer: string | null }>(
    `select o.id, o.time_entry_id, lower(o.span) "start", upper(o.span) "end", o.claimed_reason, o.verified_reason, o.decision, o.decision_explanation, e.name reviewer
     from ot_request o left join employee e on e.id = o.reviewer_id where o.time_entry_id = any($1::uuid[]) order by lower(o.span)`, [ids]) : [];
  const history = ids.length ? await q.query<{ id: string; supersedes_id: string | null; state: string; revision_no: number; start: number; end: number; review_note: string | null }>(
    `with recursive chain(id) as (select supersedes_id from time_entry where id = any($1::uuid[]) and supersedes_id is not null
       union select t.supersedes_id from time_entry t join chain c on t.id = c.id where t.supersedes_id is not null)
     select t.id, t.supersedes_id, t.state, t.revision_no, lower(t.span) "start", upper(t.span) "end", t.review_note from time_entry t where t.id in (select id from chain)`, [ids]) : [];
  const sched = scheduleIntervals(cal, addDays(opts.from, -1), addDays(opts.from, opts.days));
  const rows = entries.map((e) => {
    const br = breaks.filter((b) => b.time_entry_id === e.id).map((b) => ({ start: b.start, end: b.end }));
    const net = subtract([{ start: e.start, end: e.end }], br);
    const work = ["installation", "additional", "rework"].includes(e.activity);
    return {
      ...e, breaks: br, netMinutes: durationMinutes(net),
      withinScheduleMinutes: work ? durationMinutes(intersect(net, sched)) : 0,
      outsideScheduleMinutes: work ? durationMinutes(subtract(net, sched)) : 0,
      date: localDateOf(e.start, tz), crossesMidnight: localDateOf(e.start, tz) !== localDateOf(e.end - 1, tz),
      requests: requests.filter((r) => r.time_entry_id === e.id),
    };
  });
  // Expected work from assignments is shown as a plan only; it never becomes actual attendance.
  const expected = await q.query<{ visit: string; project: string; start: number; end: number; state: string }>(
    `select v.business_id visit, p.name project, lower(r.span) "start", upper(r.span) "end", r.state from reservation r join visit v on v.id = r.visit_id join project p on p.id = v.project_id
     where r.employee_id = $1 and r.state in ('confirmed','held') and r.span && tstzrange($2::timestamptz,$3::timestamptz) order by lower(r.span)`, [employeeId, ...range]);
  const month = monthOf(opts.from);
  const recon = await gatherMonth(q, employeeId, month, now);
  const [stored] = await q.query<{ state: string; revision: number }>("select state, revision from month_reconciliation where employee_id = $1 and month = $2::date order by revision desc limit 1", [employeeId, `${month}-01`]);
  return { timezone: tz, entries: rows, expected, history, month, reconciliation: recon.result, missingDates: recon.missingDates, storedState: stored ?? null };
}

/** Today's work for the acting user: the confirmed visit covering today, its tasks and own entries. */
export async function myDay(q: Queryable, actor: Actor, now: number) {
  const cal = await employeeCalendar(q, actor.id);
  const today = localDateOf(now, cal.timezone);
  const dayStart = startOfLocalDay(today, cal.timezone), dayEnd = startOfLocalDay(addDays(today, 1), cal.timezone);
  const range = [new Date(dayStart).toISOString(), new Date(dayEnd).toISOString()];
  const [visit] = await q.query<{ id: string; business_id: string; exec_status: string; project: string; project_id: string; site_address: string; visit_type: string; version: number }>(
    `select v.id, v.business_id, v.exec_status, p.name project, p.id project_id, p.site_address, v.visit_type, v.version from reservation r join visit v on v.id = r.visit_id join project p on p.id = v.project_id
     where r.employee_id = $1 and r.state = 'confirmed' and r.span && tstzrange($2::timestamptz,$3::timestamptz) order by lower(r.span) limit 1`, [actor.id, ...range]);
  const tasks = visit ? await q.query<{ id: string; task: string; component: string; activity: string; unit: string; scoped: string; accepted: string; pending: string; target: string | null; kind: string }>(
    `select vt.id, t.business_id task, c.name component, t.activity, t.unit, vt.scoped_quantity::text scoped, vt.kind,
       coalesce((select sum(quantity_delta) from progress_event pe where pe.visit_task_id = vt.id and pe.accepted), 0)::text accepted,
       coalesce((select sum(quantity_delta) from progress_event pe where pe.visit_task_id = vt.id and not pe.accepted), 0)::text pending,
       (select target_quantity::text from daily_target d where d.visit_task_id = vt.id and d.plan_date = $2 and d.is_current) target
     from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id where vt.visit_id = $1 and vt.status = 'active' order by c.business_id, t.step_order`, [visit.id, today]) : [];
  const entries = await q.query<{ id: string; activity: string; state: string; start: number; end: number; version: number }>(
    "select id, activity, state, lower(span) \"start\", upper(span) \"end\", version from time_entry where employee_id = $1 and is_current and state <> 'voided' and span && tstzrange($2::timestamptz,$3::timestamptz) order by lower(span)", [actor.id, ...range]);
  return { today, timezone: cal.timezone, visit: visit ?? null, tasks, entries };
}

export async function approvalQueues(q: Queryable, actor: Actor) {
  const pf = projectFilter(actor, "p", 1);
  const plans = await q.query<{ plan_id: string; plan: string; project: string; project_id: string; revision_no: number; submitted_by: string | null; submitted_at: number | null; change_reason: string | null; submitted_by_id: string | null }>(
    `select pl.id plan_id, pl.business_id plan, p.name project, p.id project_id, r.revision_no, e.name submitted_by, r.submitted_at, r.change_reason, r.submitted_by submitted_by_id
     from plan_revision r join plan pl on pl.id = r.plan_id join project p on p.id = pl.project_id left join employee e on e.id = r.submitted_by
     where r.approval_state = 'submitted' and ${pf.sql} order by r.submitted_at`, pf.params);
  const ef = await employeeFilter(q, actor, "t.employee_id", 1);
  const time = await q.query<{ id: string; employee: string; employee_id: string; activity: string; start: number; end: number; project: string | null; is_exception: boolean; note: string | null; exception_note: string | null }>(
    `select t.id, e.name employee, e.id employee_id, t.activity, lower(t.span) "start", upper(t.span) "end", p.name project, t.is_exception, t.note, t.exception_note
     from time_entry t join employee e on e.id = t.employee_id left join project p on p.id = t.project_id
     where t.state = 'submitted' and t.is_current and ${ef.sql} order by lower(t.span) limit 200`, ef.params);
  const of = await employeeFilter(q, actor, "o.employee_id", 1);
  const overtime = await q.query<{ id: string; employee: string; employee_id: string; start: number; end: number; claimed_reason: string; entry_state: string; activity: string; visit_id: string | null }>(
    `select o.id, e.name employee, e.id employee_id, lower(o.span) "start", upper(o.span) "end", o.claimed_reason, t.state entry_state, t.activity, t.visit_id
     from ot_request o join employee e on e.id = o.employee_id join time_entry t on t.id = o.time_entry_id
     where o.decision in ('requested','pending_policy') and t.is_current and ${of.sql} order by lower(o.span)`, of.params);
  const xf = projectFilter(actor, "p", 1);
  const expenses = await q.query<{ id: string; business_id: string; claimant: string; claimant_id: string; project: string; category: string; amount_minor: number; currency: string; incurred_on: string; is_credit: boolean; receipt_ref: string | null }>(
    `select x.id, x.business_id, e.name claimant, e.id claimant_id, p.name project, x.category, x.amount_minor, x.currency, x.incurred_on::text, x.is_credit, x.receipt_ref
     from expense x join employee e on e.id = x.claimant_id join project p on p.id = x.project_id where x.state = 'submitted' and ${xf.sql} order by x.incurred_on`, xf.params);
  return { plans, time, overtime, expenses };
}
