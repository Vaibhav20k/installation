/**
 * Reads for the dispatch and complaint flows: my pending steps, my team's pending steps, the record lists, the
 * management dashboard and Dispatch setup. Stage labels and owners come from each record's own flow version.
 */
import type { Queryable } from "../db/client";
import { requireAdmin, visibleEmployeeIds, type Actor } from "../auth/permissions";
import { forbidden } from "../errors";
import { ageDays, agingBucket, AGING_BUCKETS, stageOf, zFlowDefinition, type FlowDefinition, type StageSpec } from "@/domain/flow";
import { actorRoles, canSeeCost, canSeeFinanceFiles, flowFilter, loadDefinition, processFlowReminders, requireFlowView, stageRecipients, type SubjectType } from "../services/flow-core";

type Defs = Record<SubjectType, Map<number, FlowDefinition>>;

export async function allDefinitions(q: Queryable): Promise<Defs> {
  await loadDefinition(q, "dispatch");
  await loadDefinition(q, "complaint");
  const rows = await q.query<{ flow: SubjectType; version: number; definition: unknown }>("select flow, version, definition from flow_config");
  const out: Defs = { dispatch: new Map(), complaint: new Map() };
  for (const r of rows) out[r.flow].set(r.version, zFlowDefinition.parse(r.definition));
  return out;
}

export const stageFor = (defs: Defs, type: SubjectType, version: number, code: string): StageSpec | undefined => stageOf(defs[type].get(version)!, code);

export interface FlowItem {
  type: SubjectType; id: string; business_id: string; project_id: string; stage: string; stage_label: string; owner: string; owner_name: string;
  entered_at: number; days_in_stage: number; overdue: boolean; customer: string; project: string; order: string; title: string;
  hold_until: string | null; partial: boolean; status: string; created_at: number;
  /** Open complaints raised from this dispatch (always 0 on a complaint). */
  open_complaints: number;
}

/** Every open dispatch and complaint the actor may see, with its current stage resolved from its own version. */
export async function openItems(q: Queryable, actor: Actor, now: number, opts: { includeClosed?: boolean } = {}): Promise<FlowItem[]> {
  const defs = await allDefinitions(q);
  const f = await flowFilter(q, actor, "p", 1);
  const roleNames = new Map((await q.query<{ code: string; name: string }>("select code, name from flow_role")).map((r) => [r.code, r.name]));
  const status = opts.includeClosed ? "true" : "x.status = 'open'";
  const rows = await q.query<{ type: SubjectType; id: string; business_id: string; project_id: string; stage: string; config_version: number; stage_entered_at: number; created_at: number;
    customer: string; project: string; order_no: string; title: string; hold_until: string | null; partial: boolean; status: string; open_complaints: number }>(
    `select * from (
       select 'dispatch'::text type, x.id, x.business_id, x.project_id, x.stage, x.config_version, x.stage_entered_at, x.created_at, c.name customer, p.name project, o.business_id order_no,
              array_to_string(x.types, ' + ') || case when x.replacement_for is not null then ' · replacement' else '' end title, x.hold_until::text hold_until, x.partial, x.status,
              (select count(*)::int from complaint k where k.dispatch_id = x.id and k.status = 'open') open_complaints
       from dispatch x join project p on p.id = x.project_id join customer c on c.id = p.customer_id join sales_order o on o.id = x.order_id where ${status} and ${f.sql}
       union all
       select 'complaint', x.id, x.business_id, x.project_id, x.stage, x.config_version, x.stage_entered_at, x.created_at, c.name, p.name, o.business_id,
              initcap(x.kind) || ': ' || x.quantity::float::text || ' × ' || cm.name, null, false, x.status, 0
       from complaint x join project p on p.id = x.project_id join customer c on c.id = p.customer_id join sales_order o on o.id = x.order_id join component cm on cm.id = x.component_id
       where ${status} and ${f.sql}
     ) t order by stage_entered_at limit 1000`, f.params);
  return rows.map((r) => {
    const s = stageFor(defs, r.type, r.config_version, r.stage);
    const days = ageDays(Number(r.stage_entered_at), now);
    return {
      type: r.type, id: r.id, business_id: r.business_id, project_id: r.project_id, stage: r.stage, stage_label: s?.label ?? r.stage, owner: s?.owner ?? "system",
      owner_name: s?.owner === "system" ? "Automatic" : roleNames.get(s?.owner ?? "") ?? s?.owner ?? "", entered_at: Number(r.stage_entered_at), days_in_stage: days,
      overdue: !!s?.slaDays && days > s.slaDays && !r.hold_until, customer: r.customer.replace(/^Demo Customer /, ""), project: r.project, order: r.order_no, title: r.title,
      hold_until: r.hold_until, partial: r.partial, status: r.status, created_at: Number(r.created_at), open_complaints: Number(r.open_complaints),
    };
  });
}

/** Steps waiting for this person: open records whose current stage owner role they hold (and would be told about). */
export async function myPending(q: Queryable, actor: Actor, now: number) {
  await processFlowReminders(q, now);
  const roles = await actorRoles(q, actor.id);
  const items = await openItems(q, actor, now);
  const mine: FlowItem[] = [];
  const cache = new Map<string, string[]>();
  for (const i of items) {
    if (!roles.includes(i.owner)) continue;
    const key = `${i.owner}:${i.project_id}`;
    if (!cache.has(key)) cache.set(key, await stageRecipients(q, i.owner, i.project_id));
    if (cache.get(key)!.includes(actor.id)) mine.push(i);
  }
  return { roles, items: mine };
}

/** The reporting manager's view: each person below them who holds a department role, and what waits on them. */
export async function teamPending(q: Queryable, actor: Actor, now: number) {
  const ids = await visibleEmployeeIds(q, actor);
  const people = await q.query<{ id: string; business_id: string; name: string; roles: string[] }>(
    `select e.id, e.business_id, e.name, array_agg(m.role_code order by r.sort) roles from employee e join flow_role_member m on m.employee_id = e.id join flow_role r on r.code = m.role_code
     where e.active and e.id <> $1 ${ids === "all" ? "" : "and e.id = any($2::uuid[])"} group by e.id order by e.name`, ids === "all" ? [actor.id] : [actor.id, [...ids]]);
  if (!people.length) return [];
  const items = await openItems(q, { ...actor, role: "admin" }, now);
  const cache = new Map<string, string[]>();
  const out = [];
  for (const p of people) {
    const waiting: FlowItem[] = [];
    for (const i of items) {
      if (!p.roles.includes(i.owner)) continue;
      const key = `${i.owner}:${i.project_id}`;
      if (!cache.has(key)) cache.set(key, await stageRecipients(q, i.owner, i.project_id));
      if (cache.get(key)!.includes(p.id)) waiting.push(i);
    }
    out.push({ ...p, waiting, overdue: waiting.filter((w) => w.overdue).length, oldest: waiting.reduce((m, w) => Math.max(m, w.days_in_stage), 0) });
  }
  return out;
}

/** Management dashboard: orders by stage, open complaints, aging and complaint cost. */
export async function flowDashboard(q: Queryable, actor: Actor, now: number) {
  const f = await flowFilter(q, actor, "p", 1);
  if (!f.all && actor.role === "employee") throw forbidden("The dispatch dashboard is for management and department staff.");
  const items = await openItems(q, actor, now);
  const { def } = await loadDefinition(q, "dispatch");
  const cdef = (await loadDefinition(q, "complaint")).def;
  const count = (type: SubjectType, stages: StageSpec[]) => stages.filter((s) => !s.terminal).map((s) => {
    const at = items.filter((i) => i.type === type && i.stage === s.code);
    return { code: s.code, label: s.label, owner: s.owner, n: at.length, overdue: at.filter((i) => i.overdue).length, held: at.filter((i) => i.hold_until).length };
  });
  const aging = (type: SubjectType) => AGING_BUCKETS.map((b) => ({ bucket: b, n: items.filter((i) => i.type === type && agingBucket(ageDays(type === "complaint" ? i.created_at : i.entered_at, now)) === b).length }));
  const orders = await q.query<{ order_no: string; customer: string; project: string; dispatches: number; open: number; completed: number; complaints_open: number }>(
    `select o.business_id order_no, c.name customer, p.name project, count(distinct x.id)::int dispatches, count(distinct x.id) filter (where x.status = 'open')::int open,
       count(distinct x.id) filter (where x.status = 'completed')::int completed, count(distinct k.id) filter (where k.status = 'open')::int complaints_open
     from dispatch x join sales_order o on o.id = x.order_id join project p on p.id = x.project_id join customer c on c.id = p.customer_id left join complaint k on k.order_id = o.id
     where ${f.sql} group by o.id, c.name, p.name order by o.business_id`, f.params);
  const [cost] = await q.query<{ approved: string; awaiting: string; approved_n: number; awaiting_n: number; closed_n: number }>(
    `select coalesce(sum(k.cost) filter (where k.cost_approved_by is not null), 0)::text approved, coalesce(sum(k.cost) filter (where k.cost is not null and k.cost_approved_by is null and k.status = 'open'), 0)::text awaiting,
       count(*) filter (where k.cost_approved_by is not null)::int approved_n, count(*) filter (where k.cost is not null and k.cost_approved_by is null and k.status = 'open')::int awaiting_n,
       count(*) filter (where k.status = 'closed')::int closed_n
     from complaint k join project p on p.id = k.project_id where ${f.sql}`, f.params);
  const byKind = await q.query<{ kind: string; n: number }>(`select k.kind, count(*)::int n from complaint k join project p on p.id = k.project_id where k.status = 'open' and ${f.sql} group by k.kind`, f.params);
  return {
    dispatchStages: count("dispatch", def.stages), complaintStages: count("complaint", cdef.stages), dispatchAging: aging("dispatch"), complaintAging: aging("complaint"),
    orders: orders.map((o) => ({ ...o, customer: o.customer.replace(/^Demo Customer /, "") })), cost: (await canSeeCost(q, actor, null)) ? cost! : null, byKind,
    totals: { openDispatches: items.filter((i) => i.type === "dispatch").length, openComplaints: items.filter((i) => i.type === "complaint").length, overdue: items.filter((i) => i.overdue).length, partial: items.filter((i) => i.partial).length },
  };
}

export interface HistoryRow { id: string; from_stage: string | null; to_stage: string; kind: string; data: Record<string, unknown>; reason: string | null; actor: string | null; at: number; files: Array<{ id: string; name: string; mime: string; media_type: string }> }

async function history(q: Queryable, type: SubjectType, id: string): Promise<HistoryRow[]> {
  return q.query<HistoryRow>(
    `select h.id, h.from_stage, h.to_stage, h.kind, h.data, h.reason, e.name actor, h.at,
       coalesce((select json_agg(json_build_object('id', a.id, 'name', a.original_name, 'mime', a.mime, 'media_type', a.media_type) order by l.created_at)
                 from evidence_link l join evidence_asset a on a.id = l.asset_id where l.parent_type = 'stage_history' and l.parent_id = h.id and l.status = 'active' and a.state = 'ready'), '[]') files
     from stage_history h left join employee e on e.id = h.actor_id where h.subject_type = $1 and h.subject_id = $2 order by h.seq`, [type, id]);
}

/** What the viewer may do on the current stage. */
async function rights(q: Queryable, actor: Actor, stage: StageSpec | undefined, projectId: string) {
  const roles = await actorRoles(q, actor.id);
  if (!stage || stage.owner === "system" || stage.terminal) return { canAct: false, canBack: false, roles };
  const owner = roles.includes(stage.owner) && (stage.owner !== "installation_manager" || (await stageRecipients(q, stage.owner, projectId)).includes(actor.id) || actor.role === "admin");
  return { canAct: owner, canBack: (owner || roles.includes("management")) && !!stage.backTo?.length, roles };
}

export async function dispatchDetail(q: Queryable, actor: Actor, id: string, now: number) {
  const [d] = await q.query<{ id: string; business_id: string; order_id: string; project_id: string; types: string[]; factory: string; stage: string; status: string; version: number; config_version: number;
    stage_entered_at: number; hold_reason: string | null; hold_until: string | null; partial: boolean; replacement_for: string | null; replacement_no: string | null; order_no: string; customer: string; project: string; city: string; site_address: string; created_at: number }>(
    `select x.*, x.hold_until::text hold_until, k.business_id replacement_no, o.business_id order_no, c.name customer, p.name project, p.city, p.site_address
     from dispatch x join sales_order o on o.id = x.order_id join project p on p.id = x.project_id join customer c on c.id = p.customer_id left join complaint k on k.id = x.replacement_for where x.id = $1`, [id]);
  if (!d) return null;
  await requireFlowView(q, actor, d.project_id);
  const { def } = await loadDefinition(q, "dispatch", d.config_version);
  const stage = stageOf(def, d.stage);
  const [items, complaints, hist, r] = await Promise.all([
    // Factory-list lines first, then items reported on site that were not on the list.
    q.query<{ id: string; component_id: string; name: string; quantity: string; unit: string; dispatch_group: string | null; received_ok: boolean | null; unlisted: boolean; product_type: string | null }>(
      "select di.id, di.component_id, c.name, di.quantity::float::text quantity, c.unit, c.dispatch_group, di.received_ok, c.unlisted, c.product_type from dispatch_item di join component c on c.id = di.component_id where di.dispatch_id = $1 order by c.unlisted, c.business_id", [id]),
    q.query<{ id: string; business_id: string; kind: string; quantity: string; item: string; stage: string; status: string; config_version: number; outcome: string | null; priority: string; unlisted: boolean }>(
      "select k.id, k.business_id, k.kind, k.quantity::float::text quantity, c.name item, k.stage, k.status, k.config_version, k.outcome, k.priority, c.unlisted from complaint k join component c on c.id = k.component_id where k.dispatch_id = $1 order by k.business_id", [id]),
    history(q, "dispatch", id),
    rights(q, actor, stage, d.project_id),
  ]);
  const defs = await allDefinitions(q);
  return {
    ...d, customer: d.customer.replace(/^Demo Customer /, ""), def, step: stage, items, ...r,
    // Files on Accounts-owned steps (tax invoice, e-way bill) are listed only for those allowed to open them.
    history: (await canSeeFinanceFiles(q, actor, d.project_id)) ? hist : hist.map((h) => (h.from_stage && stageOf(def, h.from_stage)?.owner === "accounts" ? { ...h, files: [] } : h)), days_in_stage: ageDays(Number(d.stage_entered_at), now),
    complaints: complaints.map((k) => ({ ...k, stage_label: stageFor(defs, "complaint", k.config_version, k.stage)?.label ?? k.stage })),
  };
}

export async function complaintDetail(q: Queryable, actor: Actor, id: string, now: number) {
  const [k] = await q.query<{ id: string; business_id: string; dispatch_id: string; dispatch_no: string; factory: string; order_no: string; project_id: string; customer: string; project: string; item: string; unit: string;
    kind: string; quantity: string; reason: string; stage: string; status: string; outcome: string | null; version: number; config_version: number; stage_entered_at: number; created_at: number; cost: string | null; costed_by: string | null;
    costed_by_name: string | null; approved_by_name: string | null; item_source: string | null; replacement_dispatch_id: string | null; replacement_no: string | null; superseded_by: string | null; superseded_no: string | null;
    priority: string; unlisted: boolean; product_type: string | null }>(
    `select k.*, k.quantity::float::text quantity, k.cost::text cost, d.business_id dispatch_no, d.factory, o.business_id order_no, c.name customer, p.name project, cm.name item, cm.unit, cm.unlisted, cm.product_type,
       ce.name costed_by_name, ae.name approved_by_name, rd.business_id replacement_no, sk.business_id superseded_no
     from complaint k join dispatch d on d.id = k.dispatch_id join sales_order o on o.id = k.order_id join project p on p.id = k.project_id join customer c on c.id = p.customer_id
     join component cm on cm.id = k.component_id left join employee ce on ce.id = k.costed_by left join employee ae on ae.id = k.cost_approved_by
     left join dispatch rd on rd.id = k.replacement_dispatch_id left join complaint sk on sk.id = k.superseded_by where k.id = $1`, [id]);
  if (!k) return null;
  await requireFlowView(q, actor, k.project_id);
  const { def } = await loadDefinition(q, "complaint", k.config_version);
  const stage = stageOf(def, k.stage);
  const [hist, r] = await Promise.all([history(q, "complaint", id), rights(q, actor, stage, k.project_id)]);
  // Cost and who set it are for Planning, Management, admins and the project's managers (break-it finding F1).
  if (!(await canSeeCost(q, actor, k.project_id))) {
    return { ...k, cost: null, costed_by_name: null, approved_by_name: null, customer: k.customer.replace(/^Demo Customer /, ""), def, step: stage, ...r, days_in_stage: ageDays(Number(k.stage_entered_at), now),
      history: hist.map((h) => ({ ...h, data: Object.fromEntries(Object.entries(h.data).filter(([key]) => key !== "cost")) })) };
  }
  return { ...k, customer: k.customer.replace(/^Demo Customer /, ""), def, step: stage, history: hist, ...r, days_in_stage: ageDays(Number(k.stage_entered_at), now) };
}

/** Orders and their BOM lines with what is left to dispatch, for the factory's "Ready for dispatch" screen. */
export async function dispatchableOrders(q: Queryable, actor: Actor) {
  const f = await flowFilter(q, actor, "p", 1);
  const orders = await q.query<{ id: string; business_id: string; status: string; customer: string; project: string; city: string }>(
    `select o.id, o.business_id, o.status, c.name customer, p.name project, p.city from sales_order o join project p on p.id = o.project_id join customer c on c.id = p.customer_id
     where o.status not in ('cancelled','closed') and ${f.sql} order by o.business_id`, f.params);
  const lines = await q.query<{ id: string; order_id: string; business_id: string; name: string; unit: string; quantity: string; dispatch_group: string | null; sent: string }>(
    `select c.id, oi.order_id, c.business_id, c.name, c.unit, c.quantity::float::text quantity, c.dispatch_group,
       coalesce((select sum(di.quantity) from dispatch_item di join dispatch x on x.id = di.dispatch_id where di.component_id = c.id and x.status <> 'cancelled' and x.replacement_for is null), 0)::float::text sent
     from component c join order_item oi on oi.id = c.order_item_id where oi.order_id = any($1::uuid[]) and not c.unlisted order by c.business_id`, [orders.map((o) => o.id)]);
  const { def } = await loadDefinition(q, "dispatch");
  return {
    orders: orders.map((o) => ({ ...o, customer: o.customer.replace(/^Demo Customer /, ""), lines: lines.filter((l) => l.order_id === o.id).map((l) => ({ ...l, left: String(Math.max(0, Number(l.quantity) - Number(l.sent))) })) })),
    types: def.dispatchTypes ?? [], factories: def.factories ?? [], canCreate: f.roles.includes(def.stages[0]!.owner),
  };
}

/** Dispatch setup (administrators): roles and their members, and every saved flow version. */
export async function flowSetup(q: Queryable, actor: Actor) {
  requireAdmin(actor, "dispatch setup");
  await loadDefinition(q, "dispatch");
  await loadDefinition(q, "complaint");
  const [roles, members, people, versions] = await Promise.all([
    q.query<{ code: string; name: string; description: string }>("select code, name, description from flow_role order by sort"),
    q.query<{ role_code: string; employee_id: string; name: string; business_id: string }>("select m.role_code, e.id employee_id, e.name, e.business_id from flow_role_member m join employee e on e.id = m.employee_id order by e.name"),
    q.query<{ id: string; name: string; business_id: string; job_role: string }>("select id, name, business_id, job_role from employee where active order by name"),
    q.query<{ flow: string; version: number; active: boolean; note: string | null; created_at: number; by: string | null; definition: unknown; in_use: number }>(
      `select f.flow, f.version, f.active, f.note, f.created_at, e.name by, f.definition,
         (case when f.flow = 'dispatch' then (select count(*) from dispatch where config_version = f.version and status = 'open') else (select count(*) from complaint where config_version = f.version and status = 'open') end)::int in_use
       from flow_config f left join employee e on e.id = f.created_by order by f.flow, f.version desc`),
  ]);
  return { roles: roles.map((r) => ({ ...r, members: members.filter((m) => m.role_code === r.code) })), people, versions };
}
