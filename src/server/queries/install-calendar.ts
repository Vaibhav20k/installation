/**
 * Month view of installations for the calendar and the site map list. One row per visit (never per assigned
 * employee); a date counts a visit once when it is one of the visit's scheduled working days, or, for a visit
 * without a customer schedule, a date within its planned start and end. Scoped like the installations board.
 */
import type { Queryable } from "../db/client";
import { atLeast, type Actor } from "../auth/permissions";
import { forbidden } from "../errors";
import { datesBetween, monthBounds } from "@/lib/dates";
import { handoverState, type HandoverState } from "@/domain/handover";
import { projectFilter } from "./common";

export interface CalendarVisit {
  visit_id: string; project_id: string; latitude: number | null; longitude: number | null; visit: string; sequence: number; visit_type: string; exec_status: string;
  customer: string; customer_name: string; project: string; project_name: string; city: string; site_address: string; timezone: string;
  planned_start: string | null; planned_end: string | null; schedule_end: string | null; team: number;
  dates: string[]; handover: HandoverState;
}

export async function installCalendar(q: Queryable, actor: Actor, month: string, now: number) {
  if (!atLeast(actor, "supervisor")) throw forbidden("The installation calendar is for supervisors, managers and administrators.");
  const { first, last } = monthBounds(month);
  const f = projectFilter(actor, "p", 3);
  const rows = await q.query<Omit<CalendarVisit, "dates" | "handover"> & { work_days: string[] | null }>(
    `select v.id visit_id, p.id project_id, p.latitude::float latitude, p.longitude::float longitude, v.business_id visit, v.sequence, v.visit_type, v.exec_status,
       c.business_id customer, c.name customer_name, p.business_id project, p.name project_name, p.city, p.site_address, p.timezone,
       v.planned_start::text planned_start, v.planned_end::text planned_end,
       (select max(day_date)::text from visit_schedule_day where visit_id = v.id) schedule_end,
       (select count(distinct r.employee_id)::int from reservation r where r.visit_id = v.id and r.state in ('proposed','held','confirmed')) team,
       (select array_agg(day_date::text order by day_date) from visit_schedule_day where visit_id = v.id and kind = 'work' and day_date between $1::date and $2::date) work_days
     from visit v join project p on p.id = v.project_id join customer c on c.id = p.customer_id
     where v.exec_status <> 'cancelled' and ${f.sql}
       and (exists (select 1 from visit_schedule_day s where s.visit_id = v.id and s.kind = 'work' and s.day_date between $1::date and $2::date)
            or (not exists (select 1 from visit_schedule_day s where s.visit_id = v.id) and v.planned_start <= $2::date and coalesce(v.planned_end, v.planned_start) >= $1::date))
     order by p.city, c.business_id, v.sequence limit 500`, [first, last, ...f.params]);
  const visits: CalendarVisit[] = rows.map(({ work_days, ...r }) => {
    const dates = work_days ?? (r.planned_start ? datesBetween(r.planned_start > first ? r.planned_start : first, (r.planned_end ?? r.planned_start) < last ? (r.planned_end ?? r.planned_start) : last) : []);
    return { ...r, dates, handover: handoverState(r, now) };
  });
  const byDate = new Map<string, CalendarVisit[]>();
  for (const v of visits) for (const d of v.dates) byDate.set(d, [...(byDate.get(d) ?? []), v]);
  return { first, last, visits, byDate };
}

/** Ordinal label for the visit sequence that already exists on every visit (1st, 2nd, 3rd ... no fixed maximum). */
export function visitOrdinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s} visit`;
}
