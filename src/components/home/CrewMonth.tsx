/**
 * The field crew's month at a glance: the same figures as the manager's spec list, in plain words, big
 * numbers and one progress bar. Every tile opens the records behind it.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Car, CalendarCheck, Clock, ListChecks, MapPin, SealCheck, Wallet } from "@phosphor-icons/react/dist/ssr";
import { formatMoney } from "@/lib/format";

export interface CrewFigures {
  workDays: number; workMinutes: number; travelMinutes: number; bookedMinutes: number;
  claimedMinor: number; approvedMinor: number; claims: number; recon: string[]; unfinished: number;
}

const hours = (m: number) => { const h = Math.round((m / 60) * 10) / 10; return Number.isInteger(h) ? String(h) : h.toFixed(1); };
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Month sign-off in plain words, from the latest reconciliation state(s) in scope. */
function signOff(states: string[]): { value: string; note: string; tone?: "ok" | "warn" } {
  if (states.includes("final")) return { value: "Signed off", note: "Your hours for this month are checked and final.", tone: "ok" };
  if (states.includes("provisional")) return { value: "Being checked", note: "The office is checking your hours for this month.", tone: "warn" };
  if (states.includes("invalidated")) return { value: "Check again", note: "Something changed, so the month will be checked again.", tone: "warn" };
  return { value: "Not yet", note: "The month is checked after it ends." };
}

function Tile({ href, icon, label, value, unit, note, wide, tone, children }: { href: string; icon: ReactNode; label: string; value: string; unit?: string; note: string; wide?: boolean; tone?: "ok" | "warn"; children?: ReactNode }) {
  return (
    <li className={wide ? "crew-wide" : undefined}>
      <Link className="crew-tile" href={href} data-tone={tone}>
        <span className="crew-label"><span className="crew-ico" aria-hidden>{icon}</span>{label}</span>
        <span className="crew-value" data-long={value.length > 7 ? "" : undefined}>{value}{unit && <small> {unit}</small>}</span>
        {children}
        <span className="crew-note">{note}</span>
      </Link>
    </li>
  );
}

export function CrewMonth({ month, c, upcoming }: { month: string; c: CrewFigures; upcoming: number }) {
  const name = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  const pct = c.bookedMinutes > 0 ? Math.min(100, Math.round((c.workMinutes / c.bookedMinutes) * 100)) : null;
  const so = signOff(c.recon);
  return (
    <section className="plate" aria-labelledby="h-crew">
      <div className="plate-head"><h2 id="h-crew" style={{ margin: 0 }}>Your month, {name}</h2><span className="small muted">Tap any box for details</span></div>
      <ul className="crew-grid">
        <Tile wide href="/timesheets" icon={<Clock size={18} weight="bold" />} label="Hours worked" value={hours(c.workMinutes)} unit={plural(Math.round(c.workMinutes / 60), "hour")}
          note={pct === null ? "Only hours the office has accepted are counted. Breaks are not counted." : `Out of ${hours(c.bookedMinutes)} hours booked for you (booked time includes travel). Breaks are not counted.`}>
          {pct !== null && (
            <span className="crew-bar" role="img" aria-label={`${pct}% of booked hours worked`}><span style={{ transform: `scaleX(${pct / 100})` }} /></span>
          )}
        </Tile>
        <Tile href="/timesheets" icon={<CalendarCheck size={18} weight="bold" />} label="Days worked" value={String(c.workDays)} unit={plural(c.workDays, "day")} note="Days with accepted work this month." />
        <Tile href="/timesheets" icon={<Car size={18} weight="bold" />} label="Travel time" value={hours(c.travelMinutes)} unit={plural(Math.round(c.travelMinutes / 60), "hour")} note="Counted separately from work." />
        <Tile href="/expenses" icon={<Wallet size={18} weight="bold" />} label="Money claimed" value={formatMoney(c.claimedMinor)}
          note={c.claims === 0 ? "No claims this month." : `${c.claims} ${plural(c.claims, "claim")} · ${formatMoney(c.approvedMinor)} approved so far.`} />
        <Tile href="/my-day" icon={<MapPin size={18} weight="bold" />} label="Jobs coming up" value={String(upcoming)} unit={plural(upcoming, "job")} note="Site visits in the next 2 weeks." />
        <Tile href="/my-tasks" icon={<ListChecks size={18} weight="bold" />} label="Work left on your sites" value={String(c.unfinished)} unit={plural(c.unfinished, "task")} note="Tasks not finished yet." />
        <Tile href="/timesheets?tab=month" icon={<SealCheck size={18} weight="bold" />} label="Month check" value={so.value} tone={so.tone} note={so.note} />
      </ul>
    </section>
  );
}
