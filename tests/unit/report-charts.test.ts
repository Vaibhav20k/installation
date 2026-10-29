import { describe, expect, it } from "vitest";
import { countBy, donutArcs, fmt, kpiEvidence, labelOf, lastMonths, misSplit, monthLabel, niceMax, pct, sumBy, ticks, toNumber } from "@/components/reports/charts/scale";

describe("axis scale", () => {
  it("rounds maxima up to 1, 2, 2.5, 5 × 10^k", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-3)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(1.3)).toBe(2);
    expect(niceMax(2.2)).toBe(2.5);
    expect(niceMax(17)).toBe(20);
    expect(niceMax(26)).toBe(50);
    expect(niceMax(0.07)).toBe(0.1);
    expect(niceMax(280000)).toBe(500000);
  });
  it("produces evenly spaced ticks from zero to the nice max", () => {
    expect(ticks(17)).toEqual([0, 5, 10, 15, 20]);
    expect(ticks(0)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it("clamps percentages and guards a zero max", () => {
    expect(pct(5, 20)).toBe(25);
    expect(pct(30, 20)).toBe(100);
    expect(pct(-1, 20)).toBe(0);
    expect(pct(3, 0)).toBe(0);
  });
});

describe("donut arcs", () => {
  it("splits pathLength 100 by share and rotates each arc to its start from 12 o'clock", () => {
    const a = donutArcs([{ label: "a", value: 1 }, { label: "b", value: 3 }]);
    expect(a.map((x) => [x.start, x.length, x.rotate])).toEqual([[0, 25, -90], [25, 75, 0]]);
    expect(a.reduce((s, x) => s + x.share, 0)).toBeCloseTo(100);
  });
  it("drops zero and negative values and returns nothing for an empty total", () => {
    expect(donutArcs([{ label: "a", value: 0 }, { label: "b", value: -2 }])).toEqual([]);
    expect(donutArcs([{ label: "a", value: 0 }, { label: "b", value: 4 }]).map((x) => x.label)).toEqual(["b"]);
  });
  it("applies the gap only between several segments", () => {
    expect(donutArcs([{ label: "solo", value: 5 }], 2)[0]!.length).toBe(100);
    const two = donutArcs([{ label: "a", value: 1 }, { label: "b", value: 1 }], 2);
    expect(two.map((x) => x.length)).toEqual([48, 48]);
    expect(two[1]!.start).toBe(50);
  });
});

describe("aggregation", () => {
  const rows = [{ s: "open", f: "Logistics", d: 3 }, { s: "closed", f: "Factory", d: "2" }, { s: "open", f: "Logistics", d: null }, { s: "", f: null, d: 1 }];
  it("counts by key, folding blanks, sorted by count then label", () => {
    expect(countBy(rows, "s")).toEqual([{ label: "open", value: 2 }, { label: "closed", value: 1 }, { label: "Not recorded", value: 1 }]);
  });
  it("sums numeric and numeric-string values by key", () => {
    expect(sumBy(rows, "f", "d")).toEqual([{ label: "Logistics", value: 3 }, { label: "Factory", value: 2 }, { label: "Not recorded", value: 1 }]);
  });
  it("reads DB numbers safely", () => {
    expect(toNumber("280000")).toBe(280000);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("N/A")).toBe(0);
    expect(toNumber("")).toBe(0);
  });
});

describe("months and labels", () => {
  it("lists the n months ending with a month, across a year boundary", () => {
    expect(lastMonths("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(lastMonths("2026-10", 1)).toEqual(["2026-10"]);
  });
  it("names months and humanises codes", () => {
    expect(monthLabel("2026-10")).toBe("Oct");
    expect(labelOf("partly_dispatched")).toBe("Partly dispatched");
    expect(fmt(3)).toBe("3");
    expect(fmt(2.345)).toBe("2.3");
  });
});

describe("KRA helpers", () => {
  it("splits MIS completeness into counts that sum to the expected total", () => {
    expect(misSplit("50% complete, 33.33% on time", "18 expected employee-day timesheets (due end of next day)")).toEqual({ total: 18, onTime: 6, late: 3, missing: 9 });
    expect(misSplit("N/A", "0 expected employee-day timesheets")).toBeNull();
    expect(misSplit("100% complete, 100% on time", "0 expected")).toBeNull();
  });
  it("classifies whether an actual was computed", () => {
    expect(kpiEvidence("1 unplanned")).toBe("measured");
    expect(kpiEvidence("N/A")).toBe("no_data");
    expect(kpiEvidence("Not rated")).toBe("no_data");
    expect(kpiEvidence("See tracker")).toBe("elsewhere");
  });
});
