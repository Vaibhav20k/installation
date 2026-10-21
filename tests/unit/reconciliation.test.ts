import { describe, expect, it } from "vitest";
import { computeMonth, type ReconEntry, type ReconInput, type ReconPolicy, type OtCandidate } from "@/domain/reconciliation";
import { zonedToUtc } from "@/lib/dates";
import type { CalendarDef } from "@/domain/time";

const TZ = "Asia/Kolkata";
const at = (d: string, t: string) => zonedToUtc(d, t, TZ);
const cal: CalendarDef = { timezone: TZ, holidays: [], pattern: { 1: { shifts: [{ start: "10:00", end: "19:00" }], netMinutes: 480 } } };
const policy: ReconPolicy = {
  id: "POL-ILL", status: "approved", illustrative: true, normalBasis: "fixed", fixedMonthlyMinutes: 12000,
  creditedActivities: ["installation", "additional", "rework", "travel"], catchUpThresholdCredit: "exclude",
  allocationMethod: "chronological", leaveAdjustment: "unset", settlementTimezone: TZ,
};

/** Builds accepted entries summing to `minutes`, as whole-day blocks of 10h from 1 Nov 2026. */
function entries(minutes: number, projectIds = ["P1"]): ReconEntry[] {
  const out: ReconEntry[] = [];
  let left = minutes, day = 1, i = 0;
  while (left > 0) {
    const len = Math.min(600, left);
    const d = `2026-11-${String(day).padStart(2, "0")}`;
    out.push({ id: `T${String(i).padStart(3, "0")}`, projectId: projectIds[i % projectIds.length]!, activity: "installation", start: at(d, "08:00"), end: at(d, "08:00") + len * 60000, breaks: [], catchUp: [] });
    left -= len; day++; i++;
  }
  return out;
}
const eligibleOn = (e: ReconEntry, minutes: number, id: string): OtCandidate => ({ requestId: id, entryId: e.id, projectId: e.projectId, start: e.end - minutes * 60000, end: e.end, decision: "eligible" });
const base = (over: Partial<ReconInput>): ReconInput => ({
  employeeId: "E1", month: "2026-11", policy, calendar: cal, acceptedEntries: [], otCandidates: [], leaveDates: [],
  asOf: at("2026-12-02", "10:00"), completeness: { expectedDays: 0, acceptedDays: 0, reviewedMissingDays: 0 }, unresolvedExceptions: 0, ...over,
});

describe("scenarios 14 and 15: monthly cap", () => {
  it("N=12000, Q=11400, E=1200 -> X=0 and cap=0; actual hours unchanged", () => {
    const es = entries(11400);
    const cands = es.slice(0, 2).map((e, i) => eligibleOn(e, 600, `R${i}`));
    const r = computeMonth(base({ acceptedEntries: es, otCandidates: cands }));
    expect([r.N, r.Q, r.E, r.X, r.cap]).toEqual([12000, 11400, 1200, 0, 0]);
    expect(r.B).toBe(600);
    expect(r.approvedOT).toBe(0);
    expect(r.acceptedWorkMinutes).toBe(11400);
  });
  it("N=12000, Q=12600, E=900 -> X=600 and cap=600, allocated chronologically", () => {
    const es = entries(12600);
    const cands = [eligibleOn(es[0]!, 600, "R0"), eligibleOn(es[1]!, 300, "R1")];
    const r = computeMonth(base({ acceptedEntries: es, otCandidates: cands }));
    expect([r.X, r.E, r.cap, r.approvedOT]).toEqual([600, 900, 600, 600]);
    expect(r.allocations.map((a) => [a.requestId, a.minutes])).toEqual([["R0", 600]]);
    expect(r.canFinalize).toBe(true);
    expect(r.acceptedWorkMinutes).toBe(12600); // actual work is never forced to N + OT
  });
});

describe("scenario 16 and 32: unset policy fields block finalization", () => {
  it("no policy -> provisional and blocked", () => {
    const r = computeMonth(base({ policy: null, acceptedEntries: entries(600) }));
    expect(r.canFinalize).toBe(false);
    expect(r.blockers[0]).toContain("No monthly time policy");
  });
  it("no allocation method -> no allocations, blocked", () => {
    const es = entries(12600);
    const r = computeMonth(base({ policy: { ...policy, allocationMethod: "unset" }, acceptedEntries: es, otCandidates: [eligibleOn(es[0]!, 600, "R0")] }));
    expect(r.allocations).toEqual([]);
    expect(r.cap).toBe(600);
    expect(r.canFinalize).toBe(false);
  });
  it("catch-up threshold credit unset blocks; both explicit choices work without making catch-up eligible", () => {
    const es = entries(12600);
    es[0]!.catchUp = [{ start: es[0]!.end - 120 * 60000, end: es[0]!.end }];
    const cands = [eligibleOn(es[1]!, 600, "R1")];
    const unset = computeMonth(base({ policy: { ...policy, catchUpThresholdCredit: "unset" }, acceptedEntries: es, otCandidates: cands }));
    expect(unset.canFinalize).toBe(false);
    expect([unset.qIfCatchUpIncluded, unset.qIfCatchUpExcluded]).toEqual([12600, 12480]);
    const inc = computeMonth(base({ policy: { ...policy, catchUpThresholdCredit: "include" }, acceptedEntries: es, otCandidates: cands }));
    const exc = computeMonth(base({ policy: { ...policy, catchUpThresholdCredit: "exclude" }, acceptedEntries: es, otCandidates: cands }));
    expect([inc.X, inc.cap]).toEqual([600, 600]);
    expect([exc.X, exc.cap]).toEqual([480, 480]);
    for (const r of [inc, exc]) expect(r.allocations.every((a) => a.entryId !== es[0]!.id)).toBe(true);
    expect(inc.catchUpMinutes).toBe(120);
  });
});

describe("scenario 33: partial cap allocation", () => {
  it("cap of 90 allocates 60 from the first interval and 30 from the second", () => {
    const es = entries(12090);
    const cands = [eligibleOn(es[1]!, 60, "R-B"), eligibleOn(es[0]!, 60, "R-A")];
    const r = computeMonth(base({ acceptedEntries: es, otCandidates: cands }));
    expect(r.cap).toBe(90);
    expect(r.allocations.map((a) => [a.requestId, a.minutes])).toEqual([["R-A", 60], ["R-B", 30]]);
  });
  it("overlapping requests never allocate the same minutes twice", () => {
    const es = entries(13000);
    const c1 = eligibleOn(es[0]!, 120, "R1");
    const c2 = { ...eligibleOn(es[0]!, 120, "R2") };
    const r = computeMonth(base({ acceptedEntries: es, otCandidates: [c1, c2] }));
    expect(r.E).toBe(120);
    expect(r.approvedOT).toBe(120);
  });
});

describe("scenario 31: cross-project and cross-month", () => {
  it("calculates the threshold once and project allocations sum to the total", () => {
    const es = entries(12600, ["P1", "P2", "P3"]);
    const cands = es.slice(0, 3).map((e, i) => eligibleOn(e, 300, `R${i}`));
    const r = computeMonth(base({ acceptedEntries: es, otCandidates: cands }));
    expect(r.approvedOT).toBe(600);
    expect(Object.values(r.byProject).reduce((a, b) => a + b, 0)).toBe(r.approvedOT);
    expect(Object.keys(r.byProject).sort()).toEqual(["P1", "P2"]);
  });
  it("cross-month entries are split in the settlement timezone without loss or duplication", () => {
    const e: ReconEntry = { id: "X", projectId: "P1", activity: "travel", start: at("2026-10-31", "22:00"), end: at("2026-11-01", "03:00"), breaks: [], catchUp: [] };
    const oct = computeMonth(base({ month: "2026-10", acceptedEntries: [e] }));
    const nov = computeMonth(base({ month: "2026-11", acceptedEntries: [e] }));
    expect(oct.Q + nov.Q).toBe(300);
    expect([oct.Q, nov.Q]).toEqual([120, 180]);
  });
});

describe("finalization gates", () => {
  it("blocks before month end, with missing submissions or pending reviews", () => {
    const es = entries(600);
    const r = computeMonth(base({ acceptedEntries: es, asOf: at("2026-11-20", "10:00"), completeness: { expectedDays: 5, acceptedDays: 3, reviewedMissingDays: 1 }, otCandidates: [{ ...eligibleOn(es[0]!, 60, "R"), decision: "requested" }] }));
    expect(r.blockers.join(" ")).toMatch(/has not ended/);
    expect(r.blockers.join(" ")).toMatch(/1 expected day/);
    expect(r.blockers.join(" ")).toMatch(/awaiting eligibility review/);
  });
  it("calendar basis with leave requires a configured rule and subtracts once", () => {
    const leave = ["2026-11-02", "2026-11-02"];
    const pol = { ...policy, normalBasis: "calendar" as const, fixedMonthlyMinutes: null };
    const unset = computeMonth(base({ policy: pol, leaveDates: leave }));
    expect(unset.N).toBe(5 * 480); // five Mondays in Nov 2026
    expect(unset.canFinalize).toBe(false);
    const set = computeMonth(base({ policy: { ...pol, leaveAdjustment: "subtract_scheduled_net" }, leaveDates: leave }));
    expect(set.N).toBe(4 * 480);
  });
});
