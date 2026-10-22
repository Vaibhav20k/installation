/**
 * A worker's assigned work: every visit they are booked or held on from today, with task scope, accepted
 * output and remaining quantity. Accepted output is counted once per task, never per crew member.
 */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";

export interface MyTask { id: string; task: string; component: string; activity: string; unit: string; scoped: number; accepted: number; kind: string }
export interface MyVisit { id: string; business_id: string; project: string; site_address: string; exec_status: string; start: number; end: number; state: string; tasks: MyTask[] }

export async function myTasks(q: Queryable, actor: Actor, now: number): Promise<MyVisit[]> {
  const visits = await q.query<Omit<MyVisit, "tasks">>(
    `select distinct on (v.id) v.id, v.business_id, p.name project, p.site_address, v.exec_status, lower(r.span) start, upper(r.span) "end", r.state
     from reservation r join visit v on v.id = r.visit_id join project p on p.id = v.project_id
     where r.employee_id = $1 and r.state in ('held','confirmed') and upper(r.span) > $2::timestamptz and v.exec_status not in ('cancelled','closed')
     order by v.id, lower(r.span)`, [actor.id, new Date(now).toISOString()]);
  const out: MyVisit[] = [];
  for (const v of visits.sort((a, b) => Number(a.start) - Number(b.start))) {
    const tasks = await q.query<MyTask>(
      `select vt.id, t.business_id task, c.name component, t.activity, t.unit, vt.scoped_quantity::float scoped, vt.kind,
         coalesce((select sum(quantity_delta)::float from progress_event pe where pe.visit_task_id = vt.id and pe.accepted), 0) accepted
       from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id
       where vt.visit_id = $1 and vt.status = 'active' order by c.business_id, t.step_order`, [v.id]);
    out.push({ ...v, start: Number(v.start), end: Number(v.end), tasks });
  }
  return out;
}
