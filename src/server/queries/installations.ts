/**
 * Installation head's board: every open visit with its customer, plan length, team and progress,
 * and the day-by-day detail behind one of them. Scoped by the acting user's project visibility.
 */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { notFound } from "../errors";
import { projectFilter } from "./common";

export interface TeamMember { id: string; business_id: string; name: string; job_role: string; state: string; from: string; until: string }
export interface InstallRow {
  visit_id: string; visit: string; exec_status: string; visit_type: string;
  project_id: string; project: string; project_name: string; city: string; site_address: string; timezone: string;
  customer: string; customer_name: string; manager: string | null;
  orders: Array<{ business_id: string; product: string }>;
  planned_start: string | null; planned_end: string | null;
  schedule_start: string | null; schedule_end: string | null; template: string | null;
  work_days: number; done_days: number; delayed_days: number; behind_days: number;
  today_step: string | null; today_kind: string | null;
  team: TeamMember[];
  scoped: number; accepted: number;
}

const ROW_SQL = (where: string) => `
  select v.id visit_id, v.business_id visit, v.exec_status, v.visit_type,
    p.id project_id, p.business_id project, p.name project_name, p.city, p.site_address, p.timezone,
    c.business_id customer, c.name customer_name, m.name manager,
    coalesce((select json_agg(json_build_object('business_id', o.business_id, 'product', (select string_agg(oi.name, ', ') from order_item oi where oi.order_id = o.id)) order by o.business_id)
      from visit_order vo join sales_order o on o.id = vo.order_id where vo.visit_id = v.id), '[]') orders,
    v.planned_start::text planned_start, v.planned_end::text planned_end,
    (select min(day_date)::text from visit_schedule_day where visit_id = v.id) schedule_start,
    (select max(day_date)::text from visit_schedule_day where visit_id = v.id) schedule_end,
    (select t.name from visit_schedule_day s join schedule_template t on t.code = s.template_code where s.visit_id = v.id limit 1) template,
    (select count(*)::int from visit_schedule_day where visit_id = v.id and kind = 'work') work_days,
    (select count(*)::int from visit_schedule_day where visit_id = v.id and kind = 'work' and status = 'done') done_days,
    (select count(*)::int from visit_schedule_day where visit_id = v.id and kind = 'work' and status = 'delayed') delayed_days,
    (select count(*)::int from visit_schedule_day where visit_id = v.id and kind = 'work' and status <> 'done' and day_date < $1::date) behind_days,
    (select coalesce(step_name, off_reason) from visit_schedule_day where visit_id = v.id and day_date = $1::date) today_step,
    (select kind from visit_schedule_day where visit_id = v.id and day_date = $1::date) today_kind,
    coalesce((select json_agg(json_build_object('id', e.id, 'business_id', e.business_id, 'name', e.name, 'job_role', e.job_role, 'state', r.state, 'from', lower(r.span), 'until', upper(r.span)) order by upper(r.span) desc, e.job_role = 'site_supervisor' desc, e.business_id)
      from reservation r join employee e on e.id = r.employee_id where r.visit_id = v.id and r.state in ('proposed','held','confirmed')), '[]') team,
    coalesce((select sum(vt.scoped_quantity)::float from visit_task vt where vt.visit_id = v.id and vt.status = 'active'), 0) scoped,
    coalesce((select sum(pe.quantity_delta)::float from progress_event pe join visit_task vt on vt.id = pe.visit_task_id
      where vt.visit_id = v.id and vt.status = 'active' and pe.accepted), 0) accepted
  from visit v join project p on p.id = v.project_id join customer c on c.id = p.customer_id left join employee m on m.id = p.manager_id
  where ${where}`;

export async function installationsBoard(q: Queryable, actor: Actor, today: string): Promise<InstallRow[]> {
  const f = projectFilter(actor, "p", 2);
  return q.query<InstallRow>(`${ROW_SQL(`v.exec_status in ('unscheduled','scheduled','in_progress','on_hold') and ${f.sql}`)}
    order by case v.exec_status when 'in_progress' then 0 when 'on_hold' then 1 when 'scheduled' then 2 else 3 end, coalesce(v.planned_start, '9999-12-31'), v.business_id`, [today, ...f.params])
    // The board shows the people on the job now; replaced members stay in the visit's own history.
    .then((rows) => rows.map((r) => ({ ...r, team: r.team.filter((m) => Date.parse(m.until) > Date.now()) })));
}

export interface ScheduleDayRow { id: string; day_date: string; kind: "work" | "off"; step_no: number | null; step_name: string | null; off_reason: string | null; status: string; note: string | null; updated_by: string | null }
export interface TaskProgress { id: string; task: string; component: string; activity: string; unit: string; scoped: number; accepted: number }

export async function installationDetail(q: Queryable, actor: Actor, visitId: string, today: string) {
  const f = projectFilter(actor, "p", 3);
  const [row] = await q.query<InstallRow>(`${ROW_SQL(`v.id = $2 and ${f.sql}`)}`, [today, visitId, ...f.params]);
  if (!row) throw notFound("Installation");
  const [days, tasks, templates] = await Promise.all([
    q.query<ScheduleDayRow>(`select s.id, s.day_date::text, s.kind, s.step_no, s.step_name, s.off_reason, s.status, s.note, e.name updated_by
      from visit_schedule_day s left join employee e on e.id = s.updated_by where s.visit_id = $1 order by s.day_date`, [visitId]),
    q.query<TaskProgress>(`select vt.id, t.business_id task, c.name component, t.activity, t.unit, vt.scoped_quantity::float scoped,
        coalesce((select sum(quantity_delta)::float from progress_event where visit_task_id = vt.id and accepted), 0) accepted
      from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id
      where vt.visit_id = $1 and vt.status = 'active' order by c.business_id, t.step_order`, [visitId]),
    q.query<{ code: string; name: string; work_days: number }>("select code, name, (select sum((s->>'days')::int) from jsonb_array_elements(steps) s)::int work_days from schedule_template order by name"),
  ]);
  return { row, days, tasks, templates };
}

export interface Candidate { id: string; business_id: string; name: string; job_role: string; skills: string; busy: string | null }

/** People who could join or replace someone on this visit, with why anyone is unavailable for its remaining dates. */
export async function teamCandidates(q: Queryable, visitId: string, now: number): Promise<Candidate[]> {
  const [v] = await q.query<{ lo: number; hi: number }>(
    `select coalesce(min(lower(r.span)), v.planned_start::timestamptz) lo, coalesce(max(upper(r.span)), (v.planned_end + 1)::timestamptz) hi
     from visit v left join reservation r on r.visit_id = v.id and r.state in ('proposed','held','confirmed') where v.id = $1 group by v.id`, [visitId]);
  if (!v) return [];
  // A visit whose bookings have already ended (late handover) still needs people: check the next day from now.
  const lo = Math.max(Number(v.lo), now), hi = Math.max(Number(v.hi), lo + 86_400_000);
  const from = new Date(lo).toISOString(), to = new Date(hi).toISOString();
  return q.query<Candidate>(
    `select * from (select e.id, e.business_id, e.name, e.job_role,
       coalesce((select string_agg(s.code || ' ' || (array['L','M','H'])[es.level] || case when es.verified then '' else '?' end, ', ' order by s.code)
         from employee_skill es join skill s on s.id = es.skill_id where es.employee_id = e.id), '') skills,
       case
         when exists (select 1 from leave_record l where l.employee_id = e.id and l.status = 'approved' and l.span && tstzrange($2::timestamptz,$3::timestamptz)) then 'on approved leave'
         when exists (select 1 from reservation r join visit ov on ov.id = r.visit_id where r.employee_id = e.id and r.visit_id <> $1 and r.state in ('held','confirmed') and r.span && tstzrange($2::timestamptz,$3::timestamptz))
           then 'booked on ' || (select ov.business_id from reservation r join visit ov on ov.id = r.visit_id where r.employee_id = e.id and r.visit_id <> $1 and r.state in ('held','confirmed') and r.span && tstzrange($2::timestamptz,$3::timestamptz) limit 1)
         else null end busy
     from employee e
     where e.active and e.permission_role in ('employee','supervisor') and e.job_role <> 'department_staff'
       and not exists (select 1 from reservation r where r.visit_id = $1 and r.employee_id = e.id and r.state in ('proposed','held','confirmed') and upper(r.span) > $2::timestamptz)
     ) c order by c.busy is not null, c.job_role, c.business_id`, [visitId, from, to]);
}
