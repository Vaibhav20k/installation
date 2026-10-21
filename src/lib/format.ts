/** Display formatting. Calculations never happen here; values arrive computed from the server. */
import { formatMoney } from "@/domain/expenses";
import { formatDateTime, localDateOf, localTimeOf } from "./dates";

export const TZ = "Asia/Kolkata";
export { formatMoney };

export function hours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const sign = minutes < 0 ? "-" : "";
  const m = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export const when = (ms: number | null | undefined, tz = TZ) => (ms ? formatDateTime(ms, tz) : "—");
export const day = (ms: number | null | undefined, tz = TZ) => (ms ? localDateOf(ms, tz) : "—");
export const clock = (ms: number | null | undefined, tz = TZ) => (ms ? localTimeOf(ms, tz) : "—");

export function humanize(code: string | null | undefined): string {
  if (!code) return "—";
  const s = code.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const LEVEL = ["", "Low", "Medium", "High"] as const;

export function qty(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Parses a rupee amount typed by a user ("1500", "1500.5") into integer paise without floating point. */
export function rupeesToMinor(text: string): number {
  const m = /^\s*(\d+)(?:\.(\d{0,2}))?\s*$/.exec(text ?? "");
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}
