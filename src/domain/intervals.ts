/**
 * Half-open time intervals [start, end) in UTC epoch milliseconds.
 * Adjacent intervals do not overlap; overlapping ones do.
 */
import { addDays, localDateOf, monthBounds, monthOf, startOfLocalDay } from "@/lib/dates";

export interface Interval { start: number; end: number }

export const MINUTE = 60_000;

export function interval(start: number, end: number): Interval {
  if (!(Number.isFinite(start) && Number.isFinite(end))) throw new Error("Interval bounds must be finite");
  if (end <= start) throw new Error("Interval end must be after its start");
  return { start, end };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function durationMinutes(iv: Interval | Interval[]): number {
  const list = Array.isArray(iv) ? union(iv) : [iv];
  let ms = 0;
  for (const i of list) ms += i.end - i.start;
  return ms / MINUTE;
}

/** Sorted, merged, non-overlapping union. Adjacent intervals merge. */
export function union(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).map((i) => ({ ...i })).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push(cur);
  }
  return out;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const ua = union(a), ub = union(b);
  const out: Interval[] = [];
  let i = 0, j = 0;
  while (i < ua.length && j < ub.length) {
    const x = ua[i]!, y = ub[j]!;
    const start = Math.max(x.start, y.start), end = Math.min(x.end, y.end);
    if (end > start) out.push({ start, end });
    if (x.end < y.end) i++; else j++;
  }
  return out;
}

export function subtract(from: Interval[], remove: Interval[]): Interval[] {
  const rem = union(remove);
  const out: Interval[] = [];
  for (const base of union(from)) {
    let pieces: Interval[] = [base];
    for (const r of rem) {
      const next: Interval[] = [];
      for (const p of pieces) {
        if (!overlaps(p, r)) { next.push(p); continue; }
        if (r.start > p.start) next.push({ start: p.start, end: r.start });
        if (r.end < p.end) next.push({ start: r.end, end: p.end });
      }
      pieces = next;
    }
    out.push(...pieces);
  }
  return out;
}

/** Returns pairs of indices whose intervals overlap (adjacent is fine). */
export function findOverlaps<T extends Interval>(items: T[]): Array<[T, T]> {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const out: Array<[T, T]> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j]!.start < sorted[i]!.end; j++) {
      out.push([sorted[i]!, sorted[j]!]);
    }
  }
  return out;
}

/** Splits an interval at local midnights in tz. */
export function splitAtLocalDays(iv: Interval, tz: string): Array<Interval & { date: string }> {
  const out: Array<Interval & { date: string }> = [];
  let cursor = iv.start;
  while (cursor < iv.end) {
    const date = localDateOf(cursor, tz);
    const nextMidnight = startOfLocalDay(addDays(date, 1), tz);
    const end = Math.min(nextMidnight, iv.end);
    out.push({ start: cursor, end, date });
    cursor = end;
  }
  return out;
}

/** Splits an interval at local month boundaries in tz. */
export function splitAtLocalMonths(iv: Interval, tz: string): Array<Interval & { month: string }> {
  const out: Array<Interval & { month: string }> = [];
  let cursor = iv.start;
  while (cursor < iv.end) {
    const month = monthOf(localDateOf(cursor, tz));
    const boundary = startOfLocalDay(monthBounds(month).next, tz);
    const end = Math.min(boundary, iv.end);
    out.push({ start: cursor, end, month });
    cursor = end;
  }
  return out;
}

/** UTC interval covering a whole local month. */
export function localMonthInterval(month: string, tz: string): Interval {
  const b = monthBounds(month);
  return { start: startOfLocalDay(b.first, tz), end: startOfLocalDay(b.next, tz) };
}

/** Takes the first `minutes` of a list of intervals (chronological). */
export function takeMinutes(list: Interval[], minutes: number): Interval[] {
  const out: Interval[] = [];
  let left = minutes * MINUTE;
  for (const iv of [...list].sort((a, b) => a.start - b.start)) {
    if (left <= 0) break;
    const len = iv.end - iv.start;
    if (len <= left) { out.push({ ...iv }); left -= len; }
    else { out.push({ start: iv.start, end: iv.start + left }); left = 0; }
  }
  return out;
}
