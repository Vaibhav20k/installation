/**
 * The five KRA workbook trackers as views over operational records (Installation_Head_KRA_Trackers.xlsx).
 * Combined workbook ID columns are split into typed IDs; derived columns are labelled as derived.
 */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { dayDiff, localDateOf, monthBounds, addDays, startOfLocalDay } from "@/lib/dates";
import { durationMinutes, intersect, subtract, union } from "@/domain/intervals";
import { scheduleIntervals, scheduledNetMinutes } from "@/domain/time";
import { employeeCalendar } from "../services/time";
import { projectFilter } from "./common";

const TZ = "Asia/Kolkata";
export interface Column { key: string; label: string; source: string }
export interface TrackerView { id: string; title: string; sourceRange: string; columns: Column[]; rows: Array<Record<string, string | number | null>>; notes: string[] }

const col = (key: string, label: string, source: string): Column => ({ key, label, source });
const yn = (b: boolean | null | undefined) => (b === null || b === undefined ? "Unknown" : b ? "Y" : "N");
const INSTALLER_ROLES = ["carpenter", "senior_technician", "technician", "junior_technician", "stone_technician"];
const SUPPORT_ROLES = ["helper", "assistant_technician"];

export async function installationTracker(q: Queryable, actor: Actor, opts: { projectId?: string }, now: number): Promise<TrackerView> {
  const f = projectFilter(actor, "p", 1);
  const params = [...f.params];
  let where = f.sql;
  if (opts.projectId) { params.push(opts.projectId); where += ` and p.id = $${params.length}`; }
  const orders = await q.query<{
    order_id: string; order_bid: string; status: string; project_bid: string; customer_bid: string; city: string; area: string | null; area_unit: string | null; promised: string | null;
    complexity: string | null; baseline: { visits: Array<{ orders: string[]; plannedStart: string | null; plannedEnd: string | null }> } | null;
    current_start: string | null; current_end: string | null; actual_start: number | null; signed_on: string | null; remaining: string;
    delays: string | null; functions: string | null; next_action: string | null; owner: string | null; due: string | null; signoff: boolean | null;
  }>(
    `select o.id order_id, o.business_id order_bid, o.status, p.business_id project_bid, c.business_id customer_bid, p.city, p.kitchen_floor_area::text area, p.kitchen_floor_area_unit area_unit,
       o.promised_completion::text promised,
       (select string_agg(distinct sr.source_complexity_label, ', ') from skill_requirement sr join visit_order vo on vo.visit_id = sr.visit_id where vo.order_id = o.id) complexity,
       (select r.snapshot from plan_revision r join plan pl on pl.baseline_revision_id = r.id join visit v on v.plan_id = pl.id join visit_order vo on vo.visit_id = v.id where vo.order_id = o.id limit 1) baseline,
       (select min(v.planned_start)::text from visit v join visit_order vo on vo.visit_id = v.id where vo.order_id = o.id and v.exec_status <> 'cancelled') current_start,
       (select max(v.planned_end)::text from visit v join visit_order vo on vo.visit_id = v.id where vo.order_id = o.id and v.exec_status <> 'cancelled') current_end,
       (select min(lower(t.span)) from time_entry t join visit_order vo on vo.visit_id = t.visit_id where vo.order_id = o.id and t.is_current and t.state = 'accepted' and t.activity in ('installation','additional','rework')) actual_start,
       (select max(a.accepted_on)::text from acceptance a join visit_order vo on vo.visit_id = a.visit_id where vo.order_id = o.id and a.signed_off) signed_on,
       (select coalesce(sum(greatest(t.required_quantity - coalesce((select sum(pe.quantity_delta) from progress_event pe join visit_task vt on vt.id = pe.visit_task_id where vt.task_id = t.id and vt.kind = 'original' and pe.accepted), 0), 0)), 0)::text
          from installation_task t join component co on co.id = t.component_id join order_item oi on oi.id = co.order_item_id where oi.order_id = o.id) remaining,
       (select string_agg(distinct d.cause, ', ') from delay_event d join visit_order vo on vo.visit_id = d.visit_id where vo.order_id = o.id) delays,
       (select string_agg(distinct d.responsible_function, ', ') from delay_event d join visit_order vo on vo.visit_id = d.visit_id where vo.order_id = o.id) functions,
       i.next_action, ie.name owner, i.due_date::text due,
       (select bool_or(a.signed_off) from acceptance a join visit_order vo on vo.visit_id = a.visit_id where vo.order_id = o.id) signoff
     from sales_order o join project p on p.id = o.project_id join customer c on c.id = p.customer_id
     left join lateral (select next_action, owner_id, due_date from issue where order_id = o.id and status <> 'closed' order by due_date nulls last limit 1) i on true
     left join employee ie on ie.id = i.owner_id
     where ${where} order by o.business_id`, params);
  const today = localDateOf(now, TZ);
  const rows = orders.map((o) => {
    const bv = (o.baseline?.visits ?? []).filter((v) => v.orders.includes(o.order_bid));
    const bStart = bv.map((v) => v.plannedStart).filter(Boolean).sort()[0] ?? null;
    const bEnd = bv.map((v) => v.plannedEnd).filter(Boolean).sort().at(-1) ?? null;
    const aStart = o.actual_start ? localDateOf(o.actual_start, TZ) : null;
    const finished = Number(o.remaining) === 0 && o.signed_on ? o.signed_on : null;
    const planned = bStart && bEnd ? dayDiff(bStart, bEnd) + 1 : null;
    const actual = aStart ? dayDiff(aStart, finished ?? today) + 1 : null;
    return {
      orderId: o.order_bid, projectId: o.project_bid, customerId: o.customer_bid, site: o.city, location: o.city,
      kitchenArea: o.area ? `${Number(o.area)} ${o.area_unit ?? ""}`.trim() : null, areaMeaning: "Kitchen floor area (not installed surface area)",
      complexity: o.complexity ?? "Not recorded",
      plannedStart: bStart, plannedCompletion: bEnd, currentPlannedCompletion: o.current_end, actualStart: aStart, actualCompletion: finished,
      status: finished ? "Completed" : aStart ? "In progress" : o.status,
      daysPlanned: planned, daysActual: actual, daysActualBasis: finished ? "final" : actual === null ? null : `as of ${today}`,
      daysVariance: planned !== null && actual !== null && finished ? actual - planned : null,
      lateness: finished && o.promised ? dayDiff(o.promised, finished) : null,
      delayReason: o.delays, responsibleFunction: o.functions, nextAction: o.next_action, actionOwner: o.owner, dueDate: o.due, customerSignOff: yn(o.signoff),
    };
  });
  return {
    id: "installation", title: "Installation Tracker", sourceRange: "Installation Tracker!A1:S1",
    columns: [
      col("orderId", "Order ID", "Order / Project ID (split)"), col("projectId", "Project ID", "Order / Project ID (split)"), col("customerId", "Customer ID", "Customer / Site (split)"),
      col("site", "Site", "Customer / Site (split)"), col("location", "Location", "Location"), col("kitchenArea", "Kitchen area", "Kitchen Area (sq. ft.)"), col("areaMeaning", "Area meaning", "derived"),
      col("complexity", "Complexity / type", "Complexity / Type"), col("plannedStart", "Planned start (baseline)", "Planned Start"), col("plannedCompletion", "Planned completion (baseline)", "Planned Completion"),
      col("currentPlannedCompletion", "Planned completion (current)", "derived"), col("actualStart", "Actual start", "Actual Start"), col("actualCompletion", "Actual completion", "Actual Completion"),
      col("status", "Status", "Status"), col("daysPlanned", "Days planned", "Days Planned"), col("daysActual", "Days actual", "Days Actual"), col("daysActualBasis", "Actual basis", "derived"),
      col("daysVariance", "Days variance", "Days Variance"), col("lateness", "Days late vs promised", "derived"), col("delayReason", "Delay reason", "Delay Reason"),
      col("responsibleFunction", "Responsible function", "Responsible Function"), col("nextAction", "Next action", "Next Action"), col("actionOwner", "Action owner", "Action Owner"),
      col("dueDate", "Due date", "Due Date"), col("customerSignOff", "Customer sign-off", "Customer Sign-off"),
    ],
    rows,
    notes: ["Durations are inclusive calendar days in Asia/Kolkata.", "Days variance is shown only for finished orders; in-progress durations are as-of elapsed values.", "Lateness compares completion with the promised date and differs from duration variance."],
  };
}

export async function manpowerTracker(q: Queryable, actor: Actor, opts: { month: string; projectId?: string }): Promise<TrackerView> {
  const { first, last } = monthBounds(opts.month);
  const f = projectFilter(actor, "p", 1);
  const params = [...f.params];
  let where = f.sql;
  if (opts.projectId) { params.push(opts.projectId); where += ` and p.id = $${params.length}`; }
  params.push(first, last);
  const visits = await q.query<{ id: string; business_id: string; project_bid: string; city: string; planned_start: string; planned_end: string; supervisor: string | null; orders: string | null }>(
    `select v.id, v.business_id, p.business_id project_bid, p.city, v.planned_start::text, v.planned_end::text, cr.name supervisor,
       (select string_agg(o.business_id, ', ') from visit_order vo join sales_order o on o.id = vo.order_id where vo.visit_id = v.id) orders
     from visit v join project p on p.id = v.project_id join plan pl on pl.id = v.plan_id left join employee cr on cr.id = pl.created_by
     where ${where} and v.exec_status in ('scheduled','in_progress','completed','closed') and v.planned_start <= $${params.length}::date and v.planned_end >= $${params.length - 1}::date
     order by v.planned_start`, params);
  const rows: TrackerView["rows"] = [];
  for (const v of visits) {
    const staff = await q.query<{ employee_id: string; job_role: string }>(
      "select r.employee_id, e.job_role from reservation r join employee e on e.id = r.employee_id where r.visit_id = $1 and r.state in ('confirmed','released')", [v.id]);
    const entries = await q.query<{ id: string; employee_id: string; activity: string; s: number; e: number }>(
      "select id, employee_id, activity, lower(span) s, upper(span) e from time_entry where visit_id = $1 and is_current and state = 'accepted'", [v.id]);
    const breaks = entries.length ? await q.query<{ time_entry_id: string; s: number; e: number }>("select time_entry_id, lower(span) s, upper(span) e from break_interval where time_entry_id = any($1::uuid[])", [entries.map((e) => e.id)]) : [];
    const ot = await q.query<{ s: number; e: number }>("select lower(a.span) s, upper(a.span) e from reconciliation_allocation a join time_entry t on t.id = a.time_entry_id where t.visit_id = $1 and a.active", [v.id]);
    for (let d = v.planned_start > first ? v.planned_start : first; d <= (v.planned_end < last ? v.planned_end : last); d = addDays(d, 1)) {
      const day = { start: startOfLocalDay(d, TZ), end: startOfLocalDay(addDays(d, 1), TZ) };
      let planned = 0, work = 0, outside = 0, idle = 0;
      for (const s of staff) {
        const cal = await employeeCalendar(q, s.employee_id);
        const sched = scheduleIntervals(cal, d, d);
        planned += scheduledNetMinutes(cal, [d]);
        for (const e of entries.filter((x) => x.employee_id === s.employee_id)) {
          const net = subtract(intersect([{ start: e.s, end: e.e }], [day]), breaks.filter((b) => b.time_entry_id === e.id).map((b) => ({ start: b.s, end: b.e })));
          if (["installation", "additional", "rework"].includes(e.activity)) { work += durationMinutes(net); outside += durationMinutes(subtract(net, sched)); }
          if (e.activity === "waiting") idle += durationMinutes(net);
        }
      }
      const output = await q.query<{ unit: string; quantity_kind: string; qty: string }>(
        `select t.unit, t.quantity_kind, sum(pe.quantity_delta)::text qty from progress_event pe join visit_task vt on vt.id = pe.visit_task_id join installation_task t on t.id = vt.task_id
         where vt.visit_id = $1 and pe.accepted and pe.at >= $2::timestamptz and pe.at < $3::timestamptz group by 1, 2`, [v.id, new Date(day.start).toISOString(), new Date(day.end).toISOString()]);
      const [kitchens] = await q.query<{ n: number }>(
        "select count(distinct a.order_item_id)::int n from acceptance a join order_item oi on oi.id = a.order_item_id where a.visit_id = $1 and a.signed_off and a.accepted_on = $2 and oi.product_type = 'kitchen'", [v.id, d]);
      const reasons = await q.query<{ cause: string }>("select distinct cause from delay_event where visit_id = $1 and span && tstzrange($2::timestamptz,$3::timestamptz)", [v.id, new Date(day.start).toISOString(), new Date(day.end).toISOString()]);
      const otMin = durationMinutes(intersect(union(ot.map((o) => ({ start: o.s, end: o.e }))), [day]));
      const single = output.length === 1 && work > 0 ? `${(Number(output[0]!.qty) / (work / 60)).toFixed(2)} ${output[0]!.unit}/person-hour (${output[0]!.quantity_kind})` : output.length > 1 ? "Mixed quantity kinds; not combined" : "N/A";
      rows.push({
        date: d, site: v.city, projectId: v.project_bid, orderIds: v.orders, visitId: v.business_id, supervisor: v.supervisor,
        installers: staff.filter((s) => INSTALLER_ROLES.includes(s.job_role)).length, support: staff.filter((s) => SUPPORT_ROLES.includes(s.job_role)).length,
        plannedHours: +(planned / 60).toFixed(2), actualHours: +(work / 60).toFixed(2), outsideScheduleHours: +(outside / 60).toFixed(2), approvedOtHours: +(otMin / 60).toFixed(2),
        output: output.map((o) => `${Number(o.qty)} ${o.unit} ${o.quantity_kind}`).join("; ") || null, kitchensCompleted: kitchens!.n,
        idleHours: +(idle / 60).toFixed(2), idleReason: reasons.map((r) => r.cause).join(", ") || null, productivity: single, notes: null,
      });
    }
  }
  return {
    id: "manpower", title: "Manpower Productivity", sourceRange: "Manpower Productivity!A1:O1",
    columns: [
      col("date", "Date", "Date"), col("site", "Location / site", "Location / Site"), col("projectId", "Project ID", "Order / Project ID (split)"), col("orderIds", "Order IDs", "Order / Project ID (split)"),
      col("visitId", "Visit ID", "derived"), col("supervisor", "Team / supervisor", "Team / Supervisor"), col("installers", "Installers assigned", "Installers Assigned"), col("support", "Support staff", "Support Staff"),
      col("plannedHours", "Planned work hours", "Planned Work Hours"), col("actualHours", "Actual work hours (accepted)", "Actual Work Hours"),
      col("outsideScheduleHours", "Outside-schedule hours", "Overtime Hours (split)"), col("approvedOtHours", "Approved overtime hours (final months)", "Overtime Hours (split)"),
      col("output", "Accepted output", "Output (sq. ft. or agreed unit)"), col("kitchensCompleted", "Kitchens completed", "Kitchens Completed"), col("idleHours", "Waiting / idle hours", "Idle Hours"),
      col("idleReason", "Reason for idle time", "Reason for Idle Time"), col("productivity", "Productivity", "Productivity Metric"), col("notes", "Action / notes", "Action / Notes"),
    ],
    rows,
    notes: ["Hours are summed person-hours from accepted entries, not elapsed team clock time.", "Installers: carpenter, senior/technician/junior technician, stone technician. Support: helper, assistant technician.", "Outside-schedule hours are not overtime approval; approved overtime comes only from finalized monthly reconciliation."],
  };
}

export async function issuesTracker(q: Queryable, actor: Actor, opts: { projectId?: string; status?: string }): Promise<TrackerView> {
  const f = projectFilter(actor, "p", 1);
  const params = [...f.params];
  let where = f.sql;
  if (opts.projectId) { params.push(opts.projectId); where += ` and p.id = $${params.length}`; }
  if (opts.status) { params.push(opts.status); where += ` and i.status = $${params.length}`; }
  const rows = await q.query<Record<string, string | number | null>>(
    `select i.business_id "issueId", i.raised_on::text "dateRaised", o.business_id "orderId", p.business_id "projectId", i.function, i.category, i.impact,
       i.delay_days::float "delayDays", i.estimated_cost_minor "estimatedCostMinor", i.description, ow.name owner, es.name "escalatedTo", i.next_action "nextAction",
       i.due_date::text "dueDate", i.status, i.closed_on::text "closureDate", case when i.recurrence_of is null then 'N' else 'Y' end "repeatIssue", i.closure_evidence "closureEvidence",
       case when i.status <> 'closed' and i.due_date < current_date then 'Overdue' else '' end overdue
     from issue i join project p on p.id = i.project_id left join sales_order o on o.id = i.order_id left join employee ow on ow.id = i.owner_id left join employee es on es.id = i.escalation_owner_id
     where ${where} order by i.raised_on desc`, params);
  return {
    id: "issues", title: "Cross-Functional Issues", sourceRange: "Cross-Functional Issues!A1:P1",
    columns: [
      col("issueId", "Issue ID", "Issue ID"), col("dateRaised", "Date raised", "Date Raised"), col("orderId", "Order ID", "Order / Project ID (split)"), col("projectId", "Project ID", "Order / Project ID (split)"),
      col("function", "Function", "Function (Factory/Purchase/Logistics/Services/Site/Installation)"), col("category", "Category", "Issue Category"), col("impact", "Impact", "Impact on Installation"),
      col("delayDays", "Delay days", "Delay Days"), col("estimatedCostMinor", "Estimated added cost (paise)", "Estimated Additional Cost (₹)"), col("description", "Description", "Issue Description"),
      col("owner", "Responsible owner", "Responsible Owner"), col("escalatedTo", "Escalated to", "Escalated To"), col("nextAction", "Resolution / next action", "Resolution / Next Action"),
      col("dueDate", "Due date", "Due Date"), col("status", "Status", "Status"), col("overdue", "Overdue", "derived"), col("closureDate", "Closure date", "Closure Date"),
      col("closureEvidence", "Closure evidence", "derived"), col("repeatIssue", "Repeat issue?", "Repeat Issue? (Y/N)"),
    ],
    rows,
    notes: ["Summed issue delay days are not project lateness; overlapping causes are not additive."],
  };
}

export { yn };
