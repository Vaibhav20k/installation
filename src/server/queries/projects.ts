/**
 * Project reads: list and detail with orders, components, remaining work, visits, daily plan,
 * team, time, expenses and history.
 */
import type { Queryable } from "../db/client";
import { requireProjectScope, type Actor } from "../auth/permissions";
import { Dec } from "@/domain/decimal";
import { projectFilter } from "./common";

export async function listProjects(q: Queryable, actor: Actor, opts: { search?: string } = {}) {
  const f = projectFilter(actor, "p", 1);
  const params: unknown[] = [...f.params];
  let where = f.sql;
  if (opts.search) { params.push(`%${opts.search}%`); where += ` and (p.name ilike $${params.length} or p.business_id ilike $${params.length} or c.name ilike $${params.length})`; }
  return q.query<{
    id: string; business_id: string; name: string; city: string; status: string; customer: string; customer_bid: string; manager: string | null;
    orders: number; open_visits: number; next_visit: string | null; is_demo: boolean;
  }>(
    `select p.id, p.business_id, p.name, p.city, p.status, c.name customer, c.business_id customer_bid, m.name manager, p.is_demo,
       (select count(*)::int from sales_order o where o.project_id = p.id) orders,
       (select count(*)::int from visit v where v.project_id = p.id and v.exec_status not in ('completed','closed','cancelled')) open_visits,
       (select min(v.planned_start)::text from visit v where v.project_id = p.id and v.exec_status in ('unscheduled','scheduled')) next_visit
     from project p join customer c on c.id = p.customer_id left join employee m on m.id = p.manager_id
     where ${where} order by p.business_id`, params);
}

export async function projectDetail(q: Queryable, actor: Actor, projectId: string) {
  await requireProjectScope(q, actor, projectId);
  const [project] = await q.query<{
    id: string; business_id: string; name: string; site_address: string; city: string; timezone: string; status: string; kitchen_floor_area: string | null;
    kitchen_floor_area_unit: string | null; customer: string; customer_bid: string; lead_ref: string | null; lead_source: string | null; converted_at: number | null;
    source_system: string | null; manager: string | null; manager_id: string | null; is_demo: boolean;
  }>(
    `select p.id, p.business_id, p.name, p.site_address, p.city, p.timezone, p.status, p.kitchen_floor_area::text, p.kitchen_floor_area_unit, p.is_demo,
       c.name customer, c.business_id customer_bid, c.lead_ref, c.lead_source, c.converted_at, c.source_system, m.name manager, p.manager_id
     from project p join customer c on c.id = p.customer_id left join employee m on m.id = p.manager_id where p.id = $1`, [projectId]);

  const tasks = await q.query<{
    order_id: string; order_bid: string; order_status: string; external_ref: string | null; item_bid: string; item_id: string; product_type: string; item_name: string;
    component_id: string; component_bid: string; component: string; quantity: string; unit: string; quantity_kind: string; available_quantity: string;
    task_id: string; task_bid: string; activity: string; step_order: number; required: string; accepted: string; committed: string;
  }>(
    `select o.id order_id, o.business_id order_bid, o.status order_status, o.external_ref, oi.business_id item_bid, oi.id item_id, oi.product_type, oi.name item_name,
       c.id component_id, c.business_id component_bid, c.name component, c.quantity::text, c.unit, c.quantity_kind, c.available_quantity::text,
       t.id task_id, t.business_id task_bid, t.activity, t.step_order, t.required_quantity::text required,
       coalesce((select sum(pe.quantity_delta) from progress_event pe join visit_task vt on vt.id = pe.visit_task_id where vt.task_id = t.id and vt.kind = 'original' and pe.accepted), 0)::text accepted,
       coalesce((select sum(vt.scoped_quantity) from visit_task vt join visit v on v.id = vt.visit_id where vt.task_id = t.id and vt.kind = 'original' and vt.status = 'active' and v.exec_status <> 'cancelled'), 0)::text committed
     from sales_order o join order_item oi on oi.order_id = o.id join component c on c.order_item_id = oi.id join installation_task t on t.component_id = c.id
     where o.project_id = $1 order by o.business_id, oi.business_id, c.business_id, t.step_order`, [projectId]);
  const scope = tasks.map((t) => ({ ...t, remaining: Dec.of(t.required).sub(t.accepted).max(0).toString() }));

  const visits = await q.query<{
    id: string; business_id: string; sequence: number; visit_type: string; exec_status: string; planned_start: string | null; planned_end: string | null;
    team_size: number; repeat_reason: string | null; plan_id: string; plan_bid: string; approval_state: string; revision_no: number; staff: number; version: number;
  }>(
    `select v.id, v.business_id, v.sequence, v.visit_type, v.exec_status, v.planned_start::text, v.planned_end::text, v.team_size, v.repeat_reason, v.plan_id, pl.business_id plan_bid, v.version,
       r.approval_state, r.revision_no,
       (select count(*)::int from reservation x where x.visit_id = v.id and x.state in ('proposed','held','confirmed')) staff
     from visit v join plan pl on pl.id = v.plan_id
     join lateral (select approval_state, revision_no from plan_revision where plan_id = pl.id order by revision_no desc limit 1) r on true
     where v.project_id = $1 order by v.planned_start nulls last, v.sequence`, [projectId]);

  const plans = await q.query<{ id: string; business_id: string; status: string; baseline: number | null; current: number | null; latest: number; latest_state: string }>(
    `select pl.id, pl.business_id, pl.status,
       (select revision_no from plan_revision where id = pl.baseline_revision_id) baseline, (select revision_no from plan_revision where id = pl.current_revision_id) current,
       r.revision_no latest, r.approval_state latest_state
     from plan pl join lateral (select revision_no, approval_state from plan_revision where plan_id = pl.id order by revision_no desc limit 1) r on true
     where pl.project_id = $1 order by pl.business_id`, [projectId]);

  const team = await q.query<{ visit: string; employee: string; employee_id: string; business_id: string; role: string; state: string; start: number; end: number }>(
    `select v.business_id visit, e.name employee, e.id employee_id, e.business_id, r.role, r.state, lower(r.span) "start", upper(r.span) "end"
     from reservation r join visit v on v.id = r.visit_id join employee e on e.id = r.employee_id
     where v.project_id = $1 and r.state in ('proposed','held','confirmed','released') order by lower(r.span), e.business_id`, [projectId]);

  const time = await q.query<{ employee: string; activity: string; state: string; start: number; end: number; minutes: number; is_exception: boolean }>(
    `select e.name employee, t.activity, t.state, lower(t.span) "start", upper(t.span) "end", t.is_exception,
       ((extract(epoch from upper(t.span) - lower(t.span)) - coalesce((select sum(extract(epoch from upper(b.span) - lower(b.span))) from break_interval b where b.time_entry_id = t.id), 0)) / 60)::int minutes
     from time_entry t join employee e on e.id = t.employee_id where t.project_id = $1 and t.is_current and t.state <> 'voided' order by lower(t.span) desc limit 200`, [projectId]);

  const quality = await q.query<{ id: string; business_id: string; kind: string; category: string; status: string; reported_on: string; responsible_function: string | null; closed_on: string | null }>(
    "select id, business_id, kind, category, status, reported_on::text, responsible_function, closed_on::text from quality_case where project_id = $1 order by reported_on desc", [projectId]);
  const issues = await q.query<{ id: string; business_id: string; function: string; category: string; status: string; due_date: string | null; owner: string | null; next_action: string | null; version: number }>(
    "select i.id, i.business_id, i.function, i.category, i.status, i.due_date::text, e.name owner, i.next_action, i.version from issue i left join employee e on e.id = i.owner_id where i.project_id = $1 order by i.raised_on desc", [projectId]);

  const history = await q.query<{ at: number; action: string; object_type: string; actor: string | null; reason: string | null }>(
    `select a.at, a.action, a.object_type, e.name actor, a.reason from audit_event a left join employee e on e.id = a.actor_id
     where a.object_id = $1::text or a.object_id in (select id::text from visit where project_id = $1::uuid) or a.object_id in (select id::text from plan where project_id = $1::uuid)
     order by a.at desc limit 100`, [projectId]);

  const orderList = await q.query<{ id: string; business_id: string; status: string; external_ref: string | null }>(
    "select id, business_id, status, external_ref from sales_order where project_id = $1 order by business_id", [projectId]);
  const itemList = await q.query<{ id: string; label: string }>(
    `select oi.id, o.business_id || ' · ' || oi.business_id || ' · ' || oi.name label from order_item oi join sales_order o on o.id = oi.order_id
     where o.project_id = $1 order by o.business_id, oi.business_id`, [projectId]);
  return { project: project!, scope, visits, plans, team, time, quality, issues, history, orderList, itemList };
}
