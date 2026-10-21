import { session } from "@/server/session";
import { listProjects } from "@/server/queries/projects";
import { installationTracker, issuesTracker, manpowerTracker, type TrackerView } from "@/server/queries/trackers";
import { costTracker, ftrTracker } from "@/server/queries/trackers-quality-cost";
import { kraReview } from "@/server/queries/kra";
import { localDateOf, monthOf } from "@/lib/dates";
import { formatMoney, TZ } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, Notice, PageHeader, Tabs } from "@/components/ui/Notice";
import { SavingsForms } from "@/components/reports/SavingsForms";

export const metadata = { title: "Reports" };

const VIEWS = [
  { id: "kra", label: "KRA review" }, { id: "installation", label: "Installation tracker" }, { id: "manpower", label: "Manpower productivity" },
  { id: "ftr", label: "FTR, complaints & rework" }, { id: "cost", label: "Cost, overtime & unloading" }, { id: "issues", label: "Cross-functional issues" },
];

function TrackerTable({ view }: { view: TrackerView }) {
  const money = (k: string) => /Minor$/.test(k);
  return (
    <div className="stack">
      {view.rows.length === 0 ? <Empty>No records for this view and filter.</Empty> : (
        <div className="table-wrap" role="region" aria-label={view.title} tabIndex={0}><table>
          <thead><tr>{view.columns.map((c, i) => <th key={c.key} className={i === 0 ? "pin" : undefined} scope="col" title={`Workbook: ${c.source}`}>{c.label}{c.source === "derived" && <span className="muted"> *</span>}</th>)}</tr></thead>
          <tbody>{view.rows.map((r, i) => (
            <tr key={i}>{view.columns.map((c, j) => {
              const v = r[c.key];
              const text = v === null || v === undefined || v === "" ? "—" : money(c.key) && typeof v === "number" ? formatMoney(v) : String(v);
              return j === 0 ? <th key={c.key} scope="row" className="pin" style={{ fontWeight: 400 }}>{text}</th> : <td key={c.key} className={typeof v === "number" ? "num" : undefined}>{text}</td>;
            })}</tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="small muted">Source: {view.sourceRange}. Hover a header for its workbook column; * marks derived columns. {view.notes.join(" ")}</p>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const now = Date.now();
  const view = VIEWS.find((v) => v.id === sp.view)?.id ?? "kra";
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : monthOf(localDateOf(now, TZ));
  const projectId = sp.project || undefined;
  const projects = await listProjects(db, actor);
  const qs = (id: string) => `/reports?view=${id}&month=${month}${projectId ? `&project=${projectId}` : ""}`;
  const exportHref = `/api/export/${view}?month=${month}${projectId ? `&project=${projectId}` : ""}`;
  return (
    <>
      <PageHeader title="Reports" subtitle="All views reuse the same operational records; nothing is entered twice. Workbook baselines and targets remain provisional reference text until approved." actions={<a className="button" href={exportHref}>Export CSV</a>} />
      <Tabs current={view} items={VIEWS.map((v) => ({ ...v, href: qs(v.id) }))} />
      <form className="row card no-print" role="search" aria-label="Report filters">
        <input type="hidden" name="view" value={view} />
        <div className="field"><label htmlFor="r-m">Month</label><input id="r-m" type="month" name="month" defaultValue={month} /></div>
        {view !== "kra" && <div className="field"><label htmlFor="r-p">Project</label><select id="r-p" name="project" defaultValue={projectId ?? ""}><option value="">All in scope</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.business_id}</option>)}</select></div>}
        <button type="submit" style={{ alignSelf: "flex-end" }}>Apply</button>
      </form>
      {view === "kra" && await (async () => {
        const k = await kraReview(db, actor, { month }, now);
        return (
          <section className="card stack" aria-labelledby="h-kra">
            <h2 id="h-kra">KRA review · {k.period.from} to {k.period.to}</h2>
            <Notice tone="warn">No KPI is rated until its definition, population, review period and target are approved. Zero denominators show N/A, never 0% or a green status. No weighted scores or rankings are produced.</Notice>
            <div className="table-wrap"><table>
              <thead><tr><th className="pin">KPI</th><th>Baseline (reference)</th><th>Target (reference)</th><th>Actual</th><th>Coverage</th><th>Variance</th><th>Status</th><th>Missing evidence</th><th>Owner</th></tr></thead>
              <tbody>{k.rows.map((r) => (
                <tr key={r.code}>
                  <th scope="row" className="pin" style={{ fontWeight: 400 }}><strong>{r.name}</strong><div className="small muted">{r.unit} · {r.direction.replace("_", " ")} · definition v{r.definitionVersion} ({r.definitionStatus})</div><details className="small"><summary>Formula</summary>{r.formula}</details></th>
                  <td className="small">{r.baselineText ?? "—"}</td><td className="small">{r.targetText ?? "—"} <Badge state={r.targetStatus === "approved" ? "approved" : "illustrative"} label={r.targetStatus} /></td>
                  <td>{r.actual}{r.actualDetail && <div className="small muted">{r.actualDetail}</div>}</td><td className="small">{r.coverage || "—"}</td><td>{r.variance}</td>
                  <td><Badge state={r.status} /></td><td className="small">{r.missingEvidence.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{r.missingEvidence.map((m) => <li key={m}>{m}</li>)}</ul> : "—"}</td><td className="small">{r.owner ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <p className="small muted">Suggested cadence from the workbook: daily schedule/readiness/exceptions, weekly productivity/delay/quality/cost/issues, monthly Finance reconciliation and trend. Two elapsed weeks alone do not establish a baseline; sample size and cohort are shown before approval.</p>
          </section>
        );
      })()}
      {view === "installation" && <TrackerTable view={await installationTracker(db, actor, { projectId }, now)} />}
      {view === "manpower" && <TrackerTable view={await manpowerTracker(db, actor, { month, projectId })} />}
      {view === "ftr" && <TrackerTable view={await ftrTracker(db, actor, { projectId })} />}
      {view === "issues" && <TrackerTable view={await issuesTracker(db, actor, { projectId })} />}
      {view === "cost" && await (async () => {
        const c = await costTracker(db, actor, { month, projectId });
        const claims = await db.query<{ id: string; scope: string; period: string; load_ref: string | null; proposed_saving_minor: number | null; baseline_minor: number | null; actual_minor: number | null; finance_verified: boolean; evidence: string | null }>(
          "select id, scope, period, load_ref, proposed_saving_minor, baseline_minor, actual_minor, finance_verified, evidence from savings_claim order by period desc");
        return (
          <div className="stack">
            <TrackerTable view={c} />
            <section className="card stack" aria-labelledby="h-proj">
              <h2 id="h-proj">Per project</h2>
              <div className="table-wrap"><table>
                <thead><tr><th>Project</th><th>Location</th><th className="num">Approved budget</th><th className="num">Approved actual</th><th className="num">Approved OT hours</th><th>Overtime cost</th><th className="num">Verified savings</th><th className="num">Proposed (unverified)</th></tr></thead>
                <tbody>{c.projects.map((p) => (
                  <tr key={String(p.projectId)}><td>{p.projectId}</td><td>{p.location}</td><td className="num">{formatMoney(p.approvedBudgetMinor as number | null)}</td><td className="num">{formatMoney(p.approvedActualMinor as number)}</td>
                    <td className="num">{(Number(p.approvedOtMinutes) / 60).toFixed(1)}</td><td className="small">{p.overtimeCost}</td><td className="num">{formatMoney(p.verifiedSavingsMinor as number)}</td><td className="num">{formatMoney(p.proposedSavingsMinor as number)}</td></tr>
                ))}</tbody>
              </table></div>
            </section>
            <SavingsForms claims={claims} canVerify={actor.capabilities.includes("finance_verify")} canPropose={actor.role === "manager" || actor.role === "admin"} projects={projects.map((p) => ({ id: p.id, label: p.business_id }))} />
          </div>
        );
      })()}
    </>
  );
}

