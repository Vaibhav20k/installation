/**
 * Timezone-aware date helpers built on Intl only (no calendar library).
 * Timestamps are UTC epoch milliseconds; local dates are "YYYY-MM-DD" strings.
 */
export type LocalDate = string;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

interface Parts { y: number; m: number; d: number; h: number; mi: number; s: number }

function partsOf(ms: number, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year!, m: out.month!, d: out.day!, h: out.hour! % 24, mi: out.minute!, s: out.second! };
}

/** Minutes the zone is ahead of UTC at instant ms (Asia/Kolkata: 330). */
export function tzOffsetMinutes(ms: number, tz: string): number {
  const p = partsOf(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Converts a local wall-clock date + "HH:MM" in tz to a UTC instant. */
export function zonedToUtc(date: LocalDate, time: string, tz: string): number {
  const [y, m, d] = parseDate(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!tm) throw new Error(`Invalid time "${time}"`);
  const guess = Date.UTC(y, m - 1, d, Number(tm[1]), Number(tm[2]));
  let ms = guess - tzOffsetMinutes(guess, tz) * 60000;
  const second = tzOffsetMinutes(ms, tz);
  ms = guess - second * 60000;
  return ms;
}

export function localDateOf(ms: number, tz: string): LocalDate {
  const p = partsOf(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function localTimeOf(ms: number, tz: string): string {
  const p = partsOf(ms, tz);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

export function parseDate(date: LocalDate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD with an explicit year)`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new Error(`Invalid date "${date}"`);
  return [y, mo, d];
}

export function isLocalDate(value: string): boolean {
  try { parseDate(value); return true; } catch { return false; }
}

export function addDays(date: LocalDate, n: number): LocalDate {
  const [y, m, d] = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Calendar date difference b - a in days. */
export function dayDiff(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = parseDate(a);
  const [by, bm, bd] = parseDate(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(date: LocalDate): number {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; dayDiff(d, to) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthOf(date: LocalDate): string { return date.slice(0, 7); }

export function monthBounds(month: string): { first: LocalDate; last: LocalDate; next: LocalDate } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Invalid month "${month}"`);
  const first = `${month}-01`;
  const [y, m] = parseDate(first);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { first, last: addDays(next, -1), next };
}

/** Local midnight at the start of date, as a UTC instant. */
export function startOfLocalDay(date: LocalDate, tz: string): number {
  return zonedToUtc(date, "00:00", tz);
}

export function pad(n: number): string { return String(n).padStart(2, "0"); }

export function formatDateTime(ms: number, tz: string): string {
  return `${localDateOf(ms, tz)} ${localTimeOf(ms, tz)}`;
}

export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}h ${pad(abs % 60)}m`;
}
