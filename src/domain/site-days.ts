/**
 * Site-day reporting from site check-in/out records. Definitions (recording of 27 Oct 2026, proposed rules):
 * - Recorded site days: distinct site-local dates touched by completed sessions, using half-open [in, out),
 *   so a session ending exactly at midnight does not add the next date. Several sessions on one date count once.
 * - Recorded on-site duration: the length of the union of completed sessions (overlaps merged first).
 * - Open sessions (no check-out yet) are reported separately and never counted as days or duration.
 * A date of presence is not a full paid working day; there is no minimum-hours threshold here.
 */
import { addDays, localDateOf, startOfLocalDay, type LocalDate } from "@/lib/dates";

export interface Session { in: number; out: number | null }
export interface DaySlice { date: LocalDate; minutes: number }
export interface SiteDaySummary {
  days: DaySlice[];
  recordedDays: number;
  recordedMinutes: number;
  openSessions: number;
  firstIn: number | null;
  lastOut: number | null;
}

/** Union of half-open intervals, sorted. Empty or inverted intervals are dropped. */
export function mergeIntervals(list: Array<{ start: number; end: number }>) {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Splits [start, end) at each local midnight of tz. */
export function splitAtMidnight(start: number, end: number, tz: string): Array<{ date: LocalDate; start: number; end: number }> {
  const out: Array<{ date: LocalDate; start: number; end: number }> = [];
  let cur = start;
  while (cur < end) {
    const date = localDateOf(cur, tz);
    const next = Math.min(end, startOfLocalDay(addDays(date, 1), tz));
    out.push({ date, start: cur, end: next });
    cur = next;
  }
  return out;
}

export function siteDays(sessions: Session[], tz: string): SiteDaySummary {
  const done = sessions.filter((s): s is { in: number; out: number } => s.out !== null);
  const merged = mergeIntervals(done.map((s) => ({ start: s.in, end: s.out })));
  const byDate = new Map<LocalDate, number>();
  for (const m of merged) for (const p of splitAtMidnight(m.start, m.end, tz)) byDate.set(p.date, (byDate.get(p.date) ?? 0) + (p.end - p.start));
  const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, ms]) => ({ date, minutes: Math.round(ms / 60000) }));
  return {
    days,
    recordedDays: days.length,
    recordedMinutes: Math.round(merged.reduce((t, m) => t + (m.end - m.start), 0) / 60000),
    openSessions: sessions.length - done.length,
    firstIn: sessions.length ? Math.min(...sessions.map((s) => s.in)) : null,
    lastOut: done.length ? Math.max(...done.map((s) => s.out)) : null,
  };
}

/** Distinct local dates covered by half-open planned spans (reservations). */
export function plannedDates(spans: Array<{ start: number; end: number }>, tz: string): LocalDate[] {
  const set = new Set<LocalDate>();
  for (const m of mergeIntervals(spans)) for (const p of splitAtMidnight(m.start, m.end, tz)) set.add(p.date);
  return [...set].sort();
}
