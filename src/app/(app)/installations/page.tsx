import Link from "next/link";
import { CalendarBlank, CaretRight, ListBullets, MagnifyingGlass, MapTrifold, Users } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { installationsBoard, type InstallRow } from "@/server/queries/installations";
import { dayDiff, localDateOf } from "@/lib/dates";
import { TZ } from "@/lib/format";
import { shortDate } from "@/domain/install-schedule";
import { Badge } from "@/components/ui/Badge";
import { Empty, Notice, PageHeader } from "@/components/ui/Notice";
import { installCalendar } from "@/server/queries/install-calendar";
import { handoverState } from "@/domain/handover";
import { HandoverFlag } from "@/components/install/HandoverFlag";
import { InstallCalendar, SiteMap, monthLabel } from "@/components/install/InstallOverview";
import { MidnightRefresh } from "@/components/install/MidnightRefresh";
import { DueCalendar, type DueItem } from "@/components/install/DueCalendar";

export const metadata = { title: "Installations" };

export default async function InstallationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  if (actor.role === "employee") return <Notice tone="warn" title="Not permitted">The installations board is for supervisors, managers and administrators. Your work is on My day.</Notice>;
  const today = localDateOf(Date.now(), TZ);
  const view = sp.view === "calendar" || sp.view === "map" ? sp.view : "list";
  if (view !== "list") return <Overview view={view} sp={sp} today={today} />;
  const all = await installationsBoard(db, actor, today);
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = q ? all.filter((r) => [r.customer, r.customer_name, r.project, r.project_name, r.visit, ...r.orders.map((o) => o.business_id)].some((s) => s.toLowerCase().includes(q))) : all;
  const onSite = rows.filter((r) => r.exec_status === "in_progress" || r.exec_status === "on_hold");
  const upcoming = rows.filter((r) => !onSite.includes(r));
  // Calendar beside the list: every open installation with a handover date, on that date; late ones flagged.
  const due: DueItem[] = all.flatMap((r) => {
    const h = handoverState(r, Date.now());
    if (h.kind !== "due" && h.kind !== "overdue") return [];
    return [{ visit_id: r.visit_id, due: h.due, late: h.kind === "overdue", days_late: h.kind === "overdue" ? h.days : 0,
      customer: r.customer, name: r.customer_name.replace(/^Demo Customer /, ""), project: r.project_name, visit: r.visit, status: r.exec_status }];
  });
  return (
    <>
      <PageHeader title="Installations" subtitle="Every open site: the customer, how long the plan runs, who is on it and how far along it is. Tap a site for its day-by-day progress." />
      <MidnightRefresh tz={TZ} />
      <ViewSwitch view="list" />
      <div className="plans-layout">
      <div className="plans-main">
      <form className="search-bar" role="search" aria-label="Find an installation">
        <MagnifyingGlass size={18} aria-hidden />
        <label htmlFor="iq" className="sr-only">Customer, project or order</label>
        <input id="iq" name="q" defaultValue={sp.q ?? ""} placeholder="Customer ID, name, project or order" autoCapitalize="none" autoCorrect="off" enterKeyHint="search" />
        {q && <Link href="/installations" className="small">Clear</Link>}
      </form>

      <Section title="On site" rows={onSite} today={today} empty={q ? "No site matches that search." : "Nobody is on site right now."} />
      <Section title="Coming up" rows={upcoming} today={today} empty={q ? "No upcoming visit matches that search." : "No visits are planned yet."} />
      </div>
      <aside className="plans-aside" aria-label="Handover calendar"><DueCalendar items={due} today={today} /></aside>
      </div>
    </>
  );
}

function ViewSwitch({ view, month }: { view: string; month?: string }) {
  const m = month ? `&month=${month}` : "";
  return (
    <nav className="view-switch" aria-label="Installation views">
      <Link href="/installations" aria-current={view === "list" ? "true" : undefined}><ListBullets size={16} aria-hidden /> List</Link>
      <Link href={`/installations?view=calendar${m}`} aria-current={view === "calendar" ? "true" : undefined}><CalendarBlank size={16} aria-hidden /> Calendar</Link>
      <Link href={`/installations?view=map${m}`} aria-current={view === "map" ? "true" : undefined}><MapTrifold size={16} aria-hidden /> Map</Link>
    </nav>
  );
}

/** Calendar and map share one scoped month query, so a date's count and the map's list are the same records. */
async function Overview({ view, sp, today }: { view: "calendar" | "map"; sp: Record<string, string | undefined>; today: string }) {
  const { db, actor } = await session();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") && sp.date!.startsWith(month) ? sp.date! : month === today.slice(0, 7) ? today : null;
  const cal = await installCalendar(db, actor, month, Date.now());
  const overdue = cal.visits.filter((v) => v.handover.kind === "overdue").length;
  const href = (p: Record<string, string>) => `/installations?${new URLSearchParams({ view, ...p }).toString()}`;
  return (
    <>
      <PageHeader title="Installations" subtitle="Scheduled installations by date, and the sites they are at. Select a date or a site for its details." />
      <MidnightRefresh tz={TZ} />
      <div className="overview-bar">
        <ViewSwitch view={view} month={month} />
        <span className="range-note">Showing {monthLabel(month)} ({shortDate(cal.first)} to {shortDate(cal.last)}) · {cal.visits.length} installation visit{cal.visits.length === 1 ? "" : "s"}{overdue ? ` · ${overdue} overdue handover${overdue === 1 ? "" : "s"}` : ""}</span>
      </div>
      {view === "calendar" ? <InstallCalendar month={month} today={today} selected={selected} byDate={cal.byDate} href={href} /> : (
        <>
          <nav className="cal-nav" aria-label="Month"><Link href={href({ month: monthShift(month, -1) })}>Previous month</Link><Link href={href({ month: monthShift(month, 1) })}>Next month</Link></nav>
          <SiteMap month={month} visits={cal.visits} canEdit={actor.role === "manager" || actor.role === "admin"} />
        </>
      )}
    </>
  );
}

const monthShift = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

function Section({ title, rows, today, empty }: { title: string; rows: InstallRow[]; today: string; empty: string }) {
  return (
    <section aria-label={title} className="stack" style={{ gap: 12 }}>
      <h2 className="section-label">{title} <span className="code">{rows.length}</span></h2>
      {rows.length === 0 ? <Empty>{empty}</Empty> : <ul className="install-list">{rows.map((r) => <li key={r.visit_id}><SiteCard r={r} today={today} /></li>)}</ul>}
    </section>
  );
}

function SiteCard({ r, today }: { r: InstallRow; today: string }) {
  const start = r.schedule_start ?? r.planned_start, end = r.schedule_end ?? r.planned_end;
  const span = start && end ? dayDiff(start, end) + 1 : null;
  const pct = r.work_days ? Math.round((r.done_days / r.work_days) * 100) : r.scoped ? Math.round((r.accepted / r.scoped) * 100) : 0;
  const dayNo = r.work_days ? r.done_days + r.delayed_days + (r.today_kind === "work" ? 1 : 0) : null;
  const lead = r.team[0];
  return (
    <Link className="plate site-card" href={`/installations/${r.visit_id}`}>
      <div className="plate-head">
        <span className="code-tag"><span className="nw">{r.customer}</span> · <span className="nw">{r.project}</span> · <span className="nw">{r.visit}</span></span>
        {r.behind_days > 0 ? <Badge state="fail" tone="bad" label={`Behind ${r.behind_days} day${r.behind_days > 1 ? "s" : ""}`} /> : <Badge state={r.exec_status} />}
      </div>
      <HandoverFlag state={handoverState(r, Date.now())} compact />
      <h3 className="plate-title">{r.customer_name.replace(/^Demo Customer /, "")}</h3>
      <p className="plate-sub">{r.project_name} · {r.orders.map((o) => `${o.business_id} ${o.product}`).join(", ") || "No order linked"}</p>
      <dl className="site-facts">
        <div><dt>Plan</dt><dd>{r.work_days ? `${r.work_days} working days` : span ? `${span} day${span === 1 ? "" : "s"}` : "Not dated"}{start && end ? <span className="muted"> · {shortDate(start)} to {shortDate(end)}</span> : null}</dd></div>
        <div><dt>Team</dt><dd className="team-line"><Users size={16} aria-hidden /> {r.team.length ? r.team.map((m) => m.name).join(", ") : "Not assigned"}{lead && r.team.length ? <span className="muted"> · {r.team.length} people</span> : null}</dd></div>
        <div><dt>{r.today_step && start && today >= start ? "Today" : "Status"}</dt><dd>{r.today_step && start && today >= start ? r.today_step : r.template ? `${r.template} schedule ready` : "No customer schedule yet"}</dd></div>
      </dl>
      <div className="site-progress">
        <div className="meter" role="img" aria-label={`${pct}% complete`}><span style={{ transform: `scaleX(${pct / 100})` }} /></div>
        <span className="code">{pct}%</span>
        <span className="small muted">{dayNo && r.work_days ? `day ${Math.min(dayNo, r.work_days)} of ${r.work_days}` : r.scoped ? "by quantity" : ""}</span>
        <CaretRight size={18} className="callout-go" aria-hidden />
      </div>
    </Link>
  );
}
