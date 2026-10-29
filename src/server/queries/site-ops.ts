/**
 * Reads for the site workforce view, site presence and the dated work plan. Summaries are computed here from
 * the same records the detail lists show. Heads (supervisor and above) see a site only within their project
 * scope; a worker sees only their own sessions and the checklist items of tasks assigned to them.
 */
import type { Queryable } from "../db/client";
import { atLeast, requireProjectScope, type Actor } from "../auth/permissions";
import { forbidden, notFound } from "../errors";
import { plannedDates, siteDays, type SiteDaySummary } from "@/domain/site-days";
import { checkInSites, openPresence } from "../services/site-presence";

export interface SessionRow { id: string; employee_id: string; check_in_at: number; check_out_at: number | null; source: string; missed_checkout: boolean; version: number; changes: number }
export interface WorkforceRow {
  id: string; business_id: string; name: string; job_role: string; on_team: boolean;
  skills: Array<{ name: string; level: number; verified: boolean }>;
  plannedDates: string[]; tasks: string[]; sessions: SessionRow[]; summary: SiteDaySummary;
}

async function visitScope(q: Queryable, actor: Actor, visitId: string) {
  const [v] = await q.query<{ project_id: string; timezone: string; business_id: string }>("select v.project_id, p.timezone, v.business_id from visit v join project p on p.id = v.project_id where v.id = $1", [visitId]);
  if (!v) throw notFound("Visit");
  await requireProjectScope(q, actor, v.project_id);
  return v;
}

/** Who is planned on the site and who has actually recorded presence there. Plans are not proof of attendance. */
export async function siteWorkforce(q: Queryable, actor: Actor, visitId: string, now: number) {
  if (!atLeast(actor, "supervisor")) throw forbidden("The site workforce view is for supervisors, managers and administrators.");
  const v = await visitScope(q, actor, visitId);
  const [people, spans, sessions, tasks] = await Promise.all([
    q.query<{ id: string; business_id: string; name: string; job_role: string; on_team: boolean; skills: WorkforceRow["skills"] }>(
      `with ids as (select employee_id from reservation where visit_id = $1 and state in ('proposed','held','confirmed','released')
                    union select employee_id from site_presence where visit_id = $1 and not voided)
       select e.id, e.business_id, e.name, e.job_role,
         exists (select 1 from reservation r where r.visit_id = $1 and r.employee_id = e.id and r.state in ('proposed','held','confirmed') and upper(r.span) > $2::timestamptz) on_team,
         coalesce((select json_agg(json_build_object('name', s.name, 'level', es.level, 'verified', es.verified) order by s.name)
           from employee_skill es join skill s on s.id = es.skill_id where es.employee_id = e.id and (es.valid_to is null or es.valid_to >= current_date)), '[]') skills
       from employee e join ids on ids.employee_id = e.id order by e.business_id`, [visitId, new Date(now).toISOString()]),
    q.query<{ employee_id: string; lo: number; hi: number }>("select employee_id, lower(span) lo, upper(span) hi from reservation where visit_id = $1 and state in ('proposed','held','confirmed')", [visitId]),
    q.query<SessionRow>(`select s.id, s.employee_id, s.check_in_at, s.check_out_at, s.source, s.missed_checkout, s.version, (select count(*)::int from site_presence_change c where c.presence_id = s.id and c.change in ('corrected','added')) changes
       from site_presence s where s.visit_id = $1 and not s.voided order by s.check_in_at desc limit 2000`, [visitId]),
    q.query<{ employee_id: string; title: string }>(`select a.employee_id, t.title from site_work_assignee a join site_work_task t on t.id = a.task_id where t.visit_id = $1 and t.status = 'open' order by t.start_date`, [visitId]),
  ]);
  const rows: WorkforceRow[] = people.map((p) => {
    const mine = sessions.filter((s) => s.employee_id === p.id);
    return {
      ...p,
      plannedDates: plannedDates(spans.filter((s) => s.employee_id === p.id).map((s) => ({ start: Number(s.lo), end: Number(s.hi) })), v.timezone),
      tasks: tasks.filter((t) => t.employee_id === p.id).map((t) => t.title),
      sessions: mine,
      summary: siteDays(mine.map((s) => ({ in: Number(s.check_in_at), out: s.check_out_at === null ? null : Number(s.check_out_at) })), v.timezone),
    };
  });
  return {
    timezone: v.timezone, rows,
    totals: {
      planned: rows.filter((r) => r.plannedDates.length > 0).length,
      present: rows.filter((r) => r.summary.recordedDays > 0 || r.summary.openSessions > 0).length,
      onSiteNow: rows.filter((r) => r.summary.openSessions > 0).length,
      personDays: rows.reduce((t, r) => t + r.summary.recordedDays, 0),
      open: rows.reduce((t, r) => t + r.summary.openSessions, 0),
    },
  };
}

/** The worker's own site check-in state: where they may check in today, the open session and today's sessions. */
export async function myPresence(q: Queryable, actor: Actor, now: number) {
  const [sites, open] = await Promise.all([checkInSites(q, actor.id, now), openPresence(q, actor.id)]);
  const recent = await q.query<{ id: string; visit: string; check_in_at: number; check_out_at: number | null; missed_checkout: boolean; timezone: string }>(
    `select s.id, v.business_id visit, s.check_in_at, s.check_out_at, s.missed_checkout, p.timezone from site_presence s join visit v on v.id = s.visit_id join project p on p.id = s.project_id
     where s.employee_id = $1 and not s.voided and (s.check_in_at > $2::timestamptz - interval '36 hours' or (s.check_out_at is null)) order by s.check_in_at desc limit 20`, [actor.id, new Date(now).toISOString()]);
  return { sites, open, recent };
}

export interface WorkItem { id: string; task_id: string; item_date: string; original_date: string; text: string; done_at: number | null; done_by: string | null; version: number; events: number }
export interface WorkTask {
  id: string; title: string; description: string | null; start_date: string; due_date: string; status: string; version: number;
  assignees: Array<{ id: string; name: string; business_id: string }>; items: WorkItem[]; outsidePlan: boolean;
}

/** The visit's work plan: tasks with assignees and dated items. Heads in scope only. */
export async function workPlan(q: Queryable, actor: Actor, visitId: string) {
  if (!atLeast(actor, "supervisor")) throw forbidden("The work plan is for supervisors, managers and administrators.");
  await visitScope(q, actor, visitId);
  const [v] = await q.query<{ planned_start: string | null; planned_end: string | null }>("select planned_start::text, planned_end::text from visit where id = $1", [visitId]);
  const tasks = await q.query<Omit<WorkTask, "outsidePlan">>(
    `select t.id, t.title, t.description, t.start_date::text, t.due_date::text, t.status, t.version,
       coalesce((select json_agg(json_build_object('id', e.id, 'name', e.name, 'business_id', e.business_id) order by e.business_id) from site_work_assignee a join employee e on e.id = a.employee_id where a.task_id = t.id), '[]') assignees,
       coalesce((select json_agg(json_build_object('id', i.id, 'task_id', i.task_id, 'item_date', i.item_date::text, 'original_date', i.original_date::text, 'text', i.text,
           'done_at', (extract(epoch from i.reported_done_at) * 1000)::bigint, 'done_by', d.name, 'version', i.version,
           'events', (select count(*)::int from site_work_item_event x where x.item_id = i.id)) order by i.item_date, i.created_at)
         from site_work_item i left join employee d on d.id = i.reported_done_by where i.task_id = t.id and not i.cancelled), '[]') items
     from site_work_task t where t.visit_id = $1 order by t.status, t.start_date, t.created_at limit 200`, [visitId]);
  const outside = (t: { start_date: string; due_date: string }) => !v?.planned_start || !v.planned_end ? false : t.start_date < v.planned_start || t.due_date > v.planned_end;
  return { plannedStart: v?.planned_start ?? null, plannedEnd: v?.planned_end ?? null, tasks: tasks.map((t) => ({ ...t, outsidePlan: outside(t) })) as WorkTask[] };
}

export interface TodayItem extends WorkItem { title: string; visit: string; project: string; shared: number }

/** Checklist items on tasks assigned to the actor for one date, plus earlier items still unfinished (or finished late that day). */
export async function todaysWork(q: Queryable, actor: Actor, date: string) {
  const rows = await q.query<TodayItem>(
    `select i.id, i.task_id, i.item_date::text, i.original_date::text, i.text, (extract(epoch from i.reported_done_at) * 1000)::bigint done_at, d.name done_by, i.version,
       (select count(*)::int from site_work_item_event x where x.item_id = i.id) events,
       t.title, v.business_id visit, p.name project, (select count(*)::int from site_work_assignee a2 where a2.task_id = t.id) shared
     from site_work_item i join site_work_task t on t.id = i.task_id join visit v on v.id = t.visit_id join project p on p.id = v.project_id
     join site_work_assignee a on a.task_id = t.id and a.employee_id = $1 left join employee d on d.id = i.reported_done_by
     where not i.cancelled and t.status = 'open' and (i.item_date = $2::date or (i.item_date < $2::date and i.item_date >= $2::date - 31
       -- Earlier items still open, plus those reported done on this date (so a late tick stays in view).
       and (i.reported_done_at is null or (i.reported_done_at at time zone p.timezone)::date = $2::date)))
     order by i.item_date, t.title, i.created_at limit 300`, [actor.id, date]);
  return { today: rows.filter((r) => r.item_date === date), overdue: rows.filter((r) => r.item_date < date) };
}

