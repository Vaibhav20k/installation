/**
 * KRA review: workbook reference baselines/targets kept provisional; actuals computed from records.
 * No approved target or invalid baseline -> Not rated. Zero denominators -> N/A with a reason.
 */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { addDays, dayDiff, localDateOf, monthBounds, startOfLocalDay, weekday } from "@/lib/dates";
import { complaintReduction, ftr, misCompleteness, targetVariance, type FtrUnit } from "@/domain/kpi";
import { employeeFilter, projectFilter } from "./common";

const TZ = "Asia/Kolkata";

export interface KraRow {
  code: string; name: string; unit: string; direction: string; definitionVersion: number; definitionStatus: string; formula: string;
  baselineText: string | null; targetText: string | null; targetStatus: string; actual: string; actualDetail: string; coverage: string;
  variance: string; status: string; missingEvidence: string[]; owner: string | null;
}

async function misObligations(q: Queryable, actor: Actor, from: string, to: string, asOf: number) {
  const ef = await employeeFilter(q, actor, "r.employee_id", 3);
  const rows = await q.query<{ employee_id: string; s: number; e: number }>(
    `select r.employee_id, lower(r.span) s, upper(r.span) e from reservation r join visit v on v.id = r.visit_id
     where r.state in ('confirmed','released') and v.exec_status <> 'cancelled' and lower(r.span) < ($2::date + 1)::timestamp at time zone 'Asia/Kolkata' and upper(r.span) > ($1::date)::timestamp at time zone 'Asia/Kolkata' and ${ef.sql}`,
    [from, to, ...ef.params]);
  const obligations: Array<{ complete: boolean; firstSubmittedAt: number | null; dueAt: number }> = [];
  const seen = new Set<string>();
  const asOfDate = localDateOf(asOf, TZ);
  for (const r of rows) {
    for (let d = localDateOf(r.s, TZ); d <= localDateOf(r.e - 1, TZ); d = addDays(d, 1)) {
      // Obligation grain: employee-day timesheet for an assigned working day; due by end of the next day.
      const key = `${r.employee_id}:${d}`;
      if (seen.has(key) || d < from || d > to || weekday(d) === 0 || dayDiff(d, asOfDate) < 2) continue;
      seen.add(key);
      const [e] = await q.query<{ accepted: boolean; first: number | null }>(
        `select bool_or(state = 'accepted') accepted, min(first_submitted_at) "first" from time_entry where employee_id = $1 and is_current and state <> 'voided'
         and lower(span) >= ($2::date)::timestamp at time zone 'Asia/Kolkata' and lower(span) < ($2::date + 1)::timestamp at time zone 'Asia/Kolkata'`, [r.employee_id, d]);
      const dueAt = startOfLocalDay(addDays(d, 2), TZ);
      obligations.push({ complete: !!e?.accepted, firstSubmittedAt: e?.first ?? null, dueAt });
    }
  }
  return obligations;
}

export async function kraReview(q: Queryable, actor: Actor, opts: { month: string }, now: number): Promise<{ rows: KraRow[]; period: { from: string; to: string } }> {
  const { first, last } = monthBounds(opts.month);
  const defs = await q.query<{ code: string; version: number; name: string; formula: string; unit: string; direction: string; status: string; grain: string | null; window_text: string | null; cohort: string | null }>(
    "select distinct on (code) code, version, name, formula, unit, direction, status, grain, window_text, cohort from kpi_definition order by code, version desc");
  const targets = await q.query<{ kpi_code: string; baseline_text: string | null; target_text: string | null; target_value: string | null; baseline_value: string | null; status: string; owner_text: string | null }>(
    "select kpi_code, baseline_text, target_text, target_value::text, baseline_value::text, status, owner_text from kpi_target");
  const pf = projectFilter(actor, "p", 1);

  const kitchens = await q.query<{ item: string; start: number | null; accepted_on: string | null; signed: boolean | null; rework: boolean; unplanned: boolean; planned: boolean; completed: boolean }>(
    `select oi.business_id item,
       (select min(lower(t.span)) from time_entry t join visit_order vo on vo.visit_id = t.visit_id where vo.order_id = o.id and t.is_current and t.state = 'accepted') start,
       (select max(a.accepted_on)::text from acceptance a where a.order_item_id = oi.id and a.signed_off) accepted_on,
       (select bool_or(a.signed_off) from acceptance a where a.order_item_id = oi.id) signed,
       exists (select 1 from quality_case qc where qc.order_id = o.id and qc.kind = 'rework') rework,
       exists (select 1 from visit v join visit_order vo on vo.visit_id = v.id where vo.order_id = o.id and v.visit_type <> 'fresh' and v.repeat_reason <> 'planned_phasing') unplanned,
       exists (select 1 from visit v join visit_order vo on vo.visit_id = v.id where vo.order_id = o.id and v.repeat_reason = 'planned_phasing') planned,
       not exists (select 1 from installation_task t join component c on c.id = t.component_id where c.order_item_id = oi.id
         and t.required_quantity > coalesce((select sum(pe.quantity_delta) from progress_event pe join visit_task vt on vt.id = pe.visit_task_id where vt.task_id = t.id and vt.kind = 'original' and pe.accepted), 0)) completed
     from order_item oi join sales_order o on o.id = oi.order_id join project p on p.id = o.project_id where oi.product_type = 'kitchen' and ${pf.sql}`, pf.params);

  const rows: KraRow[] = [];
  for (const d of defs) {
    const t = targets.find((x) => x.kpi_code === d.code);
    const target = t && t.status === "approved" && t.target_value !== null ? { value: Number(t.target_value), approved: true } : null;
    let actual: number | null = null, actualText = "N/A", detail = "", coverage = "", missing: string[] = [];
    switch (d.code) {
      case "installation_days": {
        const done = kitchens.filter((k) => k.completed && k.accepted_on && k.start && k.accepted_on >= first && k.accepted_on <= last);
        const days = done.map((k) => dayDiff(localDateOf(k.start!, TZ), k.accepted_on!) + 1);
        coverage = `${done.length} completed kitchen(s) with sign-off in period`;
        if (days.length) { actual = days.reduce((a, b) => a + b, 0) / days.length; actualText = `${actual.toFixed(1)} days (mean, n=${days.length})`; detail = days.join(", "); }
        else missing.push("No kitchens completed with sign-off in this period");
        break;
      }
      case "ftr_rate": {
        const units: FtrUnit[] = kitchens.map((k) => ({ unitId: k.item, completed: k.completed, accepted: k.signed, installationRework: k.rework, unplannedReturn: k.unplanned, plannedPhased: k.planned }));
        const def = d.status === "approved" ? { approved: true, plannedPhaseTreatment: "exclude" as const, grain: d.grain, window: d.window_text } : null;
        const r = ftr(units, def);
        coverage = `${r.evidence.completed} completed, ${r.evidence.acceptanceUnknown} with unknown sign-off, ${r.evidence.plannedPhased} planned phased`;
        detail = `Literal first-visit completions: ${r.evidence.literalFirstVisitCompletions}`;
        if (r.rated && r.ratio.value !== null) { actual = r.ratio.value; actualText = `${actual}% (${r.ratio.numerator}/${r.ratio.denominator})`; }
        else { actualText = r.rated ? "N/A" : "Not rated"; missing.push(r.rated ? r.ratio.reason ?? "" : r.reason); }
        break;
      }
      case "complaint_reduction": {
        const [c] = await q.query<{ n: number }>(`select count(*)::int n from quality_case qc join project p on p.id = qc.project_id where qc.kind = 'complaint' and qc.reported_on between $${pf.params.length + 1} and $${pf.params.length + 2} and ${pf.sql}`, [...pf.params, first, last]);
        const r = complaintReduction(t?.baseline_value ? { value: Number(t.baseline_value), approved: t.status === "approved", cohort: "all" } : null, { value: c!.n, cohort: "all" });
        coverage = `${c!.n} complaint(s) reported in period (distinct count)`;
        if (r.value !== null) { actual = r.value; actualText = `${r.value}%`; } else missing.push(r.reason!);
        break;
      }
      case "unloading_savings": {
        const [s] = await q.query<{ v: number | null; n: number }>("select sum(baseline_minor - actual_minor)::bigint v, count(*)::int n from savings_claim where finance_verified");
        coverage = `${s!.n} Finance-verified claim(s)`;
        if (s!.n > 0) { actual = Number(s!.v) / 100; actualText = `₹${actual.toLocaleString("en-IN")}`; } else missing.push("No Finance-verified comparable baseline and actual");
        break;
      }
      case "team_productivity": {
        missing.push("Per-activity productivity is shown in the Manpower Productivity tracker; quantity kinds are not combined into one score");
        actualText = "See tracker";
        break;
      }
      case "overtime_cost": {
        const [o] = await q.query<{ m: number }>("select coalesce(sum(minutes),0)::int m from reconciliation_allocation where active");
        actualText = "N/A"; detail = `${(o!.m / 60).toFixed(1)} approved overtime hours (finalized months)`; missing.push("No Finance-verified overtime cost records or approved payroll calculation");
        break;
      }
      case "repeat_visits": {
        const [r] = await q.query<{ unplanned: number; planned: number }>(
          `select count(*) filter (where v.repeat_reason <> 'planned_phasing')::int unplanned, count(*) filter (where v.repeat_reason = 'planned_phasing')::int planned
           from visit v join project p on p.id = v.project_id where v.visit_type <> 'fresh' and v.exec_status <> 'cancelled' and v.planned_start between $${pf.params.length + 1} and $${pf.params.length + 2} and ${pf.sql}`, [...pf.params, first, last]);
        actual = r!.unplanned; actualText = `${r!.unplanned} unplanned`; detail = `${r!.planned} planned phased return(s) shown separately`; coverage = "Visits with planned start in period";
        break;
      }
      case "mis_completeness": {
        const obs = await misObligations(q, actor, first, last, now);
        const m = misCompleteness(obs);
        coverage = `${obs.length} expected employee-day timesheets (due end of next day)`;
        if (m.completeness.value !== null) { actual = m.completeness.value; actualText = `${m.completeness.value}% complete, ${m.timeliness.value}% on time`; detail = `${m.missing} missing`; }
        else missing.push(m.completeness.reason!);
        break;
      }
    }
    const tv = targetVariance(d.unit === "percent" ? "percent" : d.unit === "count" ? "count" : "amount", actual, target, d.direction as "higher_better" | "lower_better");
    if (!target) missing.push(t ? `Target is ${t.status}: "${t.target_text}"` : "No target recorded");
    if (d.status !== "approved") missing.push(`Metric definition v${d.version} is a ${d.status} text, not an approved definition`);
    rows.push({
      code: d.code, name: d.name, unit: d.unit, direction: d.direction, definitionVersion: d.version, definitionStatus: d.status, formula: d.formula,
      baselineText: t?.baseline_text ?? null, targetText: t?.target_text ?? null, targetStatus: t?.status ?? "none",
      actual: actualText, actualDetail: detail, coverage, variance: tv.rated && "variance" in tv ? `${tv.variance} ${tv.unit}` : "—", status: tv.status,
      missingEvidence: [...new Set(missing.filter(Boolean))], owner: t?.owner_text ?? null,
    });
  }
  return { rows, period: { from: first, to: last } };
}
