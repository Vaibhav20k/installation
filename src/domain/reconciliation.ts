/**
 * Monthly-threshold reconciliation (master prompt section 9, "Monthly-threshold policy").
 * Internal approval tracking only: no wage, multiplier, allowance or pay-entitlement logic.
 */
import { datesBetween, monthBounds } from "@/lib/dates";
import { durationMinutes, intersect, localMonthInterval, subtract, takeMinutes, union, type Interval } from "./intervals";
import { netIntervals, scheduledNetMinutes, WORK_ACTIVITIES, type Activity, type CalendarDef } from "./time";

export const CALC_VERSION = "recon-1.0";

export interface ReconPolicy {
  id: string;
  status: "draft" | "approved";
  illustrative: boolean;
  normalBasis: "calendar" | "fixed";
  fixedMonthlyMinutes?: number | null;
  creditedActivities: Activity[];
  catchUpThresholdCredit: "unset" | "include" | "exclude";
  allocationMethod: "unset" | "chronological" | "manager_selected";
  leaveAdjustment: "unset" | "subtract_scheduled_net";
  settlementTimezone: string;
}

export interface ReconEntry {
  id: string;
  projectId: string | null;
  activity: Activity;
  start: number;
  end: number;
  breaks: Interval[];
  /** Intervals verified as original-target catch-up. */
  catchUp: Interval[];
}

export interface OtCandidate {
  requestId: string;
  entryId: string;
  projectId: string | null;
  start: number;
  end: number;
  decision: "requested" | "eligible" | "ineligible" | "pending_policy";
}

export interface ReconInput {
  employeeId: string;
  month: string;
  policy: ReconPolicy | null;
  calendar: CalendarDef;
  /** Accepted, current revisions only. Drafts and replaced revisions never enter final totals. */
  acceptedEntries: ReconEntry[];
  otCandidates: OtCandidate[];
  managerSelection?: string[];
  leaveDates: string[];
  asOf: number;
  completeness: { expectedDays: number; acceptedDays: number; reviewedMissingDays: number };
  unresolvedExceptions: number;
}

export interface Allocation { requestId: string; entryId: string; projectId: string | null; start: number; end: number; minutes: number }

export function computeMonth(input: ReconInput) {
  const blockers: string[] = [];
  const p = input.policy;
  if (!p) blockers.push("No monthly time policy is configured for this month.");
  const tz = p?.settlementTimezone ?? input.calendar.timezone;
  const monthIv = localMonthInterval(input.month, tz);
  const clip = (list: Interval[]) => intersect(list, [monthIv]);

  // Normal requirement N.
  const { first, last } = monthBounds(input.month);
  const monthDates = datesBetween(first, last);
  let N: number | null = null;
  let nExplanation = "";
  if (p) {
    if (p.normalBasis === "calendar") {
      N = scheduledNetMinutes(input.calendar, monthDates);
      nExplanation = "Calendar-derived: sum of scheduled net minutes on working dates.";
    } else if (p.fixedMonthlyMinutes && p.fixedMonthlyMinutes > 0) {
      N = p.fixedMonthlyMinutes;
      nExplanation = "Approved fixed monthly base.";
    } else blockers.push("Fixed monthly basis selected without a fixed value.");
    const leave = [...new Set(input.leaveDates)].filter((d) => monthDates.includes(d));
    if (N !== null && leave.length) {
      if (p.leaveAdjustment === "unset") blockers.push(`${leave.length} leave date(s) in month but no leave-adjustment rule is configured.`);
      else if (p.normalBasis === "calendar") {
        const adj = scheduledNetMinutes(input.calendar, leave);
        N -= adj;
        nExplanation += ` Leave adjustment: -${adj} min for ${leave.length} date(s), each subtracted once.`;
      } else blockers.push("Leave adjustment for a fixed monthly base is not defined.");
    }
  }

  // Qualifying minutes Q.
  const accepted = input.acceptedEntries;
  const credited = p ? p.creditedActivities : [];
  const creditedIv = clip(union(accepted.filter((e) => credited.includes(e.activity)).flatMap(netIntervals)));
  const catchUpIv = clip(union(accepted.flatMap((e) => intersect(e.catchUp, netIntervals(e)))));
  const qIncluded = creditedIv;
  const qExcluded = subtract(creditedIv, catchUpIv);
  const creditMode = p?.catchUpThresholdCredit ?? "unset";
  if (p && creditMode === "unset") blockers.push("Unresolved: whether catch-up hours earn monthly threshold credit. Both variants are shown.");
  const qIv = creditMode === "include" ? qIncluded : qExcluded;
  const Q = durationMinutes(qIv);
  const allAccepted = clip(union(accepted.flatMap(netIntervals)));
  const workIv = clip(union(accepted.filter((e) => WORK_ACTIVITIES.includes(e.activity)).flatMap(netIntervals)));
  const excludedActualMinutes = durationMinutes(allAccepted) - Q;

  // Eligible intervals E: eligible requests on accepted work that also belong to Q.
  const inMonth = input.otCandidates.map((c) => ({ ...c, pieces: intersect(clip([{ start: c.start, end: c.end }]), intersect(workIv, qIv)) }));
  const eligible = inMonth.filter((c) => c.decision === "eligible");
  const E = durationMinutes(union(eligible.flatMap((c) => c.pieces)));
  const X = N === null ? null : Math.max(0, Q - N);
  const B = N === null ? null : Math.max(0, N - Q);
  const cap = X === null ? null : Math.min(X, E);

  const sumDecision = (d: OtCandidate["decision"]) => durationMinutes(union(inMonth.filter((c) => c.decision === d).flatMap((c) => c.pieces)));
  const allocations: Allocation[] = [];
  const method = p?.allocationMethod ?? "unset";
  if (p && method === "unset") blockers.push("No allocation method is selected; candidates remain provisional.");
  if (cap !== null && cap > 0 && method !== "unset") {
    const order = method === "chronological"
      ? [...eligible].sort((a, b) => a.start - b.start || a.entryId.localeCompare(b.entryId) || a.requestId.localeCompare(b.requestId))
      : (input.managerSelection ?? []).map((id) => eligible.find((c) => c.requestId === id)).filter((c): c is (typeof eligible)[number] => !!c);
    if (method === "manager_selected" && order.length === 0) blockers.push("Manager-selected allocation chosen but no intervals are selected.");
    let left = cap;
    let taken: Interval[] = [];
    for (const c of order) {
      if (left <= 0) break;
      const free = subtract(c.pieces, taken);
      const take = takeMinutes(free, left);
      const minutes = durationMinutes(take);
      if (minutes <= 0) continue;
      for (const iv of take) allocations.push({ requestId: c.requestId, entryId: c.entryId, projectId: c.projectId, start: iv.start, end: iv.end, minutes: durationMinutes(iv) });
      taken = union([...taken, ...take]);
      left -= minutes;
    }
  }
  const approvedOT = allocations.reduce((s, a) => s + a.minutes, 0);
  const acceptedWorkMinutes = durationMinutes(workIv);

  // Finalization gates.
  if (p && p.status !== "approved") blockers.push("Policy version is a draft; an authorized owner must approve it.");
  if (input.asOf < monthIv.end) blockers.push("The month has not ended.");
  const { expectedDays, acceptedDays, reviewedMissingDays } = input.completeness;
  if (acceptedDays + reviewedMissingDays < expectedDays) blockers.push(`${expectedDays - acceptedDays - reviewedMissingDays} expected day(s) have no accepted timesheet or reviewed-missing reason.`);
  if (input.unresolvedExceptions > 0) blockers.push(`${input.unresolvedExceptions} unresolved planning exception(s).`);
  const pendingReview = sumDecision("requested") + sumDecision("pending_policy");
  if (pendingReview > 0) blockers.push(`${pendingReview} requested minute(s) still awaiting eligibility review or a policy rule.`);

  const byProject: Record<string, number> = {};
  for (const a of allocations) byProject[a.projectId ?? "overhead"] = (byProject[a.projectId ?? "overhead"] ?? 0) + a.minutes;

  return {
    calcVersion: CALC_VERSION,
    employeeId: input.employeeId,
    month: input.month,
    policyId: p?.id ?? null,
    illustrative: p?.illustrative ?? true,
    settlementTimezone: tz,
    N, nExplanation, Q,
    qIfCatchUpIncluded: durationMinutes(qIncluded),
    qIfCatchUpExcluded: durationMinutes(qExcluded),
    catchUpMinutes: durationMinutes(catchUpIv),
    excludedActualMinutes,
    X, B, E, cap,
    allocations,
    approvedOT,
    normalRequirementCredit: N === null ? null : Math.min(Q, N),
    acceptedWorkMinutes,
    nonOTApprovedWorkMinutes: acceptedWorkMinutes - approvedOT,
    requestedMinutes: durationMinutes(union(inMonth.flatMap((c) => c.pieces))),
    eligibleMinutes: E,
    ineligibleMinutes: sumDecision("ineligible"),
    pendingMinutes: pendingReview,
    byProject,
    blockers,
    canFinalize: blockers.length === 0,
  };
}

export type MonthResult = ReturnType<typeof computeMonth>;
