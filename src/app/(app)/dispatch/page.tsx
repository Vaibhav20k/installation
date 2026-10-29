import Link from "next/link";
import { Plus, GearSix } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { workspaceOf } from "@/server/workspace";
import { flowDashboard, myPending, openItems, teamPending, type FlowItem } from "@/server/queries/dispatch";
import { flowVisibility } from "@/server/services/flow-core";
import { formatMoney } from "@/lib/format";
import { Empty, Notice, PageHeader } from "@/components/ui/Notice";
import { ItemCard } from "@/components/dispatch/FlowViews";
import { ViewTabs } from "@/components/dispatch/ViewTabs";
import { reportsToDecide } from "@/server/services/site-mnd";
import { complaintTracker } from "@/server/queries/complaint-tracker";
import { ComplaintTracker, parseTrackerFilter } from "@/components/dispatch/ComplaintTracker";

export const metadata = { title: "Dispatch" };

const VIEWS = ["mine", "team", "all", "complaints", "dashboard"] as const;
type View = (typeof VIEWS)[number];

function Group({ title, items, empty, tone, id }: { title: string; items: FlowItem[]; empty: string; tone?: "bad"; id?: string }) {
  return (
    <section className="stack flow-group" style={{ gap: 8 }} aria-label={title} id={id} data-tone={tone}>
      <h2 className="flow-subhead">{title} <span className="flow-count">{items.length}</span></h2>
      {items.length ? <ul className="flow-cards">{items.map((i) => <ItemCard key={`${i.type}-${i.id}`} i={i} />)}</ul> : <Empty>{empty}</Empty>}
    </section>
  );
}

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ view?: string; show?: string; phase?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const now = Date.now();
  const vis = await flowVisibility(db, actor);
  if (!vis.all && !vis.roles.length && actor.role === "employee") return <Notice tone="warn" title="Not permitted">Dispatch and complaints are for department staff and installation managers.</Notice>;
  // Each workspace shows its own side of the same records: the site follows complaints in five phases here,
  // the factory works them from its Complaints menu and reads the dashboard (docs/plans/workspaces-design.md).
  const factory = (await workspaceOf(db, actor)).current === "factory";
  const hidden: View = factory ? "complaints" : "dashboard";
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") && sp.view !== hidden ? (sp.view as View) : "all";
  const canCreate = vis.roles.includes("factory_dispatch");
  const hasTeam = actor.role !== "employee";
  // One read per list feeds both the view and the count badges on the view buttons.
  const [all, mine, reports, team] = await Promise.all([openItems(db, actor, now), myPending(db, actor, now), reportsToDecide(db, actor), hasTeam ? teamPending(db, actor, now) : Promise.resolve([])]);
  const teamIds = new Set(team.flatMap((p) => p.waiting.map((i) => `${i.type}-${i.id}`)));
  const tabs = ([
    // All open is the landing view (request of 28 Oct 2026); My steps is one tap away.
    { id: "all", label: "All open", href: "/dispatch", n: all.length },
    // Complaints in five plain factory phases, for the Installation Manager who raised them (28 Oct 2026).
    { id: "complaints", label: "Complaints", href: "/dispatch?view=complaints", n: all.filter((i) => i.type === "complaint").length, alert: all.some((i) => i.type === "complaint" && i.overdue), unit: "open" },
    { id: "mine", label: "My steps", href: "/dispatch?view=mine", n: mine.items.length + reports.length, alert: mine.items.some((i) => i.overdue) },
    ...(hasTeam ? [{ id: "team", label: "My team", href: "/dispatch?view=team", n: teamIds.size, alert: team.some((p) => p.overdue > 0) }] : []),
    { id: "dashboard", label: "Dashboard", href: "/dispatch?view=dashboard" },
  ] as Array<{ id: string; label: string; href: string; n?: number; alert?: boolean; unit?: string }>).filter((t) => t.id !== hidden);
  return (
    <div className="stack">
      <PageHeader title="Dispatch" subtitle="From ready for dispatch to installation done, and missing or damaged items back through the factory."
        actions={<div className="row">
          {canCreate && <Link className="button primary" href="/dispatch/new"><Plus size={16} aria-hidden /> Ready for dispatch</Link>}
          {actor.role === "admin" && <Link className="button" href="/dispatch/setup"><GearSix size={16} aria-hidden /> Setup</Link>}
        </div>} />
      <ViewTabs items={tabs} current={view} />
      {view === "mine" && <Mine roles={mine.roles} items={mine.items} reports={reports} />}
      {view === "team" && <Team team={team} />}
      {view === "all" && <All items={all} />}
      {view === "complaints" && <ComplaintTracker list={await complaintTracker(db, actor, now)} {...parseTrackerFilter(sp)} />}
      {view === "dashboard" && <Dashboard db={db} actor={actor} now={now} />}
    </div>
  );
}

type P = { db: Awaited<ReturnType<typeof session>>["db"]; actor: Awaited<ReturnType<typeof session>>["actor"]; now: number };

function Mine({ roles, items, reports }: { roles: string[]; items: FlowItem[]; reports: Awaited<ReturnType<typeof reportsToDecide>> }) {
  if (!roles.length) return <Empty>You hold no department role, so no steps wait on you. An administrator assigns roles in Dispatch setup.</Empty>;
  const overdue = items.filter((i) => i.overdue);
  return (
    <div className="stack flow-groups">
      {reports.length > 0 && (
        <section className="stack" style={{ gap: 8 }} aria-label="Reports from the site">
          <h2 className="flow-subhead">Reports from the site to confirm <span className="flow-count">{reports.length}</span></h2>
          <ul className="flow-cards">{reports.map((r) => (
            <li key={r.id} className="flow-card" data-type="complaint"><Link href={`/dispatch/${r.dispatch_id}#site-reports`}>
              <span className="flow-card-top"><span className="code-tag">{r.dispatch}</span><span className="flow-stage">Confirm or reject</span></span>
              <strong className="flow-card-title">{r.kind === "missing" ? "Missing" : "Damaged"}: {r.quantity} × {r.item}</strong>
              <span className="small muted">{r.project} · reported by {r.reporter}</span></Link></li>
          ))}</ul>
        </section>
      )}
      {overdue.length > 0 && <Group title="Overdue" items={overdue} empty="" />}
      <Group title="Waiting for you" items={items.filter((i) => !i.overdue)} empty="Nothing waits on you right now." />
    </div>
  );
}

function Team({ team }: { team: Awaited<ReturnType<typeof teamPending>> }) {
  if (!team.length) return <Empty>Nobody who reports to you holds a department role.</Empty>;
  // People with work waiting first (overdue, then most waiting); everyone else on one quiet line, not a card each.
  const busy = team.filter((p) => p.waiting.length > 0).sort((a, b) => b.overdue - a.overdue || b.waiting.length - a.waiting.length);
  const free = team.filter((p) => p.waiting.length === 0);
  return (
    <div className="stack flow-groups">
    {busy.length === 0 ? <Empty>Nothing is waiting on your team right now.</Empty> : (
    <ul className="flow-team">
      {busy.map((p) => (
        <li key={p.id} className="plate">
          <div className="team-head"><strong>{p.name} <span className="code muted">{p.business_id}</span></strong>
            <span className="small">{p.waiting.length} waiting{p.overdue ? <span className="flow-bad"> · {p.overdue} overdue</span> : ""}{p.oldest ? ` · oldest ${p.oldest} d` : ""}</span></div>
          <p className="small muted" style={{ margin: "2px 0 10px" }}>{p.roles.map((r) => r.replace(/_/g, " ")).join(", ")}</p>
          <ul className="flow-cards compact">{p.waiting.slice(0, 6).map((i) => <ItemCard key={`${i.type}-${i.id}`} i={i} showOwner={false} />)}</ul>
          {p.waiting.length > 6 && <p className="small muted">and {p.waiting.length - 6} more</p>}
        </li>
      ))}
    </ul>
    )}
    {free.length > 0 && (
      <p className="flow-team-free"><strong>Nothing waiting ({free.length}):</strong>{" "}
        {free.map((p, n) => <span key={p.id}>{n > 0 && " · "}{p.name} <span className="muted">({p.roles.map((r) => r.replace(/_/g, " ")).join(", ")})</span></span>)}</p>
    )}
    </div>
  );
}

function All({ items }: { items: FlowItem[] }) {
  const complaints = items.filter((i) => i.type === "complaint");
  return (
    <div className="stack flow-groups">
      {/* Complaints can't be overlooked: when there are any, they come before the dispatches. */}
      {complaints.length > 0 && <Group title="Open complaints" items={complaints} empty="" tone="bad" id="complaints" />}
      <Group title="Open dispatches" items={items.filter((i) => i.type === "dispatch")} empty="No open dispatches." />
      {complaints.length === 0 && <Group title="Open complaints" items={complaints} empty="No open complaints." id="complaints" />}
    </div>
  );
}

/** Label, bar and count share one grid, so every bar starts and ends on the same line. */
function Bars({ rows }: { rows: Array<{ code: string; label: string; n: number; overdue: number; held: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="stage-bars">
      {rows.map((r) => (
        <li key={r.code} data-zero={r.n === 0 || undefined}>
          <span className="stage-bars-label">{r.label}</span>
          <span className="stage-bars-track" aria-hidden><span style={{ transform: `scaleX(${r.n / max})` }} /></span>
          <span className="stage-bars-n">{r.n}</span>
          {(r.overdue > 0 || r.held > 0) && <span className="stage-bars-note">{r.overdue ? <span className="flow-bad">{r.overdue} late</span> : null}{r.overdue && r.held ? " · " : ""}{r.held ? <span>{r.held} on hold</span> : null}</span>}
        </li>
      ))}
    </ul>
  );
}

async function Dashboard({ db, actor, now }: P) {
  let d;
  try { d = await flowDashboard(db, actor, now); } catch { return <Notice tone="warn" title="Not permitted">The dashboard is for management and department staff.</Notice>; }
  const money = (v: string) => formatMoney(Math.round(Number(v) * 100));
  return (
    <div className="stack">
      <div className="flow-kpis">
        {/* Open complaints first, in red when there are any. */}
        <Link href="/dispatch#complaints" className="flow-kpi flow-kpi-link" data-tone={d.totals.openComplaints ? "bad" : undefined}><span className="flow-kpi-n">{d.totals.openComplaints}</span><span className="flow-kpi-l">open complaints</span></Link>
        <div className="flow-kpi"><span className="flow-kpi-n">{d.totals.openDispatches}</span><span className="flow-kpi-l">open dispatches</span></div>
        <div className="flow-kpi" data-tone={d.totals.overdue ? "bad" : undefined}><span className="flow-kpi-n">{d.totals.overdue}</span><span className="flow-kpi-l">steps overdue</span></div>
        {/* Cost totals only for Planning, Management and admins; the server leaves them out for everyone else. */}
        {d.cost && <div className="flow-kpi"><span className="flow-kpi-n">{money(d.cost.approved)}</span><span className="flow-kpi-l">approved complaint cost ({d.cost.approved_n})</span></div>}
        {d.cost && <div className="flow-kpi"><span className="flow-kpi-n">{money(d.cost.awaiting)}</span><span className="flow-kpi-l">costed, awaiting approval ({d.cost.awaiting_n})</span></div>}
      </div>
      <div className="dash-grid">
        <section className="plate" aria-labelledby="h-ds"><h2 id="h-ds" className="flow-subhead">Dispatches by stage</h2><Bars rows={d.dispatchStages} /></section>
        <section className="plate" aria-labelledby="h-cs"><h2 id="h-cs" className="flow-subhead">Complaints by stage</h2><Bars rows={d.complaintStages} />
          {d.byKind.length > 0 && <p className="small muted">{d.byKind.map((k) => `${k.n} ${k.kind}`).join(" · ")}{d.cost ? ` · ${d.cost.closed_n} closed` : ""}</p>}</section>
        <section className="plate" aria-labelledby="h-ag"><h2 id="h-ag" className="flow-subhead">Aging</h2><p className="small muted" style={{ margin: "0 0 8px" }}>Dispatches by days in their current step; complaints by days since raised.</p>
          <div className="table-wrap"><table><thead><tr><th scope="col">Age</th><th scope="col">Dispatches</th><th scope="col">Complaints</th></tr></thead>
            <tbody>{d.dispatchAging.map((a, i) => <tr key={a.bucket}><th scope="row">{a.bucket}</th><td>{a.n}</td><td>{d.complaintAging[i]!.n}</td></tr>)}</tbody></table></div></section>
        <section className="plate" aria-labelledby="h-or"><h2 id="h-or" className="flow-subhead">Orders</h2>
          {d.orders.length === 0 ? <Empty>No dispatches yet.</Empty> : (
            <div className="table-wrap"><table><thead><tr><th scope="col">Order</th><th scope="col">Dispatches</th><th scope="col">Open</th><th scope="col">Done</th><th scope="col">MND open</th></tr></thead>
              <tbody>{d.orders.map((o) => <tr key={o.order_no}><td><span className="code">{o.order_no}</span><div className="small muted">{o.customer} · {o.project}</div></td><td>{o.dispatches}</td><td>{o.open}</td><td>{o.completed}</td><td>{o.complaints_open}</td></tr>)}</tbody></table></div>
          )}</section>
      </div>
    </div>
  );
}
