/**
 * People and skills: roster with skill verification, and employee profile (assignments, workload, time balance).
 */
import type { Queryable } from "../db/client";
import { requireEmployeeScope, type Actor } from "../auth/permissions";
import { employeeFilter } from "./common";
import { employeeCalendar } from "../services/time";
import { scheduleIntervals } from "@/domain/time";
import { scheduledUtilization } from "./dashboard";
import { localDateOf, monthBounds, monthOf } from "@/lib/dates";

export async function listEmployees(q: Queryable, actor: Actor, opts: { role?: string; skill?: string; managerId?: string; includeInactive?: boolean } = {}) {
  const f = await employeeFilter(q, actor, "e.id", 1);
  const params = [...f.params];
  let where = f.sql;
  if (!opts.includeInactive) where += " and e.active";
  if (opts.role) { params.push(opts.role); where += ` and e.job_role = $${params.length}`; }
  if (opts.managerId) { params.push(opts.managerId); where += ` and e.manager_id = $${params.length}`; }
  if (opts.skill) { params.push(opts.skill); where += ` and exists (select 1 from employee_skill es join skill s on s.id = es.skill_id where es.employee_id = e.id and s.code = $${params.length})`; }
  return q.query<{
    id: string; business_id: string; name: string; job_role: string; permission_role: string; capabilities: string[]; base_city: string; active: boolean;
    manager: string | null; skills: Array<{ code: string; level: number; verified: boolean; valid_to: string | null }>; is_demo: boolean;
  }>(
    `select e.id, e.business_id, e.name, e.job_role, e.permission_role, e.capabilities, e.base_city, e.active, e.is_demo, m.name manager,
       coalesce((select json_agg(json_build_object('code', s.code, 'level', es.level, 'verified', es.verified, 'valid_to', es.valid_to) order by s.code)
         from employee_skill es join skill s on s.id = es.skill_id where es.employee_id = e.id), '[]') skills
     from employee e left join employee m on m.id = e.manager_id where ${where} order by e.business_id`, params);
}

export async function employeeProfile(q: Queryable, actor: Actor, employeeId: string, now: number) {
  await requireEmployeeScope(q, actor, employeeId);
  const [e] = await q.query<{
    id: string; business_id: string; name: string; job_role: string; permission_role: string; capabilities: string[]; base_city: string; active: boolean;
    manager: string | null; calendar: string; calendar_illustrative: boolean; version: number; is_demo: boolean;
  }>(
    `select e.id, e.business_id, e.name, e.job_role, e.permission_role, e.capabilities, e.base_city, e.active, e.version, e.is_demo, m.name manager,
       c.name calendar, c.is_illustrative calendar_illustrative
     from employee e left join employee m on m.id = e.manager_id left join work_calendar c on c.id = e.calendar_id where e.id = $1`, [employeeId]);
  const skills = await q.query<{ id: string; code: string; name: string; level: number; verified: boolean; verified_by: string | null; verified_at: number | null; valid_from: string | null; valid_to: string | null }>(
    `select es.id, s.code, s.name, es.level, es.verified, v.name verified_by, es.verified_at, es.valid_from::text, es.valid_to::text
     from employee_skill es join skill s on s.id = es.skill_id left join employee v on v.id = es.verified_by where es.employee_id = $1 order by s.code`, [employeeId]);
  const assignments = await q.query<{ visit_id: string; visit: string; project: string; project_id: string; role: string; state: string; start: number; end: number; hold_expires_at: number | null }>(
    `select v.id visit_id, v.business_id visit, p.name project, p.id project_id, r.role, r.state, lower(r.span) "start", upper(r.span) "end", r.hold_expires_at
     from reservation r join visit v on v.id = r.visit_id join project p on p.id = v.project_id
     where r.employee_id = $1 and r.state in ('proposed','held','confirmed','released') order by lower(r.span) desc limit 50`, [employeeId]);
  const leave = await q.query<{ kind: string; start: number; end: number; status: string }>(
    "select kind, lower(span) \"start\", upper(span) \"end\", status from leave_record where employee_id = $1 order by lower(span) desc limit 20", [employeeId]);
  const [workload] = await q.query<{ minutes: number }>(
    `select coalesce(sum(extract(epoch from upper(span) - greatest(lower(span), $2::timestamptz)) / 60), 0)::int minutes
     from reservation where employee_id = $1 and state = 'confirmed' and upper(span) > $2::timestamptz`, [employeeId, new Date(now).toISOString()]);
  const months = await q.query<{ month: string; state: string; revision: number; totals: { N: number | null; Q: number; approvedOT: number; X: number | null; cap: number | null; blockers: string[] } }>(
    `select to_char(month, 'YYYY-MM') "month", state, revision, totals from month_reconciliation where employee_id = $1 and state <> 'invalidated'
     order by month desc, revision desc limit 12`, [employeeId]);
  // Scheduled utilization for the current month: reserved working-calendar minutes / available minutes after leave (not capped).
  const cal = await employeeCalendar(q, employeeId);
  const month = monthOf(localDateOf(now, cal.timezone));
  const { first, last } = monthBounds(month);
  const working = scheduleIntervals(cal, first, last);
  const reserved = (await q.query<{ s: number; e: number }>("select lower(span) s, upper(span) e from reservation where employee_id = $1 and state in ('held','confirmed','released')", [employeeId])).map((r) => ({ start: r.s, end: r.e }));
  const leaveIv = (await q.query<{ s: number; e: number }>("select lower(span) s, upper(span) e from leave_record where employee_id = $1 and status = 'approved'", [employeeId])).map((r) => ({ start: r.s, end: r.e }));
  const utilization = { month, ...scheduledUtilization(reserved, working, leaveIv) };
  return { employee: e!, skills, assignments, leave, futureReservedMinutes: workload?.minutes ?? 0, months, utilization };
}

export async function skillsCatalog(q: Queryable) {
  return q.query<{ id: string; code: string; name: string }>("select id, code, name from skill order by name");
}

/**
 * Staffing candidates for visit planning. Company-wide by design, like team suggestions:
 * only name, job role and skill records are returned (no private fields).
 */
export async function staffingCandidates(q: Queryable) {
  return q.query<{ id: string; business_id: string; name: string; job_role: string; skills: Array<{ code: string; level: number; verified: boolean }> }>(
    `select e.id, e.business_id, e.name, e.job_role,
       coalesce((select json_agg(json_build_object('code', s.code, 'level', es.level, 'verified', es.verified) order by s.code)
         from employee_skill es join skill s on s.id = es.skill_id where es.employee_id = e.id), '[]') skills
     from employee e where e.active and e.job_role not in ('project_manager','operator') order by e.job_role, e.business_id`);
}
