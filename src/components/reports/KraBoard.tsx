/**
 * KRA review as a board of KPI cards instead of a nine-column table: each card leads with the actual,
 * shows a chart only where the record supports one, and keeps baseline, target, coverage, missing
 * evidence and formula as text. Ratings rules are unchanged — status comes straight from kraReview.
 */
import type { KraRow } from "@/server/queries/kra";
import type { KraTrend } from "@/server/queries/report-charts";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { Sparkline, StackBar } from "./charts/Charts";
import { kpiEvidence, misSplit, monthLabel, type Evidence } from "./charts/scale";

const ORDER: Record<Evidence, number> = { measured: 0, no_data: 1, elsewhere: 2 };
const EVIDENCE_LABEL: Record<Evidence, string> = { measured: "Measured this period", no_data: "No data this period", elsewhere: "Shown in a tracker" };

function KpiVisual({ row, trend }: { row: KraRow; trend: KraTrend }) {
  const labels = trend.months.map(monthLabel);
  if (row.code === "mis_completeness") {
    const s = misSplit(row.actual, row.coverage);
    if (!s) return null;
    return (
      <div className="kpi-visual">
        <StackBar title="Expected timesheets" caption={`${s.total} employee-days`} parts={[
          { label: "On time", value: s.onTime, tone: "ok" }, { label: "Late", value: s.late, tone: "warn" }, { label: "Missing", value: s.missing, tone: "signal" },
        ]} />
      </div>
    );
  }
  if (row.code === "complaint_reduction") {
    return <div className="kpi-visual"><Sparkline label={`Complaints reported, last ${labels.length} months`} values={trend.complaints} labels={labels} /><p className="kpi-trend-note">Complaints per month · {labels[0]}–{labels[labels.length - 1]}</p></div>;
  }
  if (row.code === "repeat_visits") {
    return (
      <div className="kpi-visual">
        <Sparkline label={`Unplanned repeat visits, last ${labels.length} months`} values={trend.unplannedRepeats} labels={labels} />
        <p className="kpi-trend-note">Unplanned returns per month · planned phased: {trend.plannedReturns.reduce((a, b) => a + b, 0)} in {labels.length} months</p>
      </div>
    );
  }
  return null;
}

function KpiCard({ row, trend }: { row: KraRow; trend: KraTrend }) {
  const evidence = kpiEvidence(row.actual);
  const id = `kpi-${row.code}`;
  return (
    <article className="kpi-card" aria-labelledby={id} data-evidence={evidence}>
      <header className="kpi-head">
        <div>
          <h3 id={id}>{row.name}</h3>
          <p className="kpi-meta">{row.unit} · {row.direction.replace("_", " ")} · v{row.definitionVersion} {row.definitionStatus}</p>
        </div>
        <Badge state={row.status} />
      </header>
      <div className="kpi-actual">
        <span className="kpi-label">Actual</span>
        <strong className="kpi-value num" data-evidence={evidence}>{row.actual}</strong>
        {row.actualDetail && <span className="kpi-detail">{row.actualDetail}</span>}
      </div>
      <KpiVisual row={row} trend={trend} />
      <dl className="kpi-facts">
        <div><dt>Baseline (reference)</dt><dd>{row.baselineText ?? "—"}</dd></div>
        <div><dt>Target (reference)</dt><dd>{row.targetText ?? "—"} <Badge state={row.targetStatus === "approved" ? "approved" : "illustrative"} label={row.targetStatus} /></dd></div>
        <div><dt>Coverage</dt><dd>{row.coverage || "—"}</dd></div>
        <div><dt>Variance</dt><dd className="num">{row.variance}</dd></div>
        <div><dt>Owner</dt><dd>{row.owner ?? "—"}</dd></div>
      </dl>
      <div className="kpi-more">
        {row.missingEvidence.length > 0 && (
          <details>
            <summary>Missing evidence ({row.missingEvidence.length})</summary>
            <ul>{row.missingEvidence.map((m) => <li key={m}>{m}</li>)}</ul>
          </details>
        )}
        <details><summary>Formula</summary><p>{row.formula}</p></details>
      </div>
    </article>
  );
}

export function KraBoard({ rows, period, trend }: { rows: KraRow[]; period: { from: string; to: string }; trend: KraTrend }) {
  const counts = { measured: 0, no_data: 0, elsewhere: 0 } as Record<Evidence, number>;
  for (const r of rows) counts[kpiEvidence(r.actual)]++;
  const approvedTargets = rows.filter((r) => r.targetStatus === "approved").length;
  const approvedDefs = rows.filter((r) => r.definitionStatus === "approved").length;
  const rated = rows.filter((r) => r.status !== "Not rated").length;
  const sorted = [...rows].sort((a, b) => ORDER[kpiEvidence(a.actual)] - ORDER[kpiEvidence(b.actual)]);
  return (
    <section className="card kra" aria-labelledby="h-kra">
      <div className="kra-top">
        <div className="stack">
          <h2 id="h-kra">KRA review</h2>
          <p className="small muted">{period.from} to {period.to} · {rows.length} KPIs</p>
          <Notice tone="warn">No KPI is rated until its definition, population, review period and target are approved. Zero denominators show N/A, never 0% or a green status. No weighted scores or rankings are produced.</Notice>
        </div>
        <div className="kra-summary">
          <dl className="kra-figures">
            <div><dt>Rated</dt><dd className="num">{rated}<span> / {rows.length}</span></dd></div>
            <div><dt>Approved targets</dt><dd className="num">{approvedTargets}<span> / {rows.length}</span></dd></div>
            <div><dt>Approved definitions</dt><dd className="num">{approvedDefs}<span> / {rows.length}</span></dd></div>
          </dl>
          <StackBar title="Evidence this period" caption="KPIs by whether an actual could be computed" parts={[
            { label: EVIDENCE_LABEL.measured, value: counts.measured, tone: "ink" },
            { label: EVIDENCE_LABEL.no_data, value: counts.no_data, tone: "faint" },
            { label: EVIDENCE_LABEL.elsewhere, value: counts.elsewhere, tone: "muted" },
          ]} />
        </div>
      </div>
      <div className="kpi-grid">{sorted.map((r) => <KpiCard key={r.code} row={r} trend={trend} />)}</div>
      <p className="small muted">Suggested cadence from the workbook: daily schedule/readiness/exceptions, weekly productivity/delay/quality/cost/issues, monthly Finance reconciliation and trend. Two elapsed weeks alone do not establish a baseline; sample size and cohort are shown before approval. Trends count records by month and are not ratings.</p>
    </section>
  );
}
