/**
 * Time recording interval rules and overtime eligibility (master prompt section 9).
 * Actual time is never deleted or reduced by an eligibility decision.
 */
import { datesBetween, weekday, zonedToUtc, addDays } from "@/lib/dates";
import { contains, durationMinutes, findOverlaps, intersect, subtract, union, type Interval } from "./intervals";

export type Activity = "installation" | "additional" | "rework" | "travel" | "waiting" | "other";
export const WORK_ACTIVITIES: Activity[] = ["installation", "additional", "rework"];

export interface TimeEntryInput { id: string; activity: Activity; start: number; end: number; breaks: Interval[] }

export interface Shift { start: string; end: string }
export interface WeekPattern { [weekday: number]: { shifts: Shift[]; netMinutes: number } | undefined }
export interface CalendarDef { timezone: string; pattern: WeekPattern; holidays: string[] }

export function validateEntry(e: TimeEntryInput): string[] {
  const errors: string[] = [];
  if (!(e.end > e.start)) errors.push("End must be after start (use the next date for overnight work).");
  for (const b of e.breaks) {
    if (!(b.end > b.start)) errors.push("A break ends before it starts.");
    else if (!contains({ start: e.start, end: e.end }, b)) errors.push("Breaks must lie inside the entry.");
  }
  if (findOverlaps(e.breaks).length) errors.push("Breaks overlap each other.");
  return errors;
}

/** Entry interval minus the union of its breaks. Breaks are counted once. */
export function netIntervals(e: TimeEntryInput): Interval[] {
  return subtract([{ start: e.start, end: e.end }], e.breaks);
}

export function netEntryMinutes(e: TimeEntryInput): number {
  return durationMinutes(netIntervals(e));
}

/** Overlap check across an employee's entries; adjacent entries are valid. */
export function entryOverlaps(entries: Array<{ id: string; start: number; end: number }>) {
  return findOverlaps(entries).map(([a, b]) => ({ a: a.id, b: b.id }));
}

/** Normal working intervals S for a date range in the calendar's timezone. */
export function scheduleIntervals(cal: CalendarDef, from: string, to: string): Interval[] {
  const out: Interval[] = [];
  for (const d of datesBetween(from, to)) {
    if (cal.holidays.includes(d)) continue;
    const day = cal.pattern[weekday(d)];
    if (!day) continue;
    for (const s of day.shifts) {
      const start = zonedToUtc(d, s.start, cal.timezone);
      const endDate = s.end <= s.start ? addDays(d, 1) : d;
      out.push({ start, end: zonedToUtc(endDate, s.end, cal.timezone) });
    }
  }
  return union(out);
}

/** Calendar-derived normal requirement: sum of configured net minutes on working dates. */
export function scheduledNetMinutes(cal: CalendarDef, dates: string[]): number {
  let total = 0;
  for (const d of dates) {
    if (cal.holidays.includes(d)) continue;
    total += cal.pattern[weekday(d)]?.netMinutes ?? 0;
  }
  return total;
}

export function workMetrics(entries: TimeEntryInput[], schedule: Interval[]) {
  const work = union(entries.filter((e) => WORK_ACTIVITIES.includes(e.activity)).flatMap(netIntervals));
  const logged = union(entries.flatMap(netIntervals));
  const within = intersect(work, schedule);
  const outside = subtract(work, schedule);
  return {
    actualWorkMinutes: durationMinutes(work),
    withinScheduleMinutes: durationMinutes(within),
    outsideScheduleMinutes: durationMinutes(outside),
    actualLoggedMinutes: durationMinutes(logged),
    outsideIntervals: outside,
  };
}

/** Reasons a reviewer can verify for time beyond the schedule. */
export type ExtraTimeReason =
  | "original_target_catch_up"
  | "authorized_additional_scope"
  | "external_delay"
  | "other_documented";

export const REASON_LABEL: Record<ExtraTimeReason, string> = {
  original_target_catch_up: "Finishing the original assigned target (catch-up)",
  authorized_additional_scope: "Approved additional scope",
  external_delay: "Delay caused by materials, site, equipment or another function",
  other_documented: "Other documented cause",
};

export interface EligibilityPolicy {
  candidateRule: "outside_schedule_only" | "authorized_any";
  externalDelayEligibility: "unset" | "eligible" | "ineligible";
  otherDocumentedEligibility: "unset" | "eligible" | "ineligible";
}

export interface EligibilityInput {
  verifiedReason: ExtraTimeReason;
  activity: Activity;
  /** Interval is entirely outside the normal schedule. */
  outsideSchedule: boolean;
  /** Approved additional-scope reference dated on or before the work. */
  authorizationRef?: string | null;
}

export type EligibilityDecision = { status: "eligible" | "ineligible" | "pending_policy"; code: string; explanation: string };

/**
 * The confirmed business rule: extra time solely to finish the original assigned target is ineligible
 * for internal overtime. There is no override parameter; a reviewer can only correct the verified reason.
 */
export function decideEligibility(input: EligibilityInput, policy: EligibilityPolicy): EligibilityDecision {
  if (!WORK_ACTIVITIES.includes(input.activity)) {
    return { status: "ineligible", code: "not_work", explanation: "Travel, waiting and other activity are not reclassified as overtime work." };
  }
  if (input.verifiedReason === "original_target_catch_up") {
    return { status: "ineligible", code: "catch_up_excluded", explanation: "Verified as catch-up on the original assigned target; ineligible for internal overtime under the confirmed rule. Actual time is kept." };
  }
  if (policy.candidateRule === "outside_schedule_only" && !input.outsideSchedule) {
    return { status: "ineligible", code: "inside_schedule", explanation: "Policy restricts candidates to work outside the normal schedule." };
  }
  if (input.verifiedReason === "authorized_additional_scope") {
    if (!input.authorizationRef) return { status: "ineligible", code: "no_authorization", explanation: "Additional scope needs a dated approval reference; extra output alone is not proof." };
    return { status: "eligible", code: "authorized_scope", explanation: `Authorized additional scope (${input.authorizationRef}).` };
  }
  const setting = input.verifiedReason === "external_delay" ? policy.externalDelayEligibility : policy.otherDocumentedEligibility;
  if (setting === "unset") return { status: "pending_policy", code: "rule_unset", explanation: "No approved eligibility rule exists yet for this cause." };
  return setting === "eligible"
    ? { status: "eligible", code: "policy_eligible", explanation: "Eligible under the configured rule for this cause." }
    : { status: "ineligible", code: "policy_ineligible", explanation: "Ineligible under the configured rule for this cause." };
}
