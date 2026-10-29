/**
 * Installation overview views for one month: a calendar of distinct installation visits per date and a site
 * map of the sites. Both read the same scoped month records, so counts and lists always agree.
 * Day cells are links: hover or keyboard focus previews the day; a click or tap opens it underneath.
 */
import Link from "next/link";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import type { CalendarVisit } from "@/server/queries/install-calendar";
import { visitOrdinal } from "@/server/queries/install-calendar";
import { addDays, monthBounds, weekday } from "@/lib/dates";
import { shortDate } from "@/domain/install-schedule";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Notice";
import { HandoverFlag } from "./HandoverFlag";
import { LiveMap, type MapSite } from "./LiveMap";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

function breakdown(list: CalendarVisit[]) {
  const by = new Map<number, number>();
  for (const v of list) by.set(v.sequence, (by.get(v.sequence) ?? 0) + 1);
  return [...by.entries()].sort(([a], [b]) => a - b).map(([s, n]) => `${n} × ${visitOrdinal(s)}`).join(", ");
}

export function InstallCalendar({ month, today, selected, byDate, href }: { month: string; today: string; selected: string | null; byDate: Map<string, CalendarVisit[]>; href: (p: Record<string, string>) => string }) {
  const { first, last } = monthBounds(month);
  const lead = (weekday(first) + 6) % 7;
  const cells: Array<{ date: string; out: boolean }> = [];
  for (let i = lead; i > 0; i--) cells.push({ date: addDays(first, -i), out: true });
  for (let d = first; d <= last; d = addDays(d, 1)) cells.push({ date: d, out: false });
  while (cells.length % 7) cells.push({ date: addDays(cells[cells.length - 1]!.date, 1), out: true });
  const day = selected ? byDate.get(selected) ?? [] : [];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <section className="cal" aria-labelledby="h-cal">
        <div className="cal-head">
          <h2 id="h-cal">{monthLabel(month)}</h2>
          <nav className="cal-nav" aria-label="Month">
            <Link href={href({ month: shiftMonth(month, -1) })} aria-label={`Previous month, ${monthLabel(shiftMonth(month, -1))}`}><CaretLeft size={16} aria-hidden /></Link>
            <Link href={href({ month: today.slice(0, 7), date: today })}>Today</Link>
            <Link href={href({ month: shiftMonth(month, 1) })} aria-label={`Next month, ${monthLabel(shiftMonth(month, 1))}`}><CaretRight size={16} aria-hidden /></Link>
          </nav>
        </div>
        <div className="cal-grid" aria-hidden>{WD.map((w) => <span key={w} className="cal-wd">{w}</span>)}</div>
        <ul className="cal-grid" aria-label={`Installations in ${monthLabel(month)}`}>
          {cells.map((c) => {
            const list = c.out ? [] : byDate.get(c.date) ?? [];
            const late = list.some((v) => v.handover.kind === "overdue");
            const label = `${shortDate(c.date)}: ${list.length} installation${list.length === 1 ? "" : "s"}${late ? ", includes an overdue handover" : ""}`;
            if (c.out) return <li key={c.date} className="cal-day" data-out><a aria-hidden tabIndex={-1}><span className="cal-num">{Number(c.date.slice(8))}</span></a></li>;
            return (
              <li key={c.date} className="cal-day" data-today={c.date === today || undefined}>
                <Link href={href({ month, date: c.date })} aria-current={c.date === selected ? "date" : undefined} aria-label={label} aria-describedby={list.length ? `tip-${c.date}` : undefined} scroll={false}>
                  <span className="cal-num">{Number(c.date.slice(8))}</span>
                  {late && <span className="cal-late" aria-hidden />}
                  <span className="cal-count" data-zero={list.length === 0 || undefined}>{list.length || "–"}</span>
                </Link>
                {list.length > 0 && (
                  <div className="cal-tip" role="tooltip" id={`tip-${c.date}`}>
                    <strong>{list.length} installation{list.length === 1 ? "" : "s"}</strong> · {breakdown(list)}
                    <ul>{list.slice(0, 5).map((v) => <li key={v.visit_id}>{v.customer} {v.project_name}{v.handover.kind === "overdue" ? " (overdue)" : ""}</li>)}</ul>
                    {list.length > 5 && <span className="muted">and {list.length - 5} more</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="small muted" style={{ margin: "10px 0 0" }}>Each number counts installation visits on that date, once per visit however many people are booked. Dates are the visit&apos;s scheduled working days, or its planned dates where no customer schedule is laid out.</p>
      </section>
      {selected && (
        <section className="plate" aria-labelledby="h-day" aria-live="polite">
          <div className="plate-head"><h2 id="h-day" style={{ margin: 0 }}>{shortDate(selected)}</h2><span className="code-tag">{day.length} installation{day.length === 1 ? "" : "s"}</span></div>
          {day.length === 0 ? <Empty>No installation is scheduled on this date.</Empty> : <VisitList list={day} />}
        </section>
      )}
    </div>
  );
}

function VisitList({ list }: { list: CalendarVisit[] }) {
  return (
    <ul className="day-list">
      {list.map((v) => (
        <li key={v.visit_id}>
          <Link href={`/installations/${v.visit_id}`}>
            <span className="spread"><span className="code-tag">{v.customer} · {v.project} · {v.visit}</span><Badge state={v.exec_status} /></span>
            <strong>{v.customer_name.replace(/^Demo Customer /, "")} · {v.project_name}</strong>
            <span className="small muted">{visitOrdinal(v.sequence)} ({v.visit_type.replace("_", "-")}) · {v.city} · {v.team} booked{v.planned_start ? ` · ${shortDate(v.planned_start)} to ${shortDate(v.planned_end ?? v.planned_start)}` : ""}</span>
            <HandoverFlag state={v.handover} compact />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The map view: one pin per site for the month's installations (the same records as the calendar). Locations are
 * set by managers, never guessed from addresses; sites without one are listed beside the map.
 */
export function SiteMap({ month, visits, canEdit }: { month: string; visits: CalendarVisit[]; canEdit: boolean }) {
  const by = new Map<string, MapSite>();
  for (const v of visits) {
    const s = by.get(v.project_id) ?? { project_id: v.project_id, name: v.project_name, customer: v.customer_name.replace(/^Demo Customer /, ""), city: v.city, address: v.site_address, lat: v.latitude, lng: v.longitude, visits: [] };
    const due = v.handover.kind === "due" || v.handover.kind === "overdue" || v.handover.kind === "done" ? v.handover.due : null;
    s.visits.push({ visit_id: v.visit_id, visit: v.visit, ordinal: visitOrdinal(v.sequence), status: v.exec_status, late: v.handover.kind === "overdue", due: due ? shortDate(due) : null });
    by.set(v.project_id, s);
  }
  if (by.size === 0) return <Empty>No installation is scheduled in {monthLabel(month)}.</Empty>;
  return <LiveMap sites={[...by.values()]} canEdit={canEdit} />;
}
