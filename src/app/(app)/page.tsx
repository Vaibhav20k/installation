import Link from "next/link";
import { ArrowRight, CaretRight, FlagCheckered, Plus, ShieldWarning, Stamp, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { dashboard } from "@/server/queries/dashboard";
import { listProjects } from "@/server/queries/projects";
import { installationsBoard } from "@/server/queries/installations";
import { localDateOf, monthOf } from "@/lib/dates";
import { formatMoney, TZ } from "@/lib/format";
import { shortDate } from "@/domain/install-schedule";
import { handoverState } from "@/domain/handover";
import { Badge } from "@/components/ui/Badge";
import { TodaySites } from "@/components/install/TodaySites";
import { NeedsYou, type Need } from "@/components/home/NeedsYou";
import { CrewMonth } from "@/components/home/CrewMonth";
import { ImPipeline } from "@/components/home/ImPipeline";
import { DueCalendar, type DueItem } from "@/components/install/DueCalendar";
import { defaultTile, imPipeline, isTileKey } from "@/server/queries/im-pipeline";
import { FactoryHome } from "@/components/factory/FactoryHome";
import { workspaceOf } from "@/server/workspace";

export const metadata = { title: "Overview" };

/** A decision is shown as overdue once its oldest item has waited this long (a display cue, not a policy). */
const DECISION_DAYS = 2;
const DAY_MS = 86_400_000;
const s = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const now = Date.now();
  // The Factory side has its own home: what to send, and the replacements to make (docs/plans/workspaces-design.md).
  if ((await workspaceOf(db, actor)).current === "factory") return <FactoryHome db={db} actor={actor} now={now} sp={sp} />;
  const today = localDateOf(now, TZ);
  const crew = actor.role === "employee";
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : monthOf(today);
  const projectId = sp.project || undefined;
  const [d, projects, board, pipe] = await Promise.all([dashboard(db, actor, { month, projectId }, now), listProjects(db, actor), crew ? Promise.resolve([]) : installationsBoard(db, actor, today),
    crew ? Promise.resolve(null) : imPipeline(db, actor, now)]);
  // Installation Managers (and administrators) get the pipeline and the handover calendar first; nobody else's home changes.
  const stage = pipe ? (isTileKey(sp.stage) ? sp.stage : defaultTile(pipe.tiles)) : null;
  const due: DueItem[] = pipe ? board.flatMap((r) => {
    const h = handoverState(r, now);
    if (h.kind !== "due" && h.kind !== "overdue") return [];
    return [{ visit_id: r.visit_id, due: h.due, late: h.kind === "overdue", days_late: h.kind === "overdue" ? h.days : 0,
      customer: r.customer, name: r.customer_name.replace(/^Demo Customer /, ""), project: r.project_name, visit: r.visit, status: r.exec_status }];
  }) : [];
  const q = d.queues;
  const waiting = q.plans.length + q.time.length + q.overtime.length + q.expenses.length;
  const oldest = Math.min(...q.plans.map((p) => p.submitted_at ?? now), ...q.time.map((t) => t.end), ...q.overtime.map((o) => o.end), now);
  const lateHandovers = board.map((r) => ({ r, h: handoverState(r, now) })).filter((x) => x.h.kind === "overdue")
    .sort((a, b) => (b.h.kind === "overdue" ? b.h.days : 0) - (a.h.kind === "overdue" ? a.h.days : 0));
  const firstLate = lateHandovers[0];
  const r0 = d.readiness[0];
  const needs = [
    !crew && waiting > 0 && { href: "/approvals", n: waiting, label: "Waiting for your decision", icon: <Stamp size={22} weight="duotone" />,
      meta: [q.plans.length && `${q.plans.length} plan`, q.time.length && `${q.time.length} time`, q.overtime.length && `${q.overtime.length} overtime`, q.expenses.length && `${q.expenses.length} expense`].filter(Boolean).join(", "),
      overdue: now - oldest >= DECISION_DAYS * DAY_MS },
    d.conflicts.length > 0 && { href: "/planning?view=sheet&conflicts=1", n: d.conflicts.length, label: `Staffing ${s(d.conflicts.length, "conflict")}`, icon: <UsersThree size={22} weight="duotone" />,
      meta: d.conflicts[0]!.conflicts[0]!, overdue: d.conflicts.some((c) => (c.plannedStart && c.plannedStart <= today) || c.conflicts.some((x) => x.startsWith("Overrun"))) },
    r0 && { href: d.readiness.length === 1 ? `/visits/${r0.visitId}?step=clearance` : "/planning?view=sheet", n: d.readiness.length, label: `${s(d.readiness.length, "Visit")} blocked on clearance`, icon: <ShieldWarning size={22} weight="duotone" />,
      meta: `${r0.visit} starts ${r0.plannedStart ? shortDate(r0.plannedStart) : "undated"}`, overdue: d.readiness.some((r) => !!r.plannedStart && r.plannedStart <= today) },
    firstLate && { href: lateHandovers.length === 1 ? `/installations/${firstLate.r.visit_id}` : "/?sites=overdue#h-today", n: lateHandovers.length, label: `${s(lateHandovers.length, "Handover")} overdue`, icon: <FlagCheckered size={22} weight="duotone" />,
      meta: `${firstLate.r.customer_name.replace(/^Demo Customer /, "")}${firstLate.h.kind === "overdue" ? `, ${firstLate.h.days} ${s(firstLate.h.days, "day")} late` : ""}`, overdue: true },
  ].filter(Boolean) as Need[];
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

      {pipe && stage && <ImPipeline tiles={pipe.tiles} rows={pipe.rows} selected={stage}
        query={Object.fromEntries(Object.entries({ month: sp.month, project: sp.project }).filter((e): e is [string, string] => !!e[1]))}
        aside={<DueCalendar items={due} today={today} />} />}

      <NeedsYou items={needs} crew={crew} />

      {!crew && <TodaySites rows={board} today={today} sp={sp} />}

      <div className="grid cols-2 home-pair">
        {next ? (
          <section className="plate" aria-labelledby="h-next">
            <div className="plate-head">
              <span className="code-tag">{crew ? "Your next job" : "Next visit"} · {next.visit} · {next.projectBid}</span>
              <Badge state={next.approval} className="stamp-hero stamp-press" />
            </div>
            <h2 id="h-next" className="plate-title">{next.site}, {next.visitType.replace("_", "-")} visit</h2>
            <p className="plate-sub">{next.plannedStart ? shortDate(next.plannedStart) : "Not dated"} to {next.plannedEnd ? shortDate(next.plannedEnd) : "not dated"} · team {next.staffed} of {next.teamSize}</p>
            <ol className="callouts" style={{ marginTop: 8 }}>
              <li><Link href={`/visits/${next.visitId}`}>
                <span className="callout-n quiet"><ArrowRight size={14} weight="bold" aria-hidden /></span>
                <span><span className="callout-title">{next.nextAction}</span><span className="callout-meta">{next.owner ? `Owner ${next.owner}` : "No owner yet"}</span></span>
                <CaretRight size={18} className="callout-go" aria-hidden />
              </Link></li>
            </ol>
          </section>
        ) : (
          <section className="plate" aria-labelledby="h-next">
            <h2 id="h-next">{crew ? "Your next job" : "Next visit"}</h2>
            <p className="muted" style={{ margin: 0 }}>{crew ? "No job is booked for you in the next 2 weeks." : <>No visit starts in the next 14 days. <Link href="/planning/new">Plan one</Link>.</>}</p>
          </section>
        )}

        {!crew && (
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
        )}
      </div>

      {crew && <CrewMonth month={month} c={d.crew} upcoming={d.upcoming.length} />}

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
