/**
 * Read-only aggregates for the report charts. Same project scoping and record rules as kra.ts:
 * complaints by reported date; non-fresh, non-cancelled visits by planned start, planned phasing split out.
 */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { monthBounds } from "@/lib/dates";
import { lastMonths } from "@/components/reports/charts/scale";
import { projectFilter } from "./common";

export interface KraTrend { months: string[]; complaints: number[]; unplannedRepeats: number[]; plannedReturns: number[] }

/** Monthly counts for the `n` months ending with `month` (oldest first), zero-filled. */
export async function kraTrend(q: Queryable, actor: Actor, month: string, n = 6): Promise<KraTrend> {
  const months = lastMonths(month, n);
  const from = monthBounds(months[0]!).first;
  const to = monthBounds(month).last;
  const pf = projectFilter(actor, "p", 1);
  const a = pf.params.length + 1, b = pf.params.length + 2;
  const complaints = await q.query<{ m: string; n: number }>(
    `select to_char(qc.reported_on, 'YYYY-MM') m, count(*)::int n from quality_case qc join project p on p.id = qc.project_id
     where qc.kind = 'complaint' and qc.reported_on between $${a}::date and $${b}::date and ${pf.sql} group by 1`, [...pf.params, from, to]);
  const visits = await q.query<{ m: string; unplanned: number; planned: number }>(
    `select to_char(v.planned_start, 'YYYY-MM') m, count(*) filter (where v.repeat_reason <> 'planned_phasing')::int unplanned,
       count(*) filter (where v.repeat_reason = 'planned_phasing')::int planned
     from visit v join project p on p.id = v.project_id
     where v.visit_type <> 'fresh' and v.exec_status <> 'cancelled' and v.planned_start between $${a}::date and $${b}::date and ${pf.sql} group by 1`, [...pf.params, from, to]);
  const pick = <T extends { m: string }>(rows: T[], f: (r: T) => number) => months.map((m) => { const r = rows.find((x) => x.m === m); return r ? f(r) : 0; });
  return {
    months,
    complaints: pick(complaints, (r) => r.n),
    unplannedRepeats: pick(visits, (r) => r.unplanned),
    plannedReturns: pick(visits, (r) => r.planned),
  };
}
