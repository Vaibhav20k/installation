/**
 * Chart strip above each tracker table. Every figure is derived from the same rows the table shows,
 * so nothing new becomes visible; the table below stays the exact record.
 */
import type { TrackerView } from "@/server/queries/trackers";
import { formatMoney } from "@/lib/format";
import { ColumnChart, Donut, HBarChart, Meter, type Tone } from "./charts/Charts";
import { countBy, fmt, labelOf, sumBy, toNumber, type Datum } from "./charts/scale";

type Row = TrackerView["rows"][number];
const money = (minor: number) => formatMoney(minor);
const hrs = (n: number) => `${fmt(n)} h`;

const STATUS_TONE: Record<string, Tone> = {
  closed: "ok", completed: "ok", accepted: "ok", installed: "ok", "In progress": "ink", in_progress: "ink", open: "warn", reopened: "warn",
  on_hold: "warn", dispatched: "muted", partly_dispatched: "faint", cancelled: "faint", Overdue: "signal",
};
const FALLBACK: Tone[] = ["ink", "muted", "warn", "ok", "faint", "signal"];
function statusTones(data: Datum[]): Tone[] {
  return data.map((d, i) => STATUS_TONE[d.label] ?? FALLBACK[i % FALLBACK.length]!);
}
const relabel = (data: Datum[]) => data.map((d) => ({ ...d, label: labelOf(d.label) }));

function Installation({ rows }: { rows: Row[] }) {
  const raw = countBy(rows, "status");
  const tones = statusTones(raw);
  const timed = rows.filter((r) => typeof r.daysPlanned === "number" || typeof r.daysActual === "number").slice(0, 12);
  return (
    <>
      <Donut title="Orders by status" caption="All orders in scope" data={relabel(raw)} tones={tones} centerLabel="orders" />
      {timed.length > 0 && (
        <ColumnChart title="Days planned vs actual" caption="Inclusive calendar days; in-progress orders show elapsed days so far" unit=" days"
          categories={timed.map((r) => String(r.orderId))}
          series={[{ name: "Planned", tone: "faint", values: timed.map((r) => toNumber(r.daysPlanned)) }, { name: "Actual / elapsed", tone: "ink", values: timed.map((r) => toNumber(r.daysActual)) }]} />
      )}
    </>
  );
}

function Manpower({ rows }: { rows: Row[] }) {
  const dates = [...new Set(rows.map((r) => String(r.date)))].sort();
  const sum = (d: string, k: string) => rows.filter((r) => String(r.date) === d).reduce((a, r) => a + toNumber(r[k]), 0);
  const byTeam = sumBy(rows, "supervisor", "actualHours");
  const idle = sumBy(rows.filter((r) => toNumber(r.idleHours) > 0), "idleReason", "idleHours");
  return (
    <>
      {dates.length > 0 && (
        <ColumnChart title="Person-hours by day" caption={`Planned vs accepted actual, all visits that day · day of month, ${dates[0]!.slice(0, 7)}`} unit=" h"
          categories={dates.map((d) => String(Number(d.slice(8))))}
          series={[{ name: "Planned", tone: "faint", values: dates.map((d) => sum(d, "plannedHours")) }, { name: "Accepted actual", tone: "ink", values: dates.map((d) => sum(d, "actualHours")) }]} />
      )}
      <HBarChart title="Accepted hours by team" caption="Workload per supervisor this month" data={byTeam} format={hrs} />
      {idle.length > 0 && <HBarChart title="Waiting / idle hours by reason" data={relabel(idle)} format={hrs} tone="warn" />}
    </>
  );
}

function Ftr({ rows }: { rows: Row[] }) {
  const n = rows.length;
  const yes = (k: string) => rows.filter((r) => r[k] === "Y").length;
  const outcomes: Datum[] = [
    { label: "Completed on first visit", value: yes("completedFirstVisit") },
    { label: "Unplanned return", value: rows.filter((r) => toNumber(r.unplannedReturns) > 0).length },
    { label: "Rework required", value: yes("reworkRequired") },
    { label: "Complaint", value: yes("complaint") },
  ];
  const causes = countBy(rows.flatMap((r) => String(r.returnCauses ?? "").split(",").map((c) => c.trim()).filter(Boolean).map((c) => ({ c }))), "c");
  return (
    <>
      <HBarChart title="Order outcomes" caption={`Orders out of ${n}; one order can appear in several rows`} data={outcomes} max={n}
        toneOf={(d) => (d.label === "Completed on first visit" ? "ok" : d.label === "Complaint" ? "signal" : "warn")} />
      {causes.length > 0 && <HBarChart title="Unplanned return causes" data={relabel(causes)} tone="warn" />}
    </>
  );
}

function Issues({ rows }: { rows: Row[] }) {
  const status = rows.map((r) => ({ s: r.overdue === "Overdue" ? "Overdue" : String(r.status ?? "") }));
  const raw = countBy(status, "s");
  return (
    <>
      <Donut title="Issues by status" caption="Overdue open issues counted separately" data={relabel(raw)} tones={statusTones(raw)} centerLabel="issues" />
      <HBarChart title="Issues by function" data={countBy(rows, "function")} />
      {rows.some((r) => toNumber(r.delayDays) > 0) && <HBarChart title="Delay days by function" caption="Overlapping causes are not additive" data={sumBy(rows, "function", "delayDays")} tone="warn" format={(v) => `${fmt(v)} d`} />}
    </>
  );
}

function Cost({ rows, projects }: { rows: Row[]; projects: Row[] }) {
  const approved = rows.filter((r) => r.approvalAvailable === "Y");
  const pending = rows.filter((r) => r.approvalAvailable === "N").reduce((a, r) => a + toNumber(r.actualMinor), 0);
  const byCat = relabel(sumBy(approved, "category", "actualMinor"));
  const budgeted = projects.filter((p) => toNumber(p.approvedBudgetMinor) > 0);
  return (
    <>
      <HBarChart title="Approved cost by category" caption={pending ? `Pending approval not included: ${money(pending)}` : "Approved expenses this month"} data={byCat} format={money} emptyText="No approved expenses this month." />
      {projects.length > 0 && (
        <figure className="chart">
          <figcaption className="chart-cap"><span className="chart-title">Approved actual vs budget</span><span className="chart-sub">Per project, all approved expenses to date</span></figcaption>
          <div className="stack">
            {budgeted.map((p) => {
              const b = toNumber(p.approvedBudgetMinor), a = toNumber(p.approvedActualMinor);
              return <Meter key={String(p.projectId)} label={`${p.projectId} · ${p.location}`} value={a} max={Math.max(a, b)} reference={b} referenceLabel="Budget" tone={a > b ? "signal" : "ink"} format={money} />;
            })}
            {projects.length > budgeted.length && <p className="chart-empty">No approved budget: {projects.filter((p) => !budgeted.includes(p)).map((p) => p.projectId).join(", ")}</p>}
          </div>
        </figure>
      )}
    </>
  );
}

export function TrackerCharts({ view, projects = [] }: { view: TrackerView; projects?: Row[] }) {
  if (view.rows.length === 0 && projects.length === 0) return null;
  const body = view.id === "installation" ? <Installation rows={view.rows} />
    : view.id === "manpower" ? <Manpower rows={view.rows} />
    : view.id === "ftr" ? <Ftr rows={view.rows} />
    : view.id === "issues" ? <Issues rows={view.rows} />
    : view.id === "cost" ? <Cost rows={view.rows} projects={projects} />
    : null;
  if (!body) return null;
  return <section className="report-charts" aria-label={`${view.title} charts`}>{body}</section>;
}
