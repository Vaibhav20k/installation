/**
 * Pure chart maths for the report charts: nice axis maxima, ticks, percentages, donut arcs and the
 * small aggregations the tracker views need. No React, no DOM — unit-tested in tests/unit/report-charts.test.ts.
 */

export interface Datum { label: string; value: number }

/** Smallest "nice" number (1, 2, 2.5, 5 × 10^k) at or above `max`; 1 when there is nothing to plot. */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = 10 ** exp;
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * base;
    if (candidate >= max - 1e-9) return +candidate.toPrecision(12);
  }
  return 10 * base;
}

/** Evenly spaced ticks from 0 to niceMax(max), inclusive; `count` intervals. */
export function ticks(max: number, count = 4): number[] {
  const top = niceMax(max);
  return Array.from({ length: count + 1 }, (_, i) => +((top * i) / count).toPrecision(12));
}

/** value as a percentage of max, clamped to 0–100; 0 when max is not positive. */
export function pct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export interface Arc { label: string; value: number; share: number; start: number; length: number; rotate: number }

/**
 * Donut segments on a circle with pathLength 100. `start`/`length` are in those units; `rotate` is the
 * degrees to turn a segment so it starts at `start` measured clockwise from 12 o'clock. Zero and negative
 * values are dropped. `gap` (path units) separates neighbours when there is more than one segment.
 */
export function donutArcs(items: Datum[], gap = 0): Arc[] {
  const kept = items.filter((d) => Number.isFinite(d.value) && d.value > 0);
  const total = kept.reduce((a, d) => a + d.value, 0);
  if (total <= 0) return [];
  const g = kept.length > 1 ? gap : 0;
  let cursor = 0;
  return kept.map((d) => {
    const share = (d.value / total) * 100;
    const arc = { label: d.label, value: d.value, share, start: cursor, length: Math.max(0, share - g), rotate: cursor * 3.6 - 90 };
    cursor += share;
    return arc;
  });
}

/** Count rows by a key; blanks fold into `blank`. Sorted by count desc, then label. */
export function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T, blank = "Not recorded"): Datum[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const raw = r[key];
    const label = raw === null || raw === undefined || raw === "" ? blank : String(raw);
    m.set(label, (m.get(label) ?? 0) + 1);
  }
  return sortData([...m].map(([label, value]) => ({ label, value })));
}

/** Sum a numeric column by a group key; non-numeric values count as 0. Sorted by total desc, then label. */
export function sumBy<T extends Record<string, unknown>>(rows: T[], groupKey: keyof T, valueKey: keyof T, blank = "Not recorded"): Datum[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const raw = r[groupKey];
    const label = raw === null || raw === undefined || raw === "" ? blank : String(raw);
    m.set(label, (m.get(label) ?? 0) + toNumber(r[valueKey]));
  }
  return sortData([...m].map(([label, value]) => ({ label, value })));
}

/** Numbers from DB rows arrive as number, numeric string (bigint) or null. */
export function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

function sortData(d: Datum[]): Datum[] {
  return d.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** The n months ending with `month` (YYYY-MM), oldest first. */
export function lastMonths(month: string, n: number): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** "2026-10" -> "Oct". */
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? month;
}

/**
 * MIS completeness split from the KRA row text ("50% complete, 33.33% on time") and its coverage
 * ("18 expected …"). Returns whole-number counts that add up to the total, or null when the text is not a measurement.
 */
export function misSplit(actual: string, coverage: string): { total: number; onTime: number; late: number; missing: number } | null {
  const a = /^([\d.]+)% complete, ([\d.]+)% on time/.exec(actual);
  const c = /^(\d+) expected/.exec(coverage);
  if (!a || !c) return null;
  const total = Number(c[1]);
  if (!total) return null;
  const complete = Math.round((Number(a[1]) / 100) * total);
  const onTime = Math.min(complete, Math.round((Number(a[2]) / 100) * total));
  return { total, onTime, late: complete - onTime, missing: total - complete };
}

export type Evidence = "measured" | "no_data" | "elsewhere";

/** Whether a KRA row carries a computed actual for the period. */
export function kpiEvidence(actual: string): Evidence {
  if (actual === "See tracker") return "elsewhere";
  if (actual === "N/A" || actual === "Not rated" || actual.trim() === "") return "no_data";
  return "measured";
}

/** Integers stay integers; everything else gets up to `digits` decimals. */
export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

/** "partly_dispatched" -> "Partly dispatched". */
export function labelOf(code: string): string {
  const s = code.replace(/_/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
