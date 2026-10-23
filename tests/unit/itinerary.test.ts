import { describe, expect, it } from "vitest";
import { itineraryProblems, legReachability } from "@/domain/scheduling";
import { layoutSchedule } from "@/domain/install-schedule";

// Dates and times are isolated illustrative fixtures (spec §14), not approved schedules.
const TZ = "Asia/Kolkata";
const at = (s: string) => Date.parse(`${s}+05:30`);

describe("itinerary order (checklist phase 6)", () => {
  it("accepts departure on or before the start and return on or after the end", () => {
    expect(itineraryProblems({ plannedStart: "2026-11-02", plannedEnd: "2026-11-06", departureAt: at("2026-11-01T18:00:00"), returnAt: at("2026-11-07T10:00:00"), tz: TZ })).toEqual([]);
    expect(itineraryProblems({ plannedStart: "2026-11-02", plannedEnd: "2026-11-06", tz: TZ })).toEqual([]);
  });
  it("names each out-of-order part", () => {
    const p = itineraryProblems({ plannedStart: "2026-11-02", plannedEnd: "2026-11-06", departureAt: at("2026-11-03T08:00:00"), returnAt: at("2026-11-05T10:00:00"), tz: TZ });
    expect(p).toHaveLength(2);
    expect(p[0]).toContain("after the planned installation start");
    expect(p[1]).toContain("before the planned installation end");
    expect(itineraryProblems({ plannedStart: "2026-11-02", plannedEnd: "2026-11-02", departureAt: at("2026-11-02T08:00:00"), returnAt: at("2026-11-02T08:00:00"), tz: TZ })).toContain("Return must be after departure.");
  });
  it("uses the site's local date, not UTC (an 01:00 IST arrival is still that date)", () => {
    expect(legReachability("outbound", at("2026-11-01T20:00:00"), at("2026-11-02T01:00:00"), "2026-11-02", "2026-11-06", TZ)).toBeNull();
  });
});

describe("leg reachability", () => {
  it("an outbound leg arriving after the start date cannot reach the site in time", () => {
    expect(legReachability("outbound", at("2026-11-02T20:00:00"), at("2026-11-03T06:00:00"), "2026-11-02", "2026-11-06", TZ)).toContain("arrives on 2026-11-03");
  });
  it("a return leg leaving before the last work day is refused; inter-site legs and undated visits are not judged here", () => {
    expect(legReachability("return", at("2026-11-05T18:00:00"), at("2026-11-06T06:00:00"), "2026-11-02", "2026-11-06", TZ)).toContain("before the planned installation end");
    expect(legReachability("return", at("2026-11-06T18:00:00"), at("2026-11-07T06:00:00"), "2026-11-02", "2026-11-06", TZ)).toBeNull();
    expect(legReachability("inter_site", at("2026-11-09T08:00:00"), at("2026-11-09T12:00:00"), "2026-11-02", "2026-11-06", TZ)).toBeNull();
    expect(legReachability("outbound", at("2026-11-09T08:00:00"), at("2026-11-09T12:00:00"), null, null, TZ)).toBeNull();
  });
});

describe("site working days in the installation schedule (checklist phase 5)", () => {
  const steps = [{ name: "Carcass", days: 3 }];
  it("a site closed on Saturdays pushes work past it and shows why", () => {
    // 2026-11-06 is a Friday; the company works Mon–Sat, the society allows Mon–Fri only.
    const days = layoutSchedule(steps, "2026-11-05", [1, 2, 3, 4, 5, 6], {}, [1, 2, 3, 4, 5]);
    expect(days.map((d) => [d.date, d.kind, d.offReason])).toEqual([
      ["2026-11-05", "work", null], ["2026-11-06", "work", null], ["2026-11-07", "off", "Site closed (site rule)"], ["2026-11-08", "off", "Weekly off"], ["2026-11-09", "work", null],
    ]);
  });
  it("without a recorded site window the company calendar alone applies", () => {
    expect(layoutSchedule(steps, "2026-11-05", [1, 2, 3, 4, 5, 6], {}).filter((d) => d.kind === "work").map((d) => d.date)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07"]);
  });
});
