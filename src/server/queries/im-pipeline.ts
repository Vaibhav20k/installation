/**
 * The Installation Manager's pipeline on the Overview: seven tiles in the order an IM thinks about a kitchen, from
 * "the factory says it is ready" to "handed over to the customer", and the records behind each tile.
 *
 * Counting rules (each record sits in exactly one tile, and a tile's count is its list's length):
 * - Tiles 1-6 count dispatches (truckloads). Each truck moves through the flow on its own and every step form is
 *   per dispatch, so that is the unit an IM acts on. A dispatch's current stage is the step being waited for:
 *   - Ready for dispatch: waiting on Site readiness, Tax invoice, E-way bill or Dispatched (not yet on a truck).
 *   - Dispatched: waiting on Received & MND (on its way or at the gate, not yet checked).
 *   - Received: waiting on Installation started (checked at site, work not begun).
 *   - 1st / 2nd / 3rd installation: waiting on Installation done (work under way), by what the truck carries:
 *     Carcass (D1) / Shutters (D2) / Countertop + backsplash (D3, D3a, D3b). A truck carrying several types counts
 *     once, in its earliest installation. Replacement trucks count by what they carry.
 * - Final handover counts projects, because the customer journey (and the handover) is one per site: no open
 *   dispatch, at least one completed, every carcass/shutter/countertop/backsplash BOM line fully dispatched, and the
 *   journey not yet at Handover or Closed.
 * Scope: openItems / flowFilter, exactly as on Dispatch. Nothing here widens what the viewer may see.
 */
import type { Queryable } from "../db/client";
import { atLeast, type Actor } from "../auth/permissions";
import { ageDays } from "@/domain/flow";
import { actorRoles, flowFilter, loadDefinition, stageRecipients } from "../services/flow-core";
import { openItems, type FlowItem } from "./dispatch";

export const TILE_KEYS = ["ready", "dispatched", "received", "install1", "install2", "install3", "handover"] as const;
export type TileKey = (typeof TILE_KEYS)[number];

export interface TileSpec { key: TileKey; label: string; sub?: string; hint: string }
export const TILES: readonly TileSpec[] = [
  { key: "ready", label: "Ready for dispatch", hint: "Factory has it ready, not on a truck yet" },
  { key: "dispatched", label: "Dispatched", hint: "On the truck, to check at site" },
  { key: "received", label: "Received", hint: "Checked at site, work not started" },
  { key: "install1", label: "1st installation", sub: "Carcass", hint: "Carcass being fitted" },
  { key: "install2", label: "2nd installation", sub: "Shutters", hint: "Shutters being fitted" },
  { key: "install3", label: "3rd installation", sub: "Countertop", hint: "Countertop and backsplash being fitted" },
  { key: "handover", label: "Final handover", hint: "All fitted, not handed over yet" },
];

export const isTileKey = (s: string | undefined): s is TileKey => !!s && (TILE_KEYS as readonly string[]).includes(s);

const BEFORE_TRUCK = new Set(["ready_for_dispatch", "site_readiness", "tax_invoice", "eway_bill", "dispatched"]);
const GROUP_RANK: Record<string, 1 | 2 | 3> = { carcass: 1, shutters: 2, countertop: 3, backsplash: 3 };
const CODE_RANK: Record<string, 1 | 2 | 3> = { D1: 1, D2: 2, D3: 3, D3a: 3, D3b: 3 };

/**
 * Which installation (1st, 2nd, 3rd) a truck belongs to: the earliest of the types it carries. A type is known by its
 * code, or else by the BOM groups the flow definition gives it. A truck of unknown types counts as the 1st.
 */
export function installRank(types: readonly string[], groupsOf: (code: string) => readonly string[] = () => []): 1 | 2 | 3 {
  const ranks = types.map((t) => CODE_RANK[t] ?? Math.min(4, ...groupsOf(t).map((g) => GROUP_RANK[g] ?? 4))).filter((r) => r <= 3) as Array<1 | 2 | 3>;
  return ranks.length ? (Math.min(...ranks) as 1 | 2 | 3) : 1;
}

/** The tile an open dispatch belongs to, from the step it waits for and what it carries; null for a stage outside the IM's path. */
export function tileFor(stage: string, types: readonly string[], groupsOf?: (code: string) => readonly string[]): TileKey | null {
  if (BEFORE_TRUCK.has(stage)) return "ready";
  if (stage === "received") return "dispatched";
  if (stage === "installation_started") return "received";
  if (stage === "installation_done") return `install${installRank(types, groupsOf)}` as TileKey;
  return null;
}

/** The IM's button for a stage they own, in site words. */
export const IM_ACTION: Record<string, string> = {
  site_readiness: "Confirm site ready", received: "Mark received", installation_started: "Start installation", installation_done: "Installation done",
};

/** What a row shows when the next step belongs to someone else. */
export function waitingFor(owner: string, ownerName: string): string {
  if (owner === "factory_dispatch") return "Waiting for factory";
  if (owner === "accounts") return "Waiting for accounts";
  if (owner === "installation_manager") return "Waiting for the Installation Manager";
  if (owner === "system") return "Moves on by itself";
  return `Waiting for ${ownerName || owner.replace(/_/g, " ")}`;
}

export interface PipelineRow {
  key: string; href: string; customer: string; project: string; code: string; what: string; stage_label: string;
  days: number; overdue: boolean; hold_until: string | null; partial: boolean;
  action: { label: string; href: string } | null; waiting: string | null;
}
export interface PipelineTile extends TileSpec { n: number; overdue: number; mine: number }

/** Whether this viewer gets the pipeline: an Installation Manager (flow role) or an administrator. */
export async function seesPipeline(q: Queryable, actor: Actor) {
  return actor.role === "admin" || (await actorRoles(q, actor.id)).includes("installation_manager");
}

export async function imPipeline(q: Queryable, actor: Actor, now: number): Promise<{ tiles: PipelineTile[]; rows: Record<TileKey, PipelineRow[]> } | null> {
  if (!(await seesPipeline(q, actor))) return null;
  const roles = await actorRoles(q, actor.id);
  const { def } = await loadDefinition(q, "dispatch");
  const typeDefs = new Map((def.dispatchTypes ?? []).map((t) => [t.code, t]));
  const groupsOf = (code: string) => typeDefs.get(code)?.groups ?? [];
  const typeLabel = (code: string) => (typeDefs.get(code) ? `${code} ${typeDefs.get(code)!.label}` : code);

  const items = (await openItems(q, actor, now)).filter((i) => i.type === "dispatch");
  const types = new Map((items.length ? await q.query<{ id: string; types: string[]; replacement: boolean }>(
    "select id, types, replacement_for is not null replacement from dispatch where id = any($1::uuid[])", [items.map((i) => i.id)]) : []).map((r) => [r.id, r]));

  // The IM acts only on their own projects (the same test the dispatch page uses); an admin acts only if they hold the role.
  const recipients = new Map<string, string[]>();
  const canAct = async (i: FlowItem) => {
    if (i.owner !== "installation_manager" || !roles.includes("installation_manager")) return false;
    if (actor.role === "admin") return true;
    if (!recipients.has(i.project_id)) recipients.set(i.project_id, await stageRecipients(q, "installation_manager", i.project_id));
    return recipients.get(i.project_id)!.includes(actor.id);
  };

  const rows = Object.fromEntries(TILE_KEYS.map((k) => [k, [] as PipelineRow[]])) as Record<TileKey, PipelineRow[]>;
  for (const i of items) {
    const t = types.get(i.id);
    const tile = tileFor(i.stage, t?.types ?? [], groupsOf);
    if (!tile) continue;
    const mine = await canAct(i);
    rows[tile].push({
      key: i.id, href: `/dispatch/${i.id}`, customer: i.customer, project: i.project, code: i.business_id,
      what: `${(t?.types ?? []).map(typeLabel).join(" + ")}${t?.replacement ? " · replacement" : ""}`, stage_label: i.stage_label,
      days: i.days_in_stage, overdue: i.overdue, hold_until: i.hold_until, partial: i.partial,
      action: mine && IM_ACTION[i.stage] ? { label: IM_ACTION[i.stage]!, href: `/dispatch/${i.id}#h-now` } : null,
      waiting: mine && IM_ACTION[i.stage] ? null : waitingFor(i.owner, i.owner_name),
    });
  }
  rows.handover = await handoverRows(q, actor, now);
  for (const k of TILE_KEYS) rows[k].sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.days - a.days);

  const tiles = TILES.map((t) => ({ ...t, n: rows[t.key].length, overdue: rows[t.key].filter((r) => r.overdue).length, mine: rows[t.key].filter((r) => r.action).length }));
  return { tiles, rows };
}

/** Projects ready for the final handover (see the file comment), in the viewer's flow scope. */
async function handoverRows(q: Queryable, actor: Actor, now: number): Promise<PipelineRow[]> {
  const f = await flowFilter(q, actor, "p", 1);
  const rows = await q.query<{ id: string; customer: string; project: string; business_id: string; done_at: number; trucks: number }>(
    `select p.id, c.name customer, p.name project, p.business_id,
       (select max(x.stage_entered_at) from dispatch x where x.project_id = p.id and x.status = 'completed') done_at,
       (select count(*)::int from dispatch x where x.project_id = p.id and x.status = 'completed') trucks
     from project p join customer c on c.id = p.customer_id left join customer_journey j on j.project_id = p.id
     where ${f.sql}
       and coalesce(j.stage, '') not in ('handover', 'closed')
       and exists (select 1 from dispatch x where x.project_id = p.id and x.status = 'completed')
       and not exists (select 1 from dispatch x where x.project_id = p.id and x.status = 'open')
       and not exists (
         select 1 from component cm join order_item oi on oi.id = cm.order_item_id join sales_order o on o.id = oi.order_id
         where o.project_id = p.id and o.status <> 'cancelled' and cm.dispatch_group in ('carcass', 'shutters', 'countertop', 'backsplash')
           and cm.quantity > coalesce((select sum(di.quantity) from dispatch_item di join dispatch x on x.id = di.dispatch_id
                                       where di.component_id = cm.id and x.status <> 'cancelled' and x.replacement_for is null), 0))
     order by done_at`, f.params);
  // Marking the handover is the customer journey's "Handover" stage, which supervisors and above set on the project.
  const can = atLeast(actor, "supervisor");
  return rows.map((r) => ({
    key: r.id, href: `/projects/${r.id}?tab=customer`, customer: r.customer.replace(/^Demo Customer /, ""), project: r.project, code: r.business_id,
    what: `${r.trucks} dispatch${r.trucks === 1 ? "" : "es"} installed`, stage_label: "Final handover", days: ageDays(Number(r.done_at), now), overdue: false,
    hold_until: null, partial: false,
    action: can ? { label: "Mark handed over", href: `/projects/${r.id}?tab=customer` } : null, waiting: can ? null : "Waiting for the project manager",
  }));
}

/** The tile open by default: the first tile with something the viewer can act on, else the first non-empty tile. */
export function defaultTile(tiles: readonly PipelineTile[]): TileKey {
  return (tiles.find((t) => t.mine > 0) ?? tiles.find((t) => t.n > 0) ?? tiles[0]!).key;
}
