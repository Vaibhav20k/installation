/**
 * Planning reads: timeline board, management planning sheet and visit detail.
 */
import type { Queryable } from "../db/client";
import { requireProjectScope, type Actor } from "../auth/permissions";
import { addDays, localDateOf, startOfLocalDay } from "@/lib/dates";
import { clearanceGate, readinessGate } from "../services/clearance";
import { buildSnapshot, estimateVisitScope, visitSpan, loadVisit } from "../services/plan-support";
import { visitCoverage } from "../services/booking";
import { employeeFilter, projectFilter } from "./common";

const TZ = "Asia/Kolkata";

export async function planningBoard(q: Queryable, actor: Actor, opts: { from: string; days: number; role?: string; skill?: string; managerId?: string; projectId?: string }, now: number) {
  const start = startOfLocalDay(opts.from, TZ);
  const end = startOfLocalDay(addDays(opts.from, opts.days), TZ);
  const ef = await employeeFilter(q, actor, "e.id", 1);
  const params: unknown[] = [...ef.params];
  let where = `${ef.sql} and e.active and e.job_role not in ('project_manager','operator','department_staff')`;
  if (opts.role) { params.push(opts.role); where += ` and e.job_role = $${params.length}`; }
  if (opts.managerId) { params.push(opts.managerId); where += ` and e.manager_id = $${params.length}`; }
  if (opts.skill) { params.push(opts.skill); where += ` and exists (select 1 from employee_skill es join skill s on s.id = es.skill_id where es.employee_id = e.id and s.code = $${params.length} and es.verified)`; }
  const employees = await q.query<{ id: string; business_id: string; name: string; job_role: string; base_city: string }>(
    `select e.id, e.business_id, e.name, e.job_role, e.base_city from employee e where ${where} order by e.job_role, e.business_id`, params);
  const ids = employees.map((e) => e.id);
  const range = [new Date(start).toISOString(), new Date(end).toISOString()];
  const res = ids.length ? await q.query<{ employee_id: string; id: string; state: string; start: number; end: number; hold_expires_at: number | null; visit_id: string; visit: string; project: string; project_id: string; outstation: boolean }>(
    `select r.employee_id, r.id, r.state, lower(r.span) "start", upper(r.span) "end", r.hold_expires_at, v.id visit_id, v.business_id visit, p.name project, p.id project_id, v.outstation
     from reservation r join visit v on v.id = r.visit_id join project p on p.id = v.project_id
     where r.employee_id = any($1::uuid[]) and r.state in ('proposed','held','confirmed') and r.span && tstzrange($2::timestamptz,$3::timestamptz)
       ${opts.projectId ? "and p.id = $4" : ""}`, opts.projectId ? [ids, ...range, opts.projectId] : [ids, ...range]) : [];
  const leave = ids.length ? await q.query<{ employee_id: string; kind: string; start: number; end: number }>(
    "select employee_id, kind, lower(span) \"start\", upper(span) \"end\" from leave_record where status = 'approved' and employee_id = any($1::uuid[]) and span && tstzrange($2::timestamptz,$3::timestamptz)", [ids, ...range]) : [];
  return {
    from: opts.from, days: opts.days, start, end,
    rows: employees.map((e) => ({
      ...e,
      segments: [
        ...res.filter((r) => r.employee_id === e.id).map((r) => ({
          kind: r.state as "proposed" | "held" | "confirmed", label: `${r.visit} · ${r.project}`, start: r.start, end: r.end, visitId: r.visit_id, projectId: r.project_id,
          note: r.state === "held" ? (r.hold_expires_at! <= now ? "Hold expired" : `Hold expires ${new Date(r.hold_expires_at!).toISOString().slice(0, 16).replace("T", " ")} UTC`) : r.outstation ? "Outstation (travel included)" : undefined,
        })),
        ...leave.filter((l) => l.employee_id === e.id).map((l) => ({ kind: "leave" as const, label: l.kind, start: l.start, end: l.end, visitId: null, projectId: null, note: undefined })),
      ].sort((a, b) => a.start - b.start),
    })),
  };
}

export interface SheetRow {
  visitId: string; visit: string; customerId: string; projectId: string; projectBid: string; orders: string; products: string; site: string; manager: string | null;
  visitType: string; execStatus: string; approval: string; revision: number; skills: string; requestedStart: string | null; requestedMeaning: string | null;
  departure: number | null; plannedStart: string | null; plannedEnd: string | null; returnAt: number | null; workPersonDays: number | null; team: string; staffed: number; teamSize: number;
  continuity: string; clearances: string; estimateMinor: number | null; budgetMinor: number | null; conflicts: string[]; nextAction: string; owner: string | null; due: string | null;
  allocations: Array<{ employee: string; role: string; state: string }>;
}

export async function planningSheet(q: Queryable, actor: Actor, opts: { projectId?: string; status?: string; from?: string } = {}, now: number): Promise<SheetRow[]> {
  const f = projectFilter(actor, "p", 1);
  const params: unknown[] = [...f.params];
  let where = f.sql;
  if (opts.projectId) { params.push(opts.projectId); where += ` and p.id = $${params.length}`; }
  if (opts.status) { params.push(opts.status); where += ` and v.exec_status = $${params.length}`; }
  if (opts.from) { params.push(opts.from); where += ` and (v.planned_end is null or v.planned_end >= $${params.length}::date)`; }
  const rows = await q.query<{
    id: string; business_id: string; customer_bid: string; project_id: string; project_bid: string; city: string; manager: string | null; visit_type: string; exec_status: string;
    approval_state: string; revision_no: number; requested_start: string | null; requested_start_meaning: string | null; departure_at: number | null; planned_start: string | null;
    planned_end: string | null; return_at: number | null; team_size: number; continuity: string; plan_creator: string | null; timezone: string; outstation: boolean;
    orders: string | null; products: string | null; skills: string | null; clearances: Array<{ gate: string; status: string; valid_until: string | null }>;
    staff: Array<{ employee: string; role: string; state: string; employee_id: string }> | null; estimate_minor: number | null; budget_minor: number | null;
  }>(
    `select v.id, v.business_id, c.business_id customer_bid, p.id project_id, p.business_id project_bid, p.city, m.name manager, v.visit_type, v.exec_status,
       r.approval_state, r.revision_no, v.requested_start::text, v.requested_start_meaning, v.departure_at, v.planned_start::text, v.planned_end::text, v.return_at,
       v.team_size, v.continuity, cr.name plan_creator, p.timezone, v.outstation,
       (select string_agg(o.business_id, ', ' order by o.business_id) from visit_order vo join sales_order o on o.id = vo.order_id where vo.visit_id = v.id) orders,
       (select string_agg(distinct oi.name || ' / ' || co.name, '; ') from visit_task vt join installation_task t on t.id = vt.task_id join component co on co.id = t.component_id join order_item oi on oi.id = co.order_item_id where vt.visit_id = v.id and vt.status = 'active') products,
       (select string_agg(s.code || ' ' || case sr.min_level when 3 then 'High' when 2 then 'Medium' else 'Low' end || '+ x' || sr.headcount, ', ') from skill_requirement sr join skill s on s.id = sr.skill_id where sr.visit_id = v.id) skills,
       (select json_agg(json_build_object('gate', gate, 'status', status, 'valid_until', valid_until) order by gate) from clearance where visit_id = v.id) clearances,
       (select json_agg(json_build_object('employee', e.name || ' (' || e.business_id || ')', 'role', x.role, 'state', x.state, 'employee_id', e.id) order by e.business_id)
          from reservation x join employee e on e.id = x.employee_id where x.visit_id = v.id and x.state in ('proposed','held','confirmed')) staff,
       (select sum(el.amount_minor)::bigint from estimate es join estimate_line el on el.estimate_id = es.id
          where es.visit_id = v.id and es.version = (select max(version) from estimate e2 where e2.business_id = es.business_id)) estimate_minor,
       (select approved_total_minor from budget b where b.project_id = p.id and b.is_current) budget_minor
     from visit v join project p on p.id = v.project_id join customer c on c.id = p.customer_id left join employee m on m.id = p.manager_id
     join plan pl on pl.id = v.plan_id left join employee cr on cr.id = pl.created_by
     join lateral (select approval_state, revision_no from plan_revision where plan_id = pl.id order by revision_no desc limit 1) r on true
     where ${where} and pl.status = 'active' order by v.planned_start nulls last, v.business_id`, params);

  const out: SheetRow[] = [];
  for (const v of rows) {
    const staff = v.staff ?? [];
    const conflicts: string[] = [];
    const span = visitSpan(v);
    if (staff.length && staff.length !== v.team_size) conflicts.push(`Staffed ${staff.length} of ${v.team_size}`);
    if (span && ["held", "confirmed"].some((s) => staff.some((x) => x.state === s))) {
      const gate = await clearanceGate(q, v.id, v.planned_start!);
      if (!gate.ok && staff.some((x) => x.state === "confirmed")) conflicts.push(`Booked but ${gate.blockers.join("; ")} — review booking`);
      const lv = await q.query<{ name: string }>(
        `select distinct e.name from leave_record l join employee e on e.id = l.employee_id where l.status = 'approved' and l.employee_id = any($1::uuid[]) and l.span && tstzrange($2::timestamptz,$3::timestamptz)`,
        [staff.map((s) => s.employee_id), new Date(span.start).toISOString(), new Date(span.end).toISOString()]);
      for (const l of lv) conflicts.push(`${l.name} has approved leave during this visit`);
      const inactive = await q.query<{ name: string }>("select name from employee where id = any($1::uuid[]) and not active", [staff.map((s) => s.employee_id)]);
      for (const i of inactive) conflicts.push(`${i.name} is inactive`);
    }
    if (v.exec_status === "in_progress" && span && now > span.end) conflicts.push("Overrun risk: past planned release; authorize an extension or revise");
    const workDays = v.planned_start && v.planned_end ? Math.round((Date.parse(v.planned_end) - Date.parse(v.planned_start)) / 86_400_000) + 1 : null;
    const clearances = (v.clearances ?? []).map((c) => `${c.gate}: ${c.status}`).join(", ");
    out.push({
      visitId: v.id, visit: v.business_id, customerId: v.customer_bid, projectId: v.project_id, projectBid: v.project_bid, orders: v.orders ?? "", products: v.products ?? "—", site: v.city,
      manager: v.manager, visitType: v.visit_type, execStatus: v.exec_status, approval: v.approval_state, revision: v.revision_no, skills: v.skills ?? "Not set",
      requestedStart: v.requested_start, requestedMeaning: v.requested_start_meaning, departure: v.departure_at, plannedStart: v.planned_start, plannedEnd: v.planned_end, returnAt: v.return_at,
      workPersonDays: workDays && staff.length ? workDays * staff.length : null, team: staff.map((s) => s.employee).join(", "), staffed: staff.length, teamSize: v.team_size,
      continuity: v.continuity, clearances, estimateMinor: v.estimate_minor, budgetMinor: v.budget_minor, conflicts,
      ...nextAction(v, staff),
      allocations: staff.map((s) => ({ employee: s.employee, role: s.role, state: s.state })),
    });
  }
  return out;
}

function nextAction(v: { approval_state: string; exec_status: string; planned_start: string | null; manager: string | null; plan_creator: string | null; clearances: Array<{ status: string }> | null }, staff: Array<{ state: string }>) {
  const due = v.planned_start;
  if (["completed", "closed", "cancelled"].includes(v.exec_status)) return { nextAction: "None", owner: null, due: null };
  if (v.approval_state === "draft") return { nextAction: staff.length ? "Submit plan for approval" : "Choose team", owner: v.plan_creator, due };
  if (v.approval_state === "submitted") return { nextAction: "Review plan", owner: v.manager, due };
  if (v.approval_state === "returned") return { nextAction: "Revise returned plan", owner: v.plan_creator, due };
  if ((v.clearances ?? []).some((c) => c.status !== "cleared")) return { nextAction: "Complete clearances", owner: v.manager, due };
  if (v.exec_status === "unscheduled") return { nextAction: "Book team", owner: v.manager, due };
  if (v.exec_status === "scheduled") return { nextAction: "Readiness check and departure", owner: v.plan_creator, due };
  if (v.exec_status === "in_progress") return { nextAction: "Record daily progress", owner: v.plan_creator, due: null };
  return { nextAction: "Review", owner: v.manager, due };
}

export async function visitDetail(q: Queryable, actor: Actor, visitId: string, now: number) {
  const v = await loadVisit(q, visitId);
  await requireProjectScope(q, actor, v.project_id);
  const [ctx] = await q.query<{ project: string; project_bid: string; customer: string; plan_bid: string; plan_status: string; requested_start: string | null; requested_start_meaning: string | null; repeat_reason_note: string | null }>(
    `select p.name project, p.business_id project_bid, c.name customer, pl.business_id plan_bid, pl.status plan_status, v.requested_start::text, v.requested_start_meaning, v.repeat_reason_note
     from visit v join project p on p.id = v.project_id join customer c on c.id = p.customer_id join plan pl on pl.id = v.plan_id where v.id = $1`, [visitId]);
  const revisions = await q.query<{ id: string; revision_no: number; approval_state: string; change_reason: string | null; created_at: number; created_by: string | null; decided_by: string | null; decision_note: string | null; is_baseline: boolean; is_current: boolean }>(
    `select r.id, r.revision_no, r.approval_state, r.change_reason, r.created_at, cb.name created_by, db.name decided_by, r.decision_note,
       r.id = pl.baseline_revision_id is_baseline, r.id = pl.current_revision_id is_current
     from plan_revision r join plan pl on pl.id = r.plan_id left join employee cb on cb.id = r.created_by left join employee db on db.id = r.decided_by
     where r.plan_id = $1 order by r.revision_no desc`, [v.plan_id]);
  const orders = await q.query<{ id: string; business_id: string }>("select o.id, o.business_id from visit_order vo join sales_order o on o.id = vo.order_id where vo.visit_id = $1 order by 2", [visitId]);
  const scope = await q.query<{ id: string; task_id: string; task: string; component: string; activity: string; unit: string; quantity_kind: string; scoped: string; kind: string; status: string; status_reason: string | null; accepted: string }>(
    `select vt.id, t.id task_id, t.business_id task, c.name component, t.activity, t.unit, t.quantity_kind, vt.scoped_quantity::text scoped, vt.kind, vt.status, vt.status_reason,
       coalesce((select sum(quantity_delta) from progress_event pe where pe.visit_task_id = vt.id and pe.accepted), 0)::text accepted
     from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id where vt.visit_id = $1 order by c.business_id, t.step_order, vt.kind`, [visitId]);
  const availableTasks = await q.query<{ id: string; business_id: string; component: string; activity: string; unit: string; required: string }>(
    `select t.id, t.business_id, c.name component, t.activity, t.unit, t.required_quantity::text required from installation_task t join component c on c.id = t.component_id
     join order_item oi on oi.id = c.order_item_id where oi.order_id in (select order_id from visit_order where visit_id = $1) order by c.business_id, t.step_order`, [visitId]);
  const requirements = await q.query<{ skill_id: string; code: string; name: string; min_level: number; headcount: number; mode: string; source_complexity_label: string | null }>(
    "select r.skill_id, s.code, s.name, r.min_level, r.headcount, r.mode, r.source_complexity_label from skill_requirement r join skill s on s.id = r.skill_id where r.visit_id = $1 order by s.code", [visitId]);
  const staffing = await q.query<{ id: string; employee_id: string; employee: string; business_id: string; role: string; state: string; hold_expires_at: number | null }>(
    `select r.id, e.id employee_id, e.name employee, e.business_id, r.role, r.state, r.hold_expires_at from reservation r join employee e on e.id = r.employee_id
     where r.visit_id = $1 and r.state in ('proposed','held','confirmed') order by e.business_id`, [visitId]);
  const clearances = await q.query<{ id: string; gate: string; status: string; approver: string | null; decided_at: number | null; expected_date: string | null; valid_until: string | null; evidence: string | null; version: number }>(
    `select c.id, c.gate, c.status, e.name approver, c.decided_at, c.expected_date::text, c.valid_until::text, c.evidence, c.version
     from clearance c left join employee e on e.id = c.approver_id where c.visit_id = $1 order by c.gate`, [visitId]);
  const exceptions = await q.query<{ id: string; gate: string; reason: string; conditions: string; approved_by: string; valid_until: string; revoked: boolean }>(
    `select x.id, c.gate, x.reason, x.conditions, e.name approved_by, x.valid_until::text, x.revoked from clearance_exception x join clearance c on c.id = x.clearance_id
     join employee e on e.id = x.approved_by where c.visit_id = $1 order by x.approved_at desc`, [visitId]);
  const readiness = await q.query<{ check_code: string; required: boolean; result: string; na_reason: string | null; evidence: string | null; verifier: string | null; valid_until: string | null; checked_at: number | null }>(
    `select r.check_code, r.required, r.result, r.na_reason, r.evidence, e.name verifier, r.valid_until::text, r.checked_at from readiness_check r left join employee e on e.id = r.verifier_id
     where r.visit_id = $1 and r.component_id is null order by r.check_code`, [visitId]);
  const targets = await q.query<{ id: string; task: string; plan_date: string; target_quantity: string; frozen_at: number | null; is_current: boolean; change_reason: string | null }>(
    `select d.id, t.business_id task, d.plan_date::text, d.target_quantity::text, d.frozen_at, d.is_current, d.change_reason from daily_target d join visit_task vt on vt.id = d.visit_task_id
     join installation_task t on t.id = vt.task_id where vt.visit_id = $1 order by d.plan_date, t.business_id, d.created_at`, [visitId]);
  const progress = await q.query<{ id: string; task: string; quantity_delta: string; accepted: boolean; actor: string | null; at: number; reverses_event_id: string | null; evidence: string | null }>(
    `select pe.id, t.business_id task, pe.quantity_delta::text, pe.accepted, e.name actor, pe.at, pe.reverses_event_id, pe.evidence from progress_event pe join visit_task vt on vt.id = pe.visit_task_id
     join installation_task t on t.id = vt.task_id left join employee e on e.id = pe.actor_id where vt.visit_id = $1 order by pe.at desc`, [visitId]);
  const delays = await q.query<{ cause: string; start: number; end: number; responsible_function: string | null; employee_fault: string; impact: string | null; state: string }>(
    `select cause, lower(span) "start", upper(span) "end", responsible_function, employee_fault, impact, state from delay_event where visit_id = $1 order by lower(span)`, [visitId]);
  const acceptance = await q.query<{ signed_off: boolean; signed_by_name: string | null; accepted_on: string | null; evidence: string | null }>(
    "select signed_off, signed_by_name, accepted_on::text, evidence from acceptance where visit_id = $1 order by recorded_at desc", [visitId]);
  const today = localDateOf(now, v.timezone);
  const travel = await q.query<{ id: string; business_id: string; kind: string; origin: string; destination: string; planned_depart: number; planned_arrive: number; actual_depart: number | null; actual_arrive: number | null; certainty: string; travellers: string }>(
    `select l.id, l.business_id, l.kind, l.origin, l.destination, l.planned_depart, l.planned_arrive, l.actual_depart, l.actual_arrive, l.certainty,
       string_agg(e.name, ', ' order by e.business_id) travellers
     from travel_leg l join travel_participant tp on tp.leg_id = l.id join employee e on e.id = tp.employee_id where tp.visit_id = $1
     group by l.id order by l.planned_depart`, [visitId]);
  // Original vs revised: this visit as captured in the baseline and current approved revisions, and as it is now.
  type SnapVisit = { visitId: string; plannedStart: string | null; plannedEnd: string | null; teamSize: number; scope: Array<{ task: string; scoped_quantity: string; kind: string; status: string }>; staffing: Array<{ employee: string; state: string }>; requirements: Array<{ skill: string; min_level: number; headcount: number }>; estimate: { totalPersonMinutes: string } };
  const snaps = await q.query<{ role: string; snapshot: { visits: SnapVisit[] } }>(
    `select 'baseline' "role", r.snapshot from plan pl join plan_revision r on r.id = pl.baseline_revision_id where pl.id = $1
     union all select 'current', r.snapshot from plan pl join plan_revision r on r.id = pl.current_revision_id where pl.id = $1`, [v.plan_id]);
  const pick = (role: string) => snaps.find((x) => x.role === role)?.snapshot.visits.find((x) => x.visitId === visitId) ?? null;
  const live = (await buildSnapshot(q, v.plan_id)).visits.find((x) => x.visitId === visitId) as unknown as SnapVisit | undefined;
  return {
    travel, comparison: { baseline: pick("baseline"), current: pick("current"), live: live ?? null },
    visit: v, context: ctx!, revisions, orders, scope, availableTasks, requirements, staffing, clearances, exceptions, readiness, targets, progress, delays, acceptance,
    estimate: await estimateVisitScope(q, visitId),
    coverage: await visitCoverage(q, visitId),
    gate: await clearanceGate(q, visitId, v.planned_start ?? today),
    readinessGate: await readinessGate(q, visitId, today),
  };
}
