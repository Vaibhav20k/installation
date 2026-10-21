/**
 * Schedule-start derivation (master prompt section 6, "Dates, travel, and site occupancy").
 * Missing dates yield a tentative result with named blockers; no buffer is invented.
 */
import { addDays, dayDiff, weekday } from "@/lib/dates";

export interface StartInputs {
  requestedInstallationStart?: string | null;
  arrivalDate?: string | null;
  predecessorCompletion?: string | null;
  materialAvailable?: string | null;
  /** Actual clearance date, or null when not yet cleared. */
  clearanceDate?: string | null;
  /** Expected clearance date; usable only for drafts and always labelled. */
  expectedClearanceDate?: string | null;
  siteAccessDate?: string | null;
  buffer?: { amount: number; units: "calendar_days" | "work_days"; anchor: string } | null;
  /** Working weekdays (0=Sun..6=Sat) for work-day buffers and the first permitted working day. */
  workingWeekdays: number[];
  holidays?: string[];
  mode: "draft" | "firm";
}

export interface StartResult {
  start: string | null;
  tentative: boolean;
  blockers: string[];
  notes: string[];
  drivers: Array<{ name: string; date: string }>;
}

export function deriveScheduleStart(i: StartInputs): StartResult {
  const blockers: string[] = [];
  const notes: string[] = [];
  const drivers: Array<{ name: string; date: string }> = [];
  const push = (name: string, date: string | null | undefined, required: boolean) => {
    if (date) drivers.push({ name, date });
    else if (required) blockers.push(`Missing ${name}`);
  };
  push("requested installation start", i.requestedInstallationStart, true);
  push("arrival date", i.arrivalDate, false);
  push("predecessor completion", i.predecessorCompletion, false);
  push("material availability", i.materialAvailable, true);
  push("site-access date", i.siteAccessDate, true);
  if (i.clearanceDate) drivers.push({ name: "clearance date", date: i.clearanceDate });
  else if (i.mode === "draft" && i.expectedClearanceDate) {
    drivers.push({ name: "expected clearance date (not approved)", date: i.expectedClearanceDate });
    notes.push("Uses an expected clearance date; deployment still requires actual approval or a valid exception.");
  } else blockers.push(i.mode === "firm" ? "Clearance not approved" : "Missing clearance or expected clearance date");

  if (drivers.length === 0) return { start: null, tentative: true, blockers, notes, drivers };
  let start = drivers.reduce((m, d) => (dayDiff(m, d.date) > 0 ? d.date : m), drivers[0]!.date);
  const isWork = (d: string) => i.workingWeekdays.includes(weekday(d)) && !(i.holidays ?? []).includes(d);
  if (i.buffer && i.buffer.amount > 0) {
    if (i.buffer.units === "calendar_days") start = addDays(start, i.buffer.amount);
    else { let left = i.buffer.amount; while (left > 0) { start = addDays(start, 1); if (isWork(start)) left--; } }
    notes.push(`Configured buffer: ${i.buffer.amount} ${i.buffer.units.replace("_", " ")} from ${i.buffer.anchor}.`);
  }
  let guard = 0;
  while (!isWork(start) && guard++ < 366) start = addDays(start, 1);
  if (guard >= 366) blockers.push("No working day within a year of the derived start");
  return { start, tentative: blockers.length > 0 || notes.some((n) => n.startsWith("Uses an expected")), blockers, notes, drivers };
}

/** Hotel nights follow the itinerary (arrival to departure), not the installation workday count. */
export function hotelNights(arrivalDate: string, departureDate: string): number {
  return Math.max(0, dayDiff(arrivalDate, departureDate));
}
