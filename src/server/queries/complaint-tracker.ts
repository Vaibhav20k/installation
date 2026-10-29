/**
 * The Complaints view: every complaint the actor may see, in the five plain phases of complaint-phases.ts.
 * Read-only. Scope is the same SQL filter as the other dispatch lists (flowFilter), so an Installation Manager
 * sees only their own projects; nothing here widens it. Cost is never selected, so no one sees it from here.
 */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { ageDays } from "@/domain/flow";
import { phaseTrack, type PhaseCode, type PhaseTrack } from "@/domain/complaint-phases";
import { allDefinitions, stageFor } from "./dispatch";
import { flowFilter } from "../services/flow-core";

/** Closed complaints stay on the view this long, so the IM sees the replacement land. */
export const RECENT_CLOSED_DAYS = 30;

export type ComplaintPriority = "normal" | "high" | "urgent";

export interface TrackedComplaint {
  id: string; business_id: string; kind: "missing" | "damaged"; quantity: string; unit: string; item: string;
  order: string; customer: string; project: string; dispatch_no: string;
  raised_at: number; raised_by_me: boolean; status: "open" | "closed"; outcome: string | null; closed_at: number | null;
  stage: string; stage_label: string; days_in_stage: number; overdue: boolean; track: PhaseTrack;
  /**
   * PRIORITY HOOK: complaint.priority ('normal' | 'high' | 'urgent', migration 018). Read only when the column
   * exists, so this works before and after that migration; null means "not set / column not there yet".
   */
  priority: ComplaintPriority | null;
}

async function hasPriorityColumn(q: Queryable) {
  const r = await q.query("select 1 from information_schema.columns where table_name = 'complaint' and column_name = 'priority'");
  return r.length > 0;
}

/** Open complaints first (overdue, then oldest raised), then complaints closed in the last 30 days (newest first). */
export async function complaintTracker(q: Queryable, actor: Actor, now: number): Promise<TrackedComplaint[]> {
  const defs = await allDefinitions(q);
  const f = await flowFilter(q, actor, "p", 1);
  const since = new Date(now - RECENT_CLOSED_DAYS * 86_400_000).toISOString();
  const priority = (await hasPriorityColumn(q)) ? "x.priority::text" : "null::text";
  const rows = await q.query<{ id: string; business_id: string; kind: "missing" | "damaged"; quantity: string; unit: string; item: string; order_no: string; customer: string; project: string;
    dispatch_no: string; created_at: number; created_by: string | null; status: "open" | "closed"; outcome: string | null; closed_at: number | null; stage: string; config_version: number;
    stage_entered_at: number; item_source: string | null; priority: string | null }>(
    `select x.id, x.business_id, x.kind, x.quantity::float::text quantity, cm.unit, cm.name item, o.business_id order_no, c.name customer, p.name project, d.business_id dispatch_no,
            x.created_at, x.created_by, x.status, x.outcome, x.closed_at, x.stage, x.config_version, x.stage_entered_at, x.item_source, ${priority} priority
     from complaint x join project p on p.id = x.project_id join customer c on c.id = p.customer_id join sales_order o on o.id = x.order_id
     join component cm on cm.id = x.component_id join dispatch d on d.id = x.dispatch_id
     where (x.status = 'open' or x.closed_at >= $${f.params.length + 1}) and ${f.sql}
     order by x.created_at limit 500`, [...f.params, since]);
  const out = rows.map((r): TrackedComplaint => {
    const s = stageFor(defs, "complaint", r.config_version, r.stage);
    const days = ageDays(Number(r.stage_entered_at), now);
    const open = r.status === "open";
    return {
      id: r.id, business_id: r.business_id, kind: r.kind, quantity: r.quantity, unit: r.unit ?? "", item: r.item, order: r.order_no, customer: r.customer.replace(/^Demo Customer /, ""),
      project: r.project, dispatch_no: r.dispatch_no, raised_at: Number(r.created_at), raised_by_me: r.created_by === actor.id, status: r.status, outcome: r.outcome,
      closed_at: r.closed_at ? Number(r.closed_at) : null, stage: r.stage, stage_label: s?.label ?? r.stage, days_in_stage: open ? days : 0,
      overdue: open && !!s?.slaDays && days > s.slaDays,
      track: phaseTrack({ stage: r.stage, status: r.status, itemSource: r.item_source, owner: s?.owner, terminal: s?.terminal, outcome: r.outcome }),
      priority: r.priority === "high" || r.priority === "urgent" || r.priority === "normal" ? r.priority : null,
    };
  });
  return out.sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.status === "closed") return (b.closed_at ?? 0) - (a.closed_at ?? 0);
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.raised_at - b.raised_at;
  });
}

/** Counts for the filter chips: open and closed, and open complaints per phase. */
export function trackerCounts(list: TrackedComplaint[]) {
  const open = list.filter((c) => c.status === "open");
  const byPhase: Record<PhaseCode, number> = { planning: 0, purchase: 0, qc: 0, production: 0, dispatched: 0 };
  for (const c of open) if (c.track.phase !== "done") byPhase[c.track.phase] += 1;
  return { open: open.length, closed: list.length - open.length, overdue: open.filter((c) => c.overdue).length, byPhase };
}
