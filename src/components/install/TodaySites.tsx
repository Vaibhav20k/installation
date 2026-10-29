/**
 * Today's sites and the handover window, shown on the Overview (moved off the Installations list on
 * 28 Oct 2026 so the plans come first there). The figures sit on top as count buttons that filter the
 * site cards below; each site is one card and the whole card opens the site. The rows come from the same
 * scoped board as the Installations list (the page loads them once and shares them with "Needs you").
 */
import Link from "next/link";
import { CaretRight, Users } from "@phosphor-icons/react/dist/ssr";
import type { InstallRow } from "@/server/queries/installations";
import { addDays } from "@/lib/dates";
import { shortDate } from "@/domain/install-schedule";
import { handoverState } from "@/domain/handover";
import { Badge } from "@/components/ui/Badge";
import { HandoverFlag } from "@/components/install/HandoverFlag";

type Key = "now" | "crew" | "overdue" | "behind" | "handover";
const KEEP = ["month", "project", "hdays", "hfrom", "hto"] as const;

export function TodaySites({ rows: all, today, sp }: { rows: InstallRow[]; today: string; sp: Record<string, string | undefined> }) {
  // Handover window: an adjustable report filter; "next 7 days" is only the starting preset, not a deadline.
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const hFrom = isDate(sp.hfrom) ? sp.hfrom! : today;
  const hTo = isDate(sp.hto) && sp.hto! >= hFrom ? sp.hto! : addDays(hFrom, Number(sp.hdays) > 0 && Number(sp.hdays) <= 366 ? Number(sp.hdays) : 7);
  const now = Date.now();
  const onSite = all.filter((r) => r.exec_status === "in_progress");
  const working = onSite.filter((r) => r.today_kind !== "off");
  const sets: Record<Key, InstallRow[]> = {
    now: onSite,
    crew: working,
    overdue: all.filter((r) => handoverState(r, now).kind === "overdue"),
    behind: all.filter((r) => r.behind_days > 0),
    handover: all.filter((r) => { const end = r.schedule_end ?? r.planned_end; return !!end && end >= hFrom && end <= hTo; }),
  };
  const crewCount = new Set(working.flatMap((r) => r.team.filter((m) => m.state === "confirmed").map((m) => m.id))).size;
  const figures: Array<{ key: Key; label: string; value: number; alert?: boolean }> = [
    { key: "now", label: "On site now", value: onSite.length },
    { key: "crew", label: "Crew on site today", value: crewCount },
    { key: "overdue", label: "Overdue handover", value: sets.overdue.length, alert: sets.overdue.length > 0 },
    { key: "behind", label: "Behind customer schedule", value: sets.behind.length, alert: sets.behind.length > 0 },
    { key: "handover", label: `Handovers ${shortDate(hFrom)} to ${shortDate(hTo)}`, value: sets.handover.length },
  ];
  const current = figures.find((f) => f.key === sp.sites) ?? figures[0]!;
  const shown = sets[current.key];
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const k of KEEP) if (sp[k]) p.set(k, sp[k]!);
    for (const [k, v] of Object.entries(over)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };
  const days = !sp.hfrom && !sp.hto ? (Number(sp.hdays) || 7) : null;

  return (
    <section className="plate" aria-labelledby="h-today">
      <div className="plate-head"><h2 id="h-today" style={{ margin: 0 }}>Sites today, {shortDate(today)}</h2><Link className="code-tag" href="/installations">{all.length} open <CaretRight size={12} aria-hidden /></Link></div>

      <nav aria-label="Filter sites">
        <ul className="site-filters">
          {figures.map((f) => (
            <li key={f.key}>
              <Link scroll={false} className="site-filter" href={href({ sites: f.key === "now" ? undefined : f.key })} aria-current={current.key === f.key ? "true" : undefined} data-alert={f.alert ? "" : undefined}>
                <span className="site-filter-n">{f.value}</span>
                <span className="site-filter-label">{f.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form className="handover-window" aria-label="Handover window" action="/">
        <span className="handover-window-label">Handover window</span>
        <span className="handover-window-presets">
          {[7, 14, 30].map((n) => (
            <Link key={n} scroll={false} className="button" href={href({ hdays: String(n), hfrom: undefined, hto: undefined, sites: "handover" })} aria-current={days === n ? "true" : undefined}>Next {n} days</Link>
          ))}
        </span>
        <span className="handover-window-range">
          <label className="sr-only" htmlFor="hf">From</label><input id="hf" type="date" name="hfrom" defaultValue={hFrom} />
          <span aria-hidden className="muted">to</span>
          <label className="sr-only" htmlFor="ht">To</label><input id="ht" type="date" name="hto" defaultValue={hTo} />
          <input type="hidden" name="sites" value="handover" />
          {sp.month && <input type="hidden" name="month" value={sp.month} />}
          {sp.project && <input type="hidden" name="project" value={sp.project} />}
          <button type="submit">Apply</button>
        </span>
      </form>

      <p className="sr-only" aria-live="polite">{current.label}: {shown.length} {shown.length === 1 ? "site" : "sites"}</p>
      {shown.length === 0 ? (
        <p className="home-empty">No sites under “{current.label}” right now. <Link href="/installations">See all {all.length} open sites</Link></p>
      ) : (
        <ul className="today-grid">
          {shown.map((r) => <li key={r.visit_id}><TodayCard r={r} today={today} now={now} /></li>)}
        </ul>
      )}
    </section>
  );
}

function TodayCard({ r, today, now }: { r: InstallRow; today: string; now: number }) {
  const start = r.schedule_start ?? r.planned_start;
  const pct = r.work_days ? Math.round((r.done_days / r.work_days) * 100) : r.scoped ? Math.round((r.accepted / r.scoped) * 100) : 0;
  const todayLine = r.exec_status !== "in_progress" ? (start ? `Starts ${shortDate(start)}` : "Not dated yet")
    : r.today_kind === "off" ? "Day off today" : r.today_step && start && today >= start ? r.today_step : "On site";
  return (
    <Link className="today-card" href={`/installations/${r.visit_id}`}>
      <span className="today-card-top">
        <span className="code-tag">{r.project} · {r.visit}</span>
        {r.behind_days > 0 ? <Badge state="fail" tone="bad" label={`Behind ${r.behind_days} day${r.behind_days > 1 ? "s" : ""}`} /> : <Badge state={r.exec_status} />}
      </span>
      <span className="today-card-name">{r.customer_name.replace(/^Demo Customer /, "")}</span>
      <span className="today-card-sub">{[r.city, r.project_name].filter(Boolean).join(" · ")}</span>
      <HandoverFlag state={handoverState(r, now)} compact />
      <span className="today-card-today"><span className="today-card-k">Today</span>{todayLine}</span>
      <span className="today-card-team"><Users size={16} aria-hidden /> {r.team.length ? `${r.team.length} on the team · ${r.team.map((m) => m.name).join(", ")}` : "No team assigned"}</span>
      <span className="today-card-progress">
        <span className="meter" aria-hidden><span style={{ transform: `scaleX(${pct / 100})` }} /></span>
        <span className="code">{pct}% done</span>
        <CaretRight size={16} className="callout-go" aria-hidden />
      </span>
    </Link>
  );
}
