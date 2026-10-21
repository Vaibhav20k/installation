import { describe, expect, it } from "vitest";
import { allocateMinor, formatMoney, lineAmountMinor, varianceSummary } from "@/domain/expenses";
import { aggregateRatios, blockedMinutes, complaintReduction, distinctKitchensCompleted, ftr, misCompleteness, targetVariance, uniqueCostTotal, unloadingSavings, type FtrUnit } from "@/domain/kpi";
import { acceptedCompleted, canCommitScope, remainingQuantity, validateProgressEvent } from "@/domain/progress";
import { toCsv } from "@/lib/csv";

describe("scenario 18: shared accommodation", () => {
  it("2 rooms x 3 nights x INR 1,500 = INR 9,000 once, regardless of employee count", () => {
    const r = lineAmountMinor({ category: "accommodation", basis: "per_room_night", factors: { rooms: 2, nights: 3 }, unitRateMinor: 150000 });
    expect(r.amountMinor).toBe(900000);
    expect(formatMoney(r.amountMinor)).toBe("₹9,000");
  });
  it("per-person-night multiplies people x nights x rate", () => {
    expect(lineAmountMinor({ category: "meal", basis: "per_person_night", factors: { people: 3, nights: 2 }, unitRateMinor: 40000 }).amountMinor).toBe(240000);
  });
});

describe("scenario 19: allocation residuals and N/A variance", () => {
  it("allocations sum exactly to the source including residual minor units", () => {
    const parts = allocateMinor(100001, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100001);
    expect(parts).toEqual([33334, 33334, 33333]);
    expect(allocateMinor(10, [3, 7])).toEqual([3, 7]);
  });
  it("zero or missing budget yields N/A percentage, not 0%", () => {
    expect(varianceSummary({ estimatedTotalMinor: 1000, approvedBudgetMinor: 0, approvedActualMinor: 500 }).budgetVariancePercent).toBeNull();
    expect(varianceSummary({ estimatedTotalMinor: null, approvedBudgetMinor: null, approvedActualMinor: 500 }).budgetVarianceMinor).toBeNull();
    const v = varianceSummary({ estimatedTotalMinor: 800, approvedBudgetMinor: 1000, approvedActualMinor: 1200 });
    expect(v).toEqual({ estimateVarianceMinor: 400, budgetVarianceMinor: 200, remainingBudgetMinor: -200, budgetVariancePercent: 20 });
  });
});

describe("scenarios 10 and 24: remaining scope and reversals", () => {
  it("follow-up defaults to remaining shutters; carcasses only via rework", () => {
    expect(remainingQuantity("6", "6").remaining).toBe("0");
    expect(remainingQuantity("12", "0").remaining).toBe("12");
    expect(remainingQuantity("6", "7").valid).toBe(false);
  });
  it("the same remaining shutters cannot be committed to two visits", () => {
    expect(canCommitScope("12", "0", [], "12").ok).toBe(true);
    expect(canCommitScope("12", "0", ["12"], "12").ok).toBe(false);
    expect(canCommitScope("12", "0", ["8"], "4").ok).toBe(true);
  });
  it("a signed reversal must reference an event and cannot go negative", () => {
    const events = [{ id: "p1", quantityDelta: "4", accepted: true }];
    expect(validateProgressEvent("12", events, { id: "p2", quantityDelta: "-2", accepted: true })).toContain("A negative delta is only allowed as an explicit reversal of an earlier event.");
    expect(validateProgressEvent("12", events, { id: "p2", quantityDelta: "-2", reversesEventId: "p1", accepted: true })).toEqual([]);
    expect(validateProgressEvent("12", events, { id: "p2", quantityDelta: "-5", reversesEventId: "p1", accepted: true }).length).toBeGreaterThan(0);
    expect(validateProgressEvent("12", events, { id: "p2", quantityDelta: "9", accepted: true })[0]).toContain("exceed approved scope");
    expect(acceptedCompleted([...events, { id: "p2", quantityDelta: "-2", reversesEventId: "p1", accepted: true }]).toString()).toBe("2");
  });
});

describe("scenarios 34 and 35: FTR", () => {
  const unit = (i: number, over: Partial<FtrUnit> = {}): FtrUnit => ({ unitId: `U${i}`, completed: true, accepted: true, installationRework: false, unplannedReturn: false, plannedPhased: false, ...over });
  it("without an agreed definition shows evidence and Not rated; planned phases are not failures", () => {
    const r = ftr([unit(1, { plannedPhased: true }), unit(2, { accepted: null })], null);
    expect(r.status).toBe("Not rated");
    expect(r.evidence.plannedPhased).toBe(1);
  });
  it("19 of 20 = 95%; unknown sign-off never counts as accepted; zero denominator = N/A", () => {
    const def = { approved: true, plannedPhaseTreatment: "exclude" as const, grain: "order", window: "30 days" };
    const units = Array.from({ length: 20 }, (_, i) => unit(i, i === 0 ? { installationRework: true } : {}));
    const r = ftr(units, def);
    expect(r.rated && r.ratio.value).toBe(95);
    const withUnknown = ftr([unit(1), unit(2, { accepted: null })], def);
    expect(withUnknown.rated && withUnknown.ratio.value).toBe(50);
    const none = ftr([], def);
    expect(none.rated && none.ratio.value).toBeNull();
  });
  it("aggregates cohorts by summed counts, not by averaging rates", () => {
    expect(aggregateRatios([{ numerator: 1, denominator: 1 }, { numerator: 9, denominator: 19 }]).value).toBe(50);
  });
});

describe("scenarios 37-40: reporting", () => {
  it("one accepted kitchen with six stages counts once; a linked cost counts once", () => {
    expect(distinctKitchensCompleted(Array.from({ length: 6 }, () => ({ orderItemId: "OI-1", productType: "kitchen", accepted: true })))).toBe(1);
    expect(uniqueCostTotal([{ allocationId: "A1", amountMinor: 5000 }, { allocationId: "A1", amountMinor: 5000 }, { allocationId: "A1", amountMinor: 5000 }])).toBe(5000);
  });
  it("provisional targets and missing baselines are Not rated; underspend is not verified savings", () => {
    expect(targetVariance("count", 7, { value: 6, approved: false }, "lower_better").status).toBe("Not rated");
    expect(targetVariance("percent", 96, { value: 95, approved: true }, "higher_better")).toMatchObject({ status: "On target", variance: 1, unit: "percentage points" });
    expect(unloadingSavings({ financeApprovedBaselineMinor: null, verifiedActualMinor: 100, scopeMatched: true }).verified).toBe(false);
    expect(complaintReduction(null, { value: 3, cohort: "x" }).value).toBeNull();
    expect(complaintReduction({ value: 10, approved: true, cohort: "x" }, { value: 6, cohort: "x" }).value).toBe(40);
  });
  it("10 expected, 8 complete, 6 on time -> 80% and 60%; none expected -> N/A", () => {
    const due = 1000;
    const obs = [
      ...Array.from({ length: 6 }, () => ({ complete: true, firstSubmittedAt: 900, dueAt: due })),
      ...Array.from({ length: 2 }, () => ({ complete: true, firstSubmittedAt: 1100, dueAt: due })),
      ...Array.from({ length: 2 }, () => ({ complete: false, firstSubmittedAt: null, dueAt: due })),
    ];
    const r = misCompleteness(obs);
    expect([r.completeness.value, r.timeliness.value, r.missing]).toEqual([80, 60, 2]);
    expect(misCompleteness([]).completeness.value).toBeNull();
  });
  it("simultaneous delay causes do not double blocked time", () => {
    expect(blockedMinutes([{ start: 0, end: 120 * 60000 }, { start: 60 * 60000, end: 180 * 60000 }])).toBe(180);
  });
});

describe("scenario 42: safe CSV", () => {
  it("escapes formula-like text", () => {
    const csv = toCsv(["name", "amount"], [["=HYPERLINK(\"x\")", 5], ["+cmd", -3], ["a,b", null]]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'+cmd");
    expect(csv).toContain(",-3");
    expect(csv).toContain(`"a,b",`);
  });
});
