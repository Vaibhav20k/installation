/**
 * The Factory workspace's home pipeline and Complaints queue (design: docs/plans/workspaces-design.md §2.2).
 * Six tiles in the order the factory thinks about its work, from "what is left to send" to "what replacement do I
 * make next", and the records behind each tile.
 *
 * Counting rules (a tile's count is always its list's length):
 * - To send counts ORDERS that still have BOM quantity to dispatch (dispatchableOrders' "left" maths: lines with
 *   left > 0; unlisted lines are not factory BOM and never count).
 * - At site check / Accounts / Ready to load / On the truck count open DISPATCHES (truckloads) by the step they wait for:
 *   site_readiness → At site check; tax_invoice, eway_bill → Accounts; dispatched → Ready to load; received → On the truck.
 *   Later site stages belong to the Installation workspace and are not shown here.
 * - Replacements counts open COMPLAINTS, with a count per phase (Planning · Purchase · QC · Production · Ready to send).
 * Scope: openItems / dispatchableOrders, which use flowFilter, exactly as on Dispatch. Nothing here widens what the viewer
 * may see, and complaint cost is never selected. A button appears only for a role the viewer holds (as on Dispatch).
 */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { ageDays } from "@/domain/flow";
import { PHASES, STAGE_PHASE, phaseOf, type PhaseCode } from "@/domain/complaint-phases";
import { actorRoles, flowFilter } from "../services/flow-core";
import { allDefinitions, dispatchableOrders, openItems, stageFor, type FlowItem } from "./dispatch";
import { RECENT_CLOSED_DAYS } from "./complaint-tracker";

export const FTILE_KEYS = ["send", "site", "accounts", "load", "truck", "replace"] as const;
export type FTileKey = (typeof FTILE_KEYS)[number];

export interface FTileSpec { key: FTileKey; label: string; hint: string; unit: string }
export const FACTORY_TILES: readonly FTileSpec[] = [
  { key: "send", label: "To send", hint: "Orders with items left to dispatch", unit: "Counted per order." },
  { key: "site", label: "At site check", hint: "Waiting for the Installation Manager to confirm the site", unit: "Counted per dispatch (truckload)." },
  { key: "accounts", label: "Accounts", hint: "Tax invoice and e-way bill", unit: "Counted per dispatch (truckload)." },
  { key: "load", label: "Ready to load", hint: "E-way bill done, not dispatched yet", unit: "Counted per dispatch (truckload)." },
  { key: "truck", label: "On the truck", hint: "Dispatched, not received at site yet", unit: "Counted per dispatch (truckload)." },
  { key: "replace", label: "Replacements", hint: "Open complaints the factory is replacing", unit: "Counted per complaint." },
];

export const isFTileKey = (s: string | undefined): s is FTileKey => !!s && (FTILE_KEYS as readonly string[]).includes(s);

const DISPATCH_TILE: Readonly<Record<string, FTileKey>> = { site_readiness: "site", tax_invoice: "accounts", eway_bill: "accounts", dispatched: "load", received: "truck" };

/** The tile an open dispatch belongs to, from the step it waits for; null for a stage outside the factory's side. */
export const dispatchTile = (stage: string): FTileKey | null => DISPATCH_TILE[stage] ?? null;

/** The factory-side button for a dispatch stage, and the role that owns it. */
export const DISPATCH_ACTION: Readonly<Record<string, { role: string; label: string }>> = {
  tax_invoice: { role: "accounts", label: "Add tax invoice" },
  eway_bill: { role: "accounts", label: "Add e-way bill" },
  dispatched: { role: "factory_dispatch", label: "Record dispatch" },
};

/** What a dispatch row shows when the step is not the viewer's. */
export function dispatchWaiting(stage: string, ownerName = ""): string {
  if (stage === "site_readiness") return "Waiting for the Installation Manager";
  if (stage === "tax_invoice" || stage === "eway_bill") return "Waiting for accounts";
  if (stage === "dispatched") return "Waiting for factory dispatch";
  if (stage === "received") return "Waiting for site";
  return `Waiting for ${ownerName || "the next step"}`;
}

/** The factory reads the last complaint phase as "Ready to send"; the domain phase key stays "dispatched". */
export const factoryPhaseLabel = (p: PhaseCode | "done") => (p === "done" ? "Closed" : p === "dispatched" ? "Ready to send" : PHASES.find((x) => x.code === p)!.label);
export const FACTORY_PHASES = PHASES.map((p) => ({ code: p.code, label: factoryPhaseLabel(p.code) }));
export const isPhaseCode = (s: string | undefined): s is PhaseCode => PHASES.some((p) => p.code === s);

/** The button on a complaint step the viewer owns, in the step's own words. */
export const COMPLAINT_ACTION: Readonly<Record<string, string>> = {
  qc_review: "Review complaint", planning_costing: "Add cost", management_approval: "Decide on cost", planning_replacement: "Plan replacement",
  store_check: "Check store", purchase: "Record purchase", iqc: "Check material", store_issue: "Issue from store", production: "Record production",
  packaging: "Record packing", ready_for_dispatch: "Send replacement",
};
export const complaintAction = (stage: string, label: string) => COMPLAINT_ACTION[stage] ?? label;
export const complaintWaiting = (owner: string, ownerName: string) => (owner === "system" ? "On its way to site" : `Waiting for ${ownerName || owner.replace(/_/g, " ")}`);

/** Flow order of complaint steps (shipped flow); steps an administrator adds later sort after them. */
const STEP_ORDER = Object.keys(STAGE_PHASE);
export const stepRank = (stage: string) => { const i = STEP_ORDER.indexOf(stage); return i < 0 ? STEP_ORDER.length : i; };

/** A factory department role: any flow role except the Installation Manager's. */
export const hasFactoryRole = (roles: readonly string[]) => roles.some((r) => r !== "installation_manager");

export interface FactoryRow {
  key: string; href: string | null; title: string; code: string; what: string; stage_label: string;
  days: number | null; overdue: boolean; action: { label: string; href: string } | null; waiting: string | null;
  priority?: string | null;
}
export interface FactoryTile extends FTileSpec { n: number; overdue: number; mine: number }
export interface PhaseCount { code: PhaseCode; label: string; n: number; overdue: number }

const byUrgency = (a: FactoryRow, b: FactoryRow) => Number(b.overdue) - Number(a.overdue) || (b.days ?? 0) - (a.days ?? 0);

function complaintRow(i: FlowItem, roles: readonly string[], priority: string | null): FactoryRow {
  const mine = i.owner !== "system" && roles.includes(i.owner);
  const phase = phaseOf(i.stage, i.owner);
  return {
    key: i.id, href: `/dispatch/complaints/${i.id}`, title: i.title, code: i.business_id, what: `${i.order} · ${i.customer}`,
    stage_label: `${factoryPhaseLabel(phase)} · ${i.stage_label}`, days: i.days_in_stage, overdue: i.overdue, priority,
    action: mine ? { label: complaintAction(i.stage, i.stage_label), href: `/dispatch/complaints/${i.id}#h-now` } : null,
    waiting: mine ? null : complaintWaiting(i.owner, i.owner_name),
  };
}

export async function factoryPipeline(q: Queryable, actor: Actor, now: number): Promise<{
  tiles: FactoryTile[]; rows: Record<FTileKey, FactoryRow[]>; phases: PhaseCount[]; yourSteps: FactoryRow[] | null;
}> {
  const roles = await actorRoles(q, actor.id);
  const [items, orders] = await Promise.all([openItems(q, actor, now), dispatchableOrders(q, actor)]);
  const rows = Object.fromEntries(FTILE_KEYS.map((k) => [k, [] as FactoryRow[]])) as Record<FTileKey, FactoryRow[]>;

  for (const o of orders.orders) {
    const left = o.lines.filter((l) => Number(l.left) > 0);
    if (!left.length) continue;
    const groups = [...new Set(left.map((l) => l.dispatch_group).filter((g): g is string => !!g))];
    const href = orders.canCreate ? `/dispatch/new?order=${o.id}` : null;
    rows.send.push({
      key: o.id, href, title: `${o.customer} · ${o.project}`, code: o.business_id,
      what: `${left.length} item${left.length === 1 ? "" : "s"} left${groups.length ? ` · ${groups.join(", ")}` : ""}`, stage_label: "To send",
      days: null, overdue: false, action: href ? { label: "Mark ready for dispatch", href } : null, waiting: href ? null : "Waiting for factory dispatch",
    });
  }

  const complaints = items.filter((i) => i.type === "complaint");
  const priorities = new Map((complaints.length ? await q.query<{ id: string; priority: string }>(
    "select id, priority from complaint where id = any($1::uuid[])", [complaints.map((c) => c.id)]) : []).map((r) => [r.id, r.priority]));
  for (const i of items) {
    if (i.type === "complaint") { rows.replace.push(complaintRow(i, roles, priorities.get(i.id) ?? null)); continue; }
    const tile = dispatchTile(i.stage);
    if (!tile) continue;
    const act = DISPATCH_ACTION[i.stage];
    const mine = !!act && roles.includes(act.role);
    rows[tile].push({
      key: i.id, href: `/dispatch/${i.id}`, title: `${i.customer} · ${i.project}`, code: i.business_id, what: `${i.order} · ${i.title}`, stage_label: i.stage_label,
      days: i.days_in_stage, overdue: i.overdue, action: mine ? { label: act.label, href: `/dispatch/${i.id}#h-now` } : null,
      waiting: mine ? null : dispatchWaiting(i.stage, i.owner_name),
    });
  }
  for (const k of FTILE_KEYS) if (k !== "send") rows[k].sort(byUrgency);

  const phases = FACTORY_PHASES.map((p) => {
    const at = complaints.filter((c) => phaseOf(c.stage, c.owner) === p.code);
    return { ...p, n: at.length, overdue: at.filter((c) => c.overdue).length };
  });
  const yourSteps = hasFactoryRole(roles) ? rows.replace.filter((r) => r.action) : null;
  const tiles = FACTORY_TILES.map((t) => ({ ...t, n: rows[t.key].length, overdue: rows[t.key].filter((r) => r.overdue).length, mine: rows[t.key].filter((r) => r.action).length }));
  return { tiles, rows, phases, yourSteps };
}

/** The tile open by default: the first tile with something the viewer can act on, else the first non-empty tile. */
export function defaultFactoryTile(tiles: readonly { key: FTileKey; n: number; mine: number }[]): FTileKey {
  return (tiles.find((t) => t.mine > 0) ?? tiles.find((t) => t.n > 0) ?? tiles[0]!).key;
}

/* ---------- The Complaints queue (/complaints) ---------- */

export interface QueueComplaint {
  id: string; business_id: string; kind: "missing" | "damaged"; quantity: string; unit: string; item: string; unlisted: boolean;
  priority: "normal" | "high" | "urgent"; order: string; customer: string; project: string; status: "open" | "closed";
  stage: string; stage_label: string; phase: PhaseCode | "done"; owner: string; owner_name: string;
  days: number; overdue: boolean; mine: boolean; created_at: number; closed_at: number | null;
}

/** Open complaints and those closed in the last 30 days, in the viewer's flow scope, with the step owner. No cost. */
export async function factoryComplaints(q: Queryable, actor: Actor, now: number): Promise<QueueComplaint[]> {
  const defs = await allDefinitions(q);
  const f = await flowFilter(q, actor, "p", 1);
  const since = new Date(now - RECENT_CLOSED_DAYS * 86_400_000).toISOString();
  const roleNames = new Map((await q.query<{ code: string; name: string }>("select code, name from flow_role")).map((r) => [r.code, r.name]));
  const rows = await q.query<{ id: string; business_id: string; kind: "missing" | "damaged"; quantity: string; unit: string | null; item: string; unlisted: boolean; priority: string;
    order_no: string; customer: string; project: string; status: "open" | "closed"; stage: string; config_version: number; stage_entered_at: number; created_at: number; closed_at: number | null }>(
    `select x.id, x.business_id, x.kind, x.quantity::float::text quantity, cm.unit, cm.name item, cm.unlisted, x.priority::text priority, o.business_id order_no,
            c.name customer, p.name project, x.status, x.stage, x.config_version, x.stage_entered_at, x.created_at, x.closed_at
     from complaint x join project p on p.id = x.project_id join customer c on c.id = p.customer_id join sales_order o on o.id = x.order_id
     join component cm on cm.id = x.component_id
     where (x.status = 'open' or x.closed_at >= $${f.params.length + 1}) and ${f.sql}
     order by x.created_at limit 500`, [...f.params, since]);
  return rows.map((r): QueueComplaint => {
    const s = stageFor(defs, "complaint", r.config_version, r.stage);
    const open = r.status === "open";
    const owner = s?.owner ?? "system";
    const days = open ? ageDays(Number(r.stage_entered_at), now) : 0;
    return {
      id: r.id, business_id: r.business_id, kind: r.kind, quantity: r.quantity, unit: r.unit ?? "", item: r.item, unlisted: !!r.unlisted,
      priority: r.priority === "high" || r.priority === "urgent" ? r.priority : "normal", order: r.order_no, customer: r.customer.replace(/^Demo Customer /, ""),
      project: r.project, status: r.status, stage: r.stage, stage_label: s?.label ?? r.stage, phase: open ? phaseOf(r.stage, owner, s?.terminal) : "done",
      owner, owner_name: owner === "system" ? "Automatic" : roleNames.get(owner) ?? owner, days, overdue: open && !!s?.slaDays && days > s.slaDays,
      mine: open && owner !== "system" && f.roles.includes(owner), created_at: Number(r.created_at), closed_at: r.closed_at ? Number(r.closed_at) : null,
    };
  });
}

export type PhaseFilter = PhaseCode | "all";
export interface QueueGroup { stage: string; label: string; phase: PhaseCode | "done"; rows: QueueComplaint[]; mine: number; overdue: number }

/** Your steps first, then overdue, then longest in the step. */
const queueOrder = (a: QueueComplaint, b: QueueComplaint) => Number(b.mine) - Number(a.mine) || Number(b.overdue) - Number(a.overdue) || b.days - a.days || a.created_at - b.created_at;

/** Counts for the chips: every open complaint, and per phase. */
export function queueCounts(list: readonly QueueComplaint[]) {
  const open = list.filter((c) => c.status === "open");
  const byPhase = Object.fromEntries(PHASES.map((p) => [p.code, 0])) as Record<PhaseCode, number>;
  const overdueByPhase = { ...byPhase };
  for (const c of open) if (c.phase !== "done") { byPhase[c.phase] += 1; if (c.overdue) overdueByPhase[c.phase] += 1; }
  return { open: open.length, closed: list.length - open.length, overdue: open.filter((c) => c.overdue).length, mine: open.filter((c) => c.mine).length, byPhase, overdueByPhase };
}

/** Where a person lands with no ?phase: the phase that holds their most urgent step, else All. */
export function landingPhase(list: readonly QueueComplaint[]): PhaseFilter {
  const top = list.filter((c) => c.status === "open" && c.mine).sort(queueOrder)[0];
  return top && top.phase !== "done" ? top.phase : "all";
}

export function parseQueueFilter(sp: { phase?: string; show?: string }, list: readonly QueueComplaint[]): { show: "open" | "closed"; phase: PhaseFilter } {
  const show = sp.show === "closed" ? "closed" : "open";
  if (show === "closed") return { show, phase: "all" };
  return { show, phase: sp.phase === "all" ? "all" : isPhaseCode(sp.phase) ? sp.phase : landingPhase(list) };
}

/**
 * The rows shown, grouped by detailed step in flow order (Planning → QC review, Costing, …). Closed complaints form
 * one group, newest first. Inside a group, the viewer's own steps come first.
 */
export function groupQueue(list: readonly QueueComplaint[], show: "open" | "closed", phase: PhaseFilter): QueueGroup[] {
  if (show === "closed") {
    const rows = list.filter((c) => c.status === "closed").sort((a, b) => (b.closed_at ?? 0) - (a.closed_at ?? 0));
    return rows.length ? [{ stage: "closed", label: "Closed", phase: "done", rows, mine: 0, overdue: 0 }] : [];
  }
  const shown = list.filter((c) => c.status === "open" && (phase === "all" || c.phase === phase));
  const groups = new Map<string, QueueGroup>();
  for (const c of shown) {
    const g = groups.get(c.stage) ?? { stage: c.stage, label: c.stage_label, phase: c.phase, rows: [], mine: 0, overdue: 0 };
    g.rows.push(c); g.mine += Number(c.mine); g.overdue += Number(c.overdue);
    groups.set(c.stage, g);
  }
  const out = [...groups.values()].sort((a, b) => stepRank(a.stage) - stepRank(b.stage) || a.label.localeCompare(b.label));
  for (const g of out) g.rows.sort(queueOrder);
  return out;
}
