import { CaretRight, MagnifyingGlass, Users } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { installationsBoard, type InstallRow } from "@/server/queries/installations";
import { addDays, dayDiff, localDateOf } from "@/lib/dates";
import { TZ } from "@/lib/format";
import { shortDate } from "@/domain/install-schedule";
import { Badge } from "@/components/ui/Badge";
import { Empty, Notice, PageHeader } from "@/components/ui/Notice";

export const metadata = { title: "Installations" };

export default async function InstallationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  if (actor.role === "employee") return <Notice tone="warn" title="Not permitted">The installations board is for supervisors, managers and administrators. Your work is on My day.</Notice>;
  const today = localDateOf(Date.now(), TZ);
  const all = await installationsBoard(db, actor, today);
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = q ? all.filter((r) => [r.customer, r.customer_name, r.project, r.project_name, r.visit, ...r.orders.map((o) => o.business_id)].some((s) => s.toLowerCase().includes(q))) : all;
  const onSite = rows.filter((r) => r.exec_status === "in_progress" || r.exec_status === "on_hold");
  const upcoming = rows.filter((r) => !onSite.includes(r));
  const weekEnd = addDays(today, 7);
  const figures = [
    { label: "On site now", value: all.filter((r) => r.exec_status === "in_progress").length, tone: undefined },
    { label: "Behind the customer schedule", value: all.filter((r) => r.behind_days > 0).length, tone: all.some((r) => r.behind_days > 0) ? "bad" : undefined },
    { label: "Handovers in the next 7 days", value: all.filter((r) => { const end = r.schedule_end ?? r.planned_end; return !!end && end >= today && end <= weekEnd; }).length, tone: undefined },
    { label: "Crew on site today", value: new Set(all.filter((r) => r.exec_status === "in_progress" && r.today_kind !== "off").flatMap((r) => r.team.filter((m) => m.state === "confirmed").map((m) => m.id))).size, tone: undefined },
  ];
  return (
    <>
      <PageHeader title="Installations" subtitle="Every open site: the customer, how long the plan runs, who is on it and how far along it is. Tap a site for its day-by-day progress." />
      <form className="search-bar" role="search" aria-label="Find an installation">
        <MagnifyingGlass size={18} aria-hidden />
        <label htmlFor="iq" className="sr-only">Customer, project or order</label>
        <input id="iq" name="q" defaultValue={sp.q ?? ""} placeholder="Customer ID, name, project or order" autoCapitalize="none" autoCorrect="off" enterKeyHint="search" />
        {q && <a href="/installations" className="small">Clear</a>}
      </form>

      {!q && (
        <section className="plate" aria-labelledby="h-fig">
          <div className="plate-head"><h2 id="h-fig" style={{ margin: 0 }}>Today, {shortDate(today)}</h2><span className="code-tag">{all.length} open</span></div>
          <ul className="spec">
            {figures.map((f) => (
              <li key={f.label}><div className="spec-row" style={{ gridTemplateColumns: "1fr auto" }}><span className="spec-label">{f.label}</span><span className="spec-value" data-tone={f.tone}>{f.value}</span></div></li>
            ))}
          </ul>
        </section>
      )}

      <Section title="On site" rows={onSite} today={today} empty={q ? "No site matches that search." : "Nobody is on site right now."} />
      <Section title="Coming up" rows={upcoming} today={today} empty={q ? "No upcoming visit matches that search." : "No visits are planned yet."} />
    </>
  );
}

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
    <a className="plate site-card" href={`/installations/${r.visit_id}`}>
      <div className="plate-head">
        <span className="code-tag"><span className="nw">{r.customer}</span> · <span className="nw">{r.project}</span> · <span className="nw">{r.visit}</span></span>
        {r.behind_days > 0 ? <Badge state="fail" tone="bad" label={`Behind ${r.behind_days} day${r.behind_days > 1 ? "s" : ""}`} /> : <Badge state={r.exec_status} />}
      </div>
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
    </a>
  );
}
