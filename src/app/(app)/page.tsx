import Link from "next/link";
import { ArrowRight, CaretRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { dashboard } from "@/server/queries/dashboard";
import { listProjects } from "@/server/queries/projects";
import { localDateOf, monthOf } from "@/lib/dates";
import { formatMoney, TZ } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";

export const metadata = { title: "Overview" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const now = Date.now();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : monthOf(localDateOf(now, TZ));
  const projectId = sp.project || undefined;
  const [d, projects] = await Promise.all([dashboard(db, actor, { month, projectId }, now), listProjects(db, actor)]);
  const q = d.queues;
  const waiting = q.plans.length + q.time.length + q.overtime.length + q.expenses.length;
  const callouts = [
    actor.role !== "employee" && waiting > 0 && { href: "/approvals", title: `${waiting} waiting for your decision`, meta: [q.plans.length && `${q.plans.length} plan`, q.time.length && `${q.time.length} time`, q.overtime.length && `${q.overtime.length} overtime`, q.expenses.length && `${q.expenses.length} expense`].filter(Boolean).join(", ") },
    d.conflicts.length > 0 && { href: "/planning?view=sheet&conflicts=1", title: `${d.conflicts.length} staffing conflict${d.conflicts.length > 1 ? "s" : ""}`, meta: d.conflicts[0]!.conflicts[0] },
    d.readiness.length > 0 && { href: `/visits/${d.readiness[0]!.visitId}?step=clearance`, title: `${d.readiness.length} visit${d.readiness.length > 1 ? "s" : ""} blocked on clearance`, meta: `${d.readiness[0]!.visit} starts ${d.readiness[0]!.plannedStart}` },
  ].filter(Boolean) as Array<{ href: string; title: string; meta: string }>;
  const next = d.upcoming[0];
  const specs = d.metrics.filter((m) => !["approvals", "conflicts", "readiness"].includes(m.id));

  return (
    <>
      <div className="spread">
        <div>
          <h1>Overview</h1>
          <p className="muted small" style={{ margin: 0 }}>{d.today}, Asia/Kolkata</p>
        </div>
        <details className="no-print">
          <summary className="button" style={{ listStyle: "none" }}>Filter</summary>
          <form className="plate form" style={{ position: "absolute", right: 16, zIndex: 5, width: "min(340px, calc(100vw - 32px))", marginTop: 8 }} role="search" aria-label="Overview filters">
            <div className="field"><label htmlFor="f-month">Month</label><input id="f-month" type="month" name="month" defaultValue={month} /></div>
            <div className="field"><label htmlFor="f-project">Project</label>
              <select id="f-project" name="project" defaultValue={projectId ?? ""}>
                <option value="">All projects in my scope</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.business_id} · {p.name}</option>)}
              </select></div>
            <button type="submit" className="primary">Apply</button>
          </form>
        </details>
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <section className="plate" aria-labelledby="h-needs">
          <div className="plate-head"><h2 id="h-needs" style={{ margin: 0 }}>Needs you</h2><span className="code-tag">{callouts.length} open</span></div>
          {callouts.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing is waiting on you. Decisions, conflicts and clearance blockers appear here first.</p> : (
            <ol className="callouts">
              {callouts.map((c, i) => (
                <li key={c.href}><Link href={c.href}>
                  <span className="callout-n">{i + 1}</span>
                  <span><span className="callout-title">{c.title}</span><span className="callout-meta">{c.meta}</span></span>
                  <CaretRight size={18} className="callout-go" aria-hidden />
                </Link></li>
              ))}
            </ol>
          )}
        </section>

        {next ? (
          <section className="plate" aria-labelledby="h-next">
            <div className="plate-head">
              <span className="code-tag">{next.visit} · {next.projectBid}</span>
              <Badge state={next.approval} className="stamp-hero stamp-press" />
            </div>
            <h2 id="h-next" className="plate-title">{next.site}, {next.visitType.replace("_", "-")} visit</h2>
            <p className="plate-sub">{next.plannedStart} to {next.plannedEnd} · team {next.staffed}/{next.teamSize}</p>
            <ol className="callouts" style={{ marginTop: 8 }}>
              <li><Link href={`/visits/${next.visitId}`}>
                <span className="callout-n quiet"><ArrowRight size={14} weight="bold" aria-hidden /></span>
                <span><span className="callout-title">{next.nextAction}</span><span className="callout-meta">{next.owner ? `Owner ${next.owner}` : "No owner yet"}</span></span>
                <CaretRight size={18} className="callout-go" aria-hidden />
              </Link></li>
            </ol>
          </section>
        ) : (
          <section className="plate"><h2>Next visit</h2><p className="muted" style={{ margin: 0 }}>No visit starts in the next 14 days. <Link href="/planning/new">Plan one</Link>.</p></section>
        )}
      </div>

      <section className="plate" aria-labelledby="h-spec">
        <div className="plate-head"><h2 id="h-spec" style={{ margin: 0 }}>Figures for {month}</h2><span className="code-tag">tap a row</span></div>
        <ul className="spec">
          {specs.map((m) => (
            <li key={m.id}>
              <Link className="spec-row" href={m.href}>
                <span className="spec-label">{m.label.replace(` (${month})`, "")}</span>
                <span className="spec-value" data-tone={m.tone}>{m.value}</span>
                <CaretRight size={16} className="callout-go" aria-hidden />
              </Link>
              <details><summary><Plus size={12} weight="bold" className="disclose" aria-hidden /> How it is counted</summary>{m.definition}</details>
            </li>
          ))}
        </ul>
      </section>

      <section className="plate" aria-labelledby="h-exp">
        <div className="plate-head"><h2 id="h-exp" style={{ margin: 0 }}>Spend against estimate</h2><Link className="code-tag" href="/expenses">All expenses</Link></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th className="pin">Project</th><th className="num">Estimate</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">Variance</th></tr></thead>
            <tbody>
              {d.expenses.map((e) => (
                <tr key={e.id}>
                  <th scope="row" className="pin" style={{ fontWeight: 600 }}><Link href={`/expenses?project=${e.id}`}>{e.business_id}</Link></th>
                  <td className="num">{formatMoney(e.estimate)}</td>
                  <td className="num">{formatMoney(e.budget)}</td>
                  <td className="num">{formatMoney(e.actual)}</td>
                  <td className="num">{e.budgetVarianceMinor === null ? "N/A" : `${formatMoney(e.budgetVarianceMinor)}${e.budgetVariancePercent === null ? "" : ` (${e.budgetVariancePercent}%)`}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: "10px 0 0" }}>A missing budget shows N/A, never zero. Actual is approved expenses less approved credits.</p>
      </section>
    </>
  );
}
