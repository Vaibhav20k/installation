/**
 * Site-level planning rules (spec V3 board-meeting requirements 3, 4, 6, 7). Pure functions.
 * - Effort uses net installed quantity; gross/material quantity is shown, never used for time.
 * - Extra effort drivers add only for separately covered activities with an approved rate.
 * - A site's permitted window limits productive time per day; it never changes the 8-hour attendance rule
 *   or the estimate itself, it adds calendar days.
 * - An appliance that is only selected, or a brand technician not booked, is a readiness blocker.
 */
import { Dec } from "./decimal";
import { estimateFromRate, type ProductivityRate } from "./effort";

export interface Snapshot { basis: "net" | "gross"; quantity: string; unit: string; quantityKind: string }

/** The quantity estimates use: net if recorded, else none (gross is never converted). */
export function effortQuantity(snaps: Snapshot[]): { quantity: string; unit: string; quantityKind: string; note: string } | null {
  const net = snaps.find((s) => s.basis === "net");
  if (net) return { quantity: net.quantity, unit: net.unit, quantityKind: net.quantityKind, note: "Net installed quantity" };
  return null;
}

export interface Driver { id: string; driver: string; activity: string; quantity: string; unit: string; quantityKind: string }
export interface DriverLine { driverId: string; label: string; minutes: number | null; provisional: boolean; issue: string | null }

/** Sum of disjoint driver efforts. A driver without a matching rate stays visible as an explained gap, never zero. */
export function driverEffort(drivers: Driver[], rates: ProductivityRate[]) {
  const lines: DriverLine[] = drivers.map((d) => {
    const candidates = rates.filter((r) => r.activity === d.activity && r.quantityKind === d.quantityKind && r.unit === d.unit);
    const rate = candidates.find((r) => r.status === "approved") ?? candidates[0];
    const label = `${d.driver} · ${d.activity} · ${d.quantity} ${d.unit}`;
    if (!rate) return { driverId: d.id, label, minutes: null, provisional: true, issue: `No rate for ${d.activity} measured in ${d.quantityKind} (${d.unit}); this effort is unknown, not zero.` };
    const est = estimateFromRate({ value: d.quantity, unit: d.unit, quantityKind: d.quantityKind }, rate);
    if (!est.ok || !est.personMinutes) return { driverId: d.id, label, minutes: null, provisional: true, issue: est.issues.map((i) => i.message).join(" ") };
    return { driverId: d.id, label, minutes: Number(Dec.of(est.personMinutes).toString()), provisional: est.provisional, issue: est.provisional ? `Rate ${rate.id} is ${rate.status}.` : null };
  });
  const known = lines.filter((l) => l.minutes !== null);
  return { lines, knownMinutes: known.reduce((n, l) => n + (l.minutes ?? 0), 0), complete: known.length === lines.length, provisional: lines.some((l) => l.provisional) };
}

export interface Restriction { allowedWeekdays: number[]; startTime: string; endTime: string; restrictedActivities: string[] }
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/**
 * Calendar effect of a site window: productive minutes per permitted day are capped by the window
 * (and by the fixed 480-minute session). Returns crew-days needed for the work, not a changed estimate.
 */
export function siteCapacity(r: Restriction | null, personMinutes: number, crewSize: number) {
  const session = 480;
  const window = r ? Math.max(0, toMin(r.endTime) - toMin(r.startTime)) : session;
  const perDay = Math.min(window, session);
  const crew = Math.max(1, crewSize);
  const days = perDay > 0 ? Math.ceil(personMinutes / (perDay * crew)) : Infinity;
  const unrestrictedDays = Math.ceil(personMinutes / (session * crew));
  return { windowMinutes: window, productiveMinutesPerDay: perDay, crewDays: days, extraDaysFromRestriction: Number.isFinite(days) ? days - unrestrictedDays : Infinity,
    shortfallPerDay: Math.max(0, session - perDay), weekdays: r?.allowedWeekdays ?? [1, 2, 3, 4, 5, 6] };
}

export interface Appliance { appliance: string; state: string; brandTechnician: string; exceptionReason: string | null; dependsOn: string | null }

/** Readiness blockers from appliances. An exception keeps the dependency visible as a risk. */
export function applianceBlockers(list: Appliance[]) {
  const out: Array<{ appliance: string; message: string; excepted: boolean }> = [];
  for (const a of list) {
    const problems: string[] = [];
    if (a.state === "selected") problems.push("selected only; specification not final and not on site");
    else if (a.state === "spec_final") problems.push("specification final but not on site");
    if (a.brandTechnician === "needed") problems.push("brand technician needed but not booked");
    if (a.brandTechnician === "unavailable") problems.push("brand technician unavailable");
    if (problems.length) out.push({ appliance: a.appliance, message: `${a.appliance}: ${problems.join("; ")}${a.dependsOn ? ` (affects ${a.dependsOn})` : ""}`, excepted: !!a.exceptionReason });
  }
  return { blockers: out.filter((b) => !b.excepted), risks: out.filter((b) => b.excepted) };
}
