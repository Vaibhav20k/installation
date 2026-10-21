/**
 * KRA metric contract (master prompt section 11, "KRA reporting reference and metric contract").
 * Zero denominators and missing evidence yield N/A with a reason, never 0% or a green status.
 */
import { durationMinutes, union, type Interval } from "./intervals";
import { dayDiff } from "@/lib/dates";

export type Ratio = { value: number | null; numerator: number; denominator: number; reason?: string };

export function ratioPercent(numerator: number, denominator: number, missingReason = "Denominator is zero"): Ratio {
  if (!(denominator > 0)) return { value: null, numerator, denominator, reason: missingReason };
  return { value: Math.round((numerator / denominator) * 10000) / 100, numerator, denominator };
}

/** Aggregate cohorts by summing counts, never by averaging rates. */
export function aggregateRatios(parts: Array<{ numerator: number; denominator: number }>): Ratio {
  return ratioPercent(parts.reduce((s, p) => s + p.numerator, 0), parts.reduce((s, p) => s + p.denominator, 0));
}

export interface FtrUnit {
  unitId: string;
  completed: boolean;
  /** Customer acceptance: true, false or unknown (null). Unknown never counts as accepted. */
  accepted: boolean | null;
  installationRework: boolean;
  unplannedReturn: boolean;
  plannedPhased: boolean;
}

export interface FtrDefinition { approved: boolean; plannedPhaseTreatment: "include" | "exclude" | null; grain: string | null; window: string | null }

export function ftr(units: FtrUnit[], def: FtrDefinition | null) {
  const literalFirstVisit = units.filter((u) => u.completed && !u.plannedPhased && !u.unplannedReturn).length;
  const evidence = {
    completed: units.filter((u) => u.completed).length,
    acceptedKnown: units.filter((u) => u.accepted === true).length,
    acceptanceUnknown: units.filter((u) => u.accepted === null).length,
    plannedPhased: units.filter((u) => u.plannedPhased).length,
    unplannedReturns: units.filter((u) => u.unplannedReturn).length,
    literalFirstVisitCompletions: literalFirstVisit,
  };
  if (!def || !def.approved || !def.plannedPhaseTreatment || !def.grain || !def.window) {
    return { rated: false as const, status: "Not rated", reason: "No agreed FTR definition, grain, planned-phase treatment and window.", evidence };
  }
  const eligible = units.filter((u) => u.completed && (def.plannedPhaseTreatment === "include" || !u.plannedPhased));
  const pendingAcceptance = eligible.filter((u) => u.accepted === null).length;
  const success = eligible.filter((u) => u.accepted === true && !u.installationRework && !u.unplannedReturn).length;
  return { rated: true as const, status: "Rated", ratio: ratioPercent(success, eligible.length, "No eligible completed scope units"), pendingAcceptance, evidence };
}

/** (baseline - current) / baseline * 100, only with a positive valid baseline and matched cohort. */
export function complaintReduction(baseline: { value: number; approved: boolean; cohort: string } | null, current: { value: number; cohort: string }): Ratio {
  if (!baseline || !baseline.approved) return { value: null, numerator: 0, denominator: 0, reason: "No agreed baseline" };
  if (baseline.cohort !== current.cohort) return { value: null, numerator: 0, denominator: 0, reason: "Baseline and current cohorts do not match" };
  return ratioPercent(baseline.value - current.value, baseline.value, "Baseline must be positive");
}

export function misCompleteness(obligations: Array<{ complete: boolean; firstSubmittedAt: number | null; dueAt: number }>) {
  const expected = obligations.length;
  const complete = obligations.filter((o) => o.complete).length;
  const onTime = obligations.filter((o) => o.complete && o.firstSubmittedAt !== null && o.firstSubmittedAt <= o.dueAt).length;
  return {
    completeness: ratioPercent(complete, expected, "No expected obligations"),
    timeliness: ratioPercent(onTime, expected, "No expected obligations"),
    missing: expected - obligations.filter((o) => o.firstSubmittedAt !== null).length,
  };
}

/** Union of simultaneous cause intervals so overlapping causes are not counted twice. */
export function blockedMinutes(delays: Interval[]): number {
  return durationMinutes(union(delays));
}

export function targetVariance(kind: "percent" | "amount" | "count", actual: number | null, target: { value: number | null; approved: boolean } | null, direction: "higher_better" | "lower_better") {
  if (actual === null) return { rated: false, status: "Not rated", reason: "No actual value (missing evidence)" };
  if (!target || !target.approved || target.value === null) return { rated: false, status: "Not rated", reason: "No approved target" };
  const variance = actual - target.value;
  const favorable = direction === "higher_better" ? variance >= 0 : variance <= 0;
  return { rated: true, status: favorable ? "On target" : "Off target", variance, unit: kind === "percent" ? "percentage points" : kind };
}

export function unloadingSavings(input: { financeApprovedBaselineMinor: number | null; verifiedActualMinor: number | null; scopeMatched: boolean }) {
  if (input.financeApprovedBaselineMinor === null) return { verified: false, savingsMinor: null, reason: "No Finance-approved comparable baseline" };
  if (input.verifiedActualMinor === null) return { verified: false, savingsMinor: null, reason: "Actual unloading cost not verified" };
  if (!input.scopeMatched) return { verified: false, savingsMinor: null, reason: "Load/volume/location/period scope does not match the baseline" };
  return { verified: true, savingsMinor: input.financeApprovedBaselineMinor - input.verifiedActualMinor };
}

/** Distinct kitchens: completed order items of type kitchen counted once, never per stage or visit. */
export function distinctKitchensCompleted(items: Array<{ orderItemId: string; productType: string; accepted: boolean }>): number {
  return new Set(items.filter((i) => i.productType === "kitchen" && i.accepted).map((i) => i.orderItemId)).size;
}

/** Sum each cost allocation once, however many views it is linked to. */
export function uniqueCostTotal(links: Array<{ allocationId: string; amountMinor: number }>): number {
  const seen = new Map<string, number>();
  for (const l of links) seen.set(l.allocationId, l.amountMinor);
  return [...seen.values()].reduce((a, b) => a + b, 0);
}

/** Inclusive calendar-day duration, or as-of elapsed when not finished. */
export function installationDays(start: string | null, finish: string | null, asOf: string) {
  if (!start) return { days: null as number | null, final: false };
  if (!finish) return { days: dayDiff(start, asOf) + 1, final: false };
  return { days: dayDiff(start, finish) + 1, final: true };
}

export function productivity(acceptedOutput: string | null, personWorkMinutes: number, quantityKind: string, expectedKind: string) {
  if (quantityKind !== expectedKind) return { value: null, reason: `Output kind ${quantityKind} is not comparable with ${expectedKind}` };
  if (acceptedOutput === null) return { value: null, reason: "No accepted output" };
  if (!(personWorkMinutes > 0)) return { value: null, reason: "No accepted person work hours" };
  return { value: Math.round((Number(acceptedOutput) / (personWorkMinutes / 60)) * 1000) / 1000 };
}
