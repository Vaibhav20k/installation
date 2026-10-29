/**
 * Operational dashboard. Every figure has a definition and a drill-down; totals are derived from
 * the same scoped records as the detail views, never stored as editable copies.
 */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { addDays, localDateOf, monthBounds, startOfLocalDay } from "@/lib/dates";
import { durationMinutes, intersect, localMonthInterval, subtract, union, type Interval } from "@/domain/intervals";
import { formatMoney, sumMinor, varianceSummary } from "@/domain/expenses";
import { planningSheet } from "./planning";
import { approvalQueues } from "./time";
import { employeeFilter, projectFilter } from "./common";

const TZ = "Asia/Kolkata";

export interface Metric { id: string; label: string; value: string; definition: string; href: string; tone?: "ok" | "warn" | "bad" | "neutral" }

export async function expenseSummary(q: Queryable, actor: Actor, opts: { projectId?: string } = {}) {
  const f = projectFilter(actor, "p", 1);
  const params = [...f.params];
  let where = f.sql;
  if (opts.projectId) { params.push(opts.projectId); where += ` and p.id = $${params.length}`; }
  const rows = await q.query<{ id: string; business_id: string; name: string; estimate: number | null; budget: number | null; approved: number; credits: number; submitted: number; rejected: number }>(
    `select p.id, p.business_id, p.name,
       (select sum(el.amount_minor)::bigint from estimate es join estimate_line el on el.estimate_id = es.id
          where es.project_id = p.id and es.version = (select max(version) from estimate e2 where e2.business_id = es.business_id)) estimate,
       (select approved_total_minor from budget b where b.project_id = p.id and b.is_current) budget,
       coalesce((select sum(amount_minor) from expense x where x.project_id = p.id and x.state = 'approved' and not x.is_credit), 0)::bigint approved,
       coalesce((select sum(amount_minor) from expense x where x.project_id = p.id and x.state = 'approved' and x.is_credit), 0)::bigint credits,
       coalesce((select sum(amount_minor) from expense x where x.project_id = p.id and x.state = 'submitted' and not x.is_credit), 0)::bigint submitted,
       coalesce((select sum(amount_minor) from expense x where x.project_id = p.id and x.state = 'rejected'), 0)::bigint rejected
     from project p where ${where} order by p.business_id`, params);
  return rows.map((r) => {
    const actual = r.approved - r.credits;
    return { ...r, actual, ...varianceSummary({ estimatedTotalMinor: r.estimate, approvedBudgetMinor: r.budget, approvedActualMinor: actual }) };
  });
}

/** Planned vs actual work and travel for the month, per visible employee population. */
export async function plannedVsActual(q: Queryable, actor: Actor, month: string, projectId?: string) {
  const iv = localMonthInterval(month, TZ);
  const range = [new Date(iv.start).toISOString(), new Date(iv.end).toISOString()];
  const ef = await employeeFilter(q, actor, "r.employee_id", 3);
  const params: unknown[] = [...range, ...ef.params];
  let projectSql = "";
  if (projectId) { params.push(projectId); projectSql = ` and v.project_id = $${params.length}`; }
  const res = await q.query<{ employee_id: string; s: number; e: number }>(
    `select r.employee_id, lower(r.span) s, upper(r.span) e from reservation r join visit v on v.id = r.visit_id
     where r.state in ('confirmed','released') and v.exec_status <> 'cancelled' and r.span && tstzrange($1::timestamptz,$2::timestamptz) and ${ef.sql}${projectSql}`, params);
  const tf = await employeeFilter(q, actor, "t.employee_id", 3);
  const tparams: unknown[] = [...range, ...tf.params];
  if (projectId) tparams.push(projectId);
  const entries = await q.query<{ id: string; employee_id: string; activity: string; s: number; e: number }>(
    `select t.id, t.employee_id, t.activity, lower(t.span) s, upper(t.span) e from time_entry t where t.is_current and t.state = 'accepted'
     and t.span && tstzrange($1::timestamptz,$2::timestamptz) and ${tf.sql}${projectId ? ` and t.project_id = $${tparams.length}` : ""}`, tparams);
  const breaks = entries.length ? await q.query<{ time_entry_id: string; s: number; e: number }>("select time_entry_id, lower(span) s, upper(span) e from break_interval where time_entry_id = any($1::uuid[])", [entries.map((e) => e.id)]) : [];
  const net = (kind: (a: string) => boolean) => {
    let m = 0;
    for (const e of entries.filter((x) => kind(x.activity))) {
      const br = breaks.filter((b) => b.time_entry_id === e.id).map((b) => ({ start: b.s, end: b.e }));
      m += durationMinutes(subtract(intersect([{ start: e.s, end: e.e }], [iv]), br));
    }
    return m;
  };
  const reservedMinutes = res.reduce((s, r) => s + durationMinutes(intersect([{ start: r.s, end: r.e }], [iv])), 0);
  return {
    reservedOccupancyMinutes: reservedMinutes,
    actualWorkMinutes: net((a) => ["installation", "additional", "rework"].includes(a)),
    actualTravelMinutes: net((a) => a === "travel"),
    actualWaitingMinutes: net((a) => a === "waiting"),
    // Person-days with any accepted work entry, by the site-local start date (one day per person, however many entries).
    actualWorkDays: new Set(entries.filter((e) => ["installation", "additional", "rework"].includes(e.activity)).map((e) => `${e.employee_id}|${localDateOf(Number(e.s), TZ)}`)).size,
  };
}

export async function dashboard(q: Queryable, actor: Actor, opts: { month: string; projectId?: string }, now: number) {
  const today = localDateOf(now, TZ);
  const horizon = addDays(today, 14);
  const sheet = await planningSheet(q, actor, { projectId: opts.projectId, from: today }, now);
  const upcoming = sheet.filter((r) => r.plannedStart && r.plannedStart >= today && r.plannedStart <= horizon && !["cancelled", "completed", "closed"].includes(r.execStatus));
  const conflicts = sheet.filter((r) => r.conflicts.length > 0);
  const readiness = sheet.filter((r) => r.plannedStart && r.plannedStart <= horizon && ["unscheduled", "scheduled"].includes(r.execStatus) && (r.clearances.includes("pending") || r.clearances.includes("rejected") || r.clearances.includes("expired") || r.clearances.includes("revoked")));
  const queues = await approvalQueues(q, actor);
  const pf = projectFilter(actor, "p", 1);
  const params = [...pf.params];
  let pwhere = pf.sql;
  if (opts.projectId) { params.push(opts.projectId); pwhere += ` and p.id = $${params.length}`; }
  const [unfinished] = await q.query<{ n: number }>(
    `select count(*)::int n from installation_task t join component c on c.id = t.component_id join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id join project p on p.id = o.project_id
     where ${pwhere} and o.status <> 'cancelled' and t.required_quantity > coalesce((select sum(pe.quantity_delta) from progress_event pe join visit_task vt on vt.id = pe.visit_task_id where vt.task_id = t.id and vt.kind = 'original' and pe.accepted), 0)`, params);
  const pva = await plannedVsActual(q, actor, opts.month, opts.projectId);
  const ef = await employeeFilter(q, actor, "employee_id", 2);
  const recon = await q.query<{ state: string; n: number }>(
    `select state, count(*)::int n from (select distinct on (employee_id) employee_id, state from month_reconciliation where month = $1::date and ${ef.sql} order by employee_id, revision desc) x group by state`,
    [`${opts.month}-01`, ...ef.params]);
  const expenses = await expenseSummary(q, actor, { projectId: opts.projectId });
  const totalEstimate = expenses.some((e) => e.estimate !== null) ? sumMinor(expenses.map((e) => e.estimate ?? 0)) : null;
  const totalActual = sumMinor(expenses.map((e) => e.actual));
  const hrs = (m: number) => `${(m / 60).toFixed(1)} h`;
  const filter = opts.projectId ? `&project=${opts.projectId}` : "";
  const metrics: Metric[] = [
    { id: "upcoming", label: "Upcoming visits (14 days)", value: String(upcoming.length), definition: "Visits with a planned start from today to 14 days ahead that are not completed, closed or cancelled.", href: `/planning?view=sheet${filter}`, tone: "neutral" },
    { id: "conflicts", label: "Staffing conflicts", value: String(conflicts.length), definition: "Visits with a staffing count mismatch, leave or inactive staff overlap, booking with invalid clearance, or overrun risk.", href: `/planning?view=sheet&conflicts=1${filter}`, tone: conflicts.length ? "bad" : "ok" },
    { id: "readiness", label: "Clearance blockers (14 days)", value: String(readiness.length), definition: "Upcoming unscheduled or scheduled visits where any accounts, site or installation clearance is not cleared.", href: `/planning?view=sheet${filter}`, tone: readiness.length ? "warn" : "ok" },
    { id: "unfinished", label: "Unfinished tasks", value: String(unfinished!.n), definition: "Installation tasks whose accepted original-scope quantity is below the required quantity.", href: "/projects", tone: "neutral" },
    { id: "approvals", label: "Pending approvals", value: String(queues.plans.length + queues.time.length + queues.overtime.length + queues.expenses.length), definition: "Submitted plan revisions, time entries, overtime requests and expenses awaiting a decision in your scope.", href: "/approvals", tone: "neutral" },
    { id: "work", label: `Accepted work (${opts.month})`, value: hrs(pva.actualWorkMinutes), definition: "Net minutes of accepted, current installation/additional/rework entries in the month (breaks excluded).", href: "/timesheets", tone: "neutral" },
    { id: "travel", label: `Accepted travel (${opts.month})`, value: hrs(pva.actualTravelMinutes), definition: "Net minutes of accepted, current travel entries in the month. Travel is never counted as work.", href: "/timesheets", tone: "neutral" },
    { id: "occupancy", label: `Booked occupancy (${opts.month})`, value: hrs(pva.reservedOccupancyMinutes), definition: "Confirmed or completed reservation spans within the month, including travel and outstation time. Not the same as working-calendar utilization.", href: "/planning", tone: "neutral" },
    { id: "recon", label: `Reconciliations (${opts.month})`, value: recon.map((r) => `${r.n} ${r.state}`).join(", ") || "None run", definition: "Latest stored reconciliation revision per employee for the month, by state.", href: "/timesheets?tab=month", tone: "neutral" },
    { id: "variance", label: "Approved spend vs estimate", value: totalEstimate === null ? "N/A (no estimates)" : formatMoney(totalActual - totalEstimate), definition: "Approved expenses minus approved credits, less the latest estimate version per visit/project. N/A without estimates.", href: "/expenses", tone: totalEstimate !== null && totalActual > totalEstimate ? "warn" : "neutral" },
  ];
  // The signed-in person's own expense claims for the month (shown on the crew overview).
  const mb = monthBounds(opts.month);
  const [claims] = await q.query<{ submitted: number; approved: number; n: number }>(
    `select coalesce(sum(amount_minor) filter (where state = 'submitted' and not is_credit), 0)::bigint submitted,
       coalesce(sum(amount_minor) filter (where state = 'approved' and not is_credit), 0)::bigint approved,
       count(*) filter (where state in ('submitted','approved') and not is_credit)::int n
     from expense where claimant_id = $1 and incurred_on >= $2::date and incurred_on < $3::date`, [actor.id, mb.first, mb.next]);
  const crew = { workDays: pva.actualWorkDays, workMinutes: pva.actualWorkMinutes, travelMinutes: pva.actualTravelMinutes, bookedMinutes: pva.reservedOccupancyMinutes,
    claimedMinor: Number(claims!.submitted) + Number(claims!.approved), approvedMinor: Number(claims!.approved), claims: claims!.n, recon: recon.map((r) => r.state), unfinished: unfinished!.n };
  return { metrics, upcoming, conflicts, readiness, queues, expenses, monthBounds: mb, today, crew };
}

/** Scheduled utilization: reserved working-calendar minutes / available calendar minutes after leave (not capped). */
export function scheduledUtilization(reserved: Interval[], working: Interval[], leave: Interval[]) {
  const available = durationMinutes(working) - durationMinutes(intersect(working, leave));
  const used = durationMinutes(intersect(union(reserved), working));
  return { reservedWorkingMinutes: used, availableMinutes: available, ratio: available > 0 ? Math.round((used / available) * 10000) / 100 : null };
}

export const monthStartMs = (month: string) => startOfLocalDay(`${month}-01`, TZ);
