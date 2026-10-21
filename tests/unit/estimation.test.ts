import { describe, expect, it } from "vitest";
import { estimateFromRate, estimateFromRoleTemplate, scheduleEffortAcrossDays, type ProductivityRate } from "@/domain/effort";
import { allocationSummary, assignedDateCount, elapsedCalendarDays } from "@/domain/assignment-metrics";
import { deriveScheduleStart, hotelNights } from "@/domain/scheduling";
import { Dec } from "@/domain/decimal";

const teamDayRate: ProductivityRate = {
  id: "RATE-ILL-1", activity: "install", quantityKind: "cabinet_surface_area", unit: "sqft",
  basis: "team_day", value: "40", crewSize: 3, netDayMinutes: 480, status: "illustrative", version: 1,
};

describe("decimal arithmetic", () => {
  it("never uses binary floating point for quantities", () => {
    expect(Dec.of("0.1").add("0.2").toString()).toBe("0.3");
    expect(Dec.of("10").div("3").toString()).toBe("3.333333");
    expect(() => Dec.of("1").div("0")).toThrow();
  });
});

describe("scenario 5: team-days vs person-days", () => {
  it("320 sq ft at 40 sq ft/team-day = 8 team-days = 24 person-days for 3 full-time people", () => {
    const r = estimateFromRate({ value: "320", unit: "sqft", quantityKind: "cabinet_surface_area" }, teamDayRate);
    expect(r.ok).toBe(true);
    expect(r.teamDays).toBe("8");
    expect(r.personDays).toBe("24");
    expect(r.personDays).not.toBe("8");
    expect(r.personMinutes).toBe(String(24 * 480));
    expect(r.provisional).toBe(true); // illustrative rate cannot masquerade as approved
  });

  it("partial attendance does not derive person-days from team-days", () => {
    const r = estimateFromRate({ value: "320", unit: "sqft", quantityKind: "cabinet_surface_area" }, teamDayRate, { fullCrewAttendance: false });
    expect(r.teamDays).toBe("8");
    expect(r.personDays).toBeUndefined();
  });

  it("missing or zero rate is a validation issue, not infinity", () => {
    const r = estimateFromRate({ value: "320", unit: "sqft", quantityKind: "cabinet_surface_area" }, { ...teamDayRate, value: "0" });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("missing_rate");
  });
});

describe("scenario 36: quantity kinds", () => {
  it("rejects kitchen floor area as input to a cabinet-surface rate despite shared sq ft unit", () => {
    const r = estimateFromRate({ value: "600", unit: "sqft", quantityKind: "kitchen_floor_area" }, teamDayRate);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.code).toBe("quantity_kind_mismatch");
  });
});

describe("scenario 23: rate-day hours vs employee calendar", () => {
  it("an 8-hour rate-day is 8 estimated hours; a 6-hour calendar needs more days, not less effort", () => {
    const rate: ProductivityRate = { ...teamDayRate, basis: "employee_day", value: "10", crewSize: null, netDayMinutes: 480 };
    const r = estimateFromRate({ value: "10", unit: "sqft", quantityKind: "cabinet_surface_area" }, rate);
    expect(r.personMinutes).toBe("480");
    const s = scheduleEffortAcrossDays(r.personMinutes!, [{ date: "2026-10-26", minutes: 360 }, { date: "2026-10-27", minutes: 360 }]);
    expect(s.estimatedMinutes).toBe("480");
    expect(s.days).toEqual([{ date: "2026-10-26", minutes: 360 }, { date: "2026-10-27", minutes: 120 }]);
    expect(s.fits).toBe(true);
  });
});

describe("role templates", () => {
  it("computes per-role hours and flags missing values", () => {
    const r = estimateFromRoleTemplate("12", [
      { role: "senior_technician", hoursPerUnit: "0.5", status: "illustrative" },
      { role: "helper", fixedHours: "4", status: "illustrative" },
      { role: "carpenter", status: "illustrative" },
    ]);
    expect(r.roles.map((x) => x.hours)).toEqual(["6", "4"]);
    expect(r.totalMinutes).toBe("600");
    expect(r.ok).toBe(false);
  });
});

describe("scenario 6: assignment dates", () => {
  const work = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11"];
  it("8 workdays + 2 separate travel days = 10 assigned dates; weekend gap extends elapsed days only", () => {
    const a = { workDates: work, travelDates: ["2026-11-01", "2026-11-12"] };
    expect(assignedDateCount(a)).toBe(10);
    expect(elapsedCalendarDays(a)).toBe(12);
  });
  it("travel and work on the same date are not doubled", () => {
    expect(assignedDateCount({ workDates: work, travelDates: ["2026-11-02", "2026-11-11"] })).toBe(8);
  });
  it("3 employees x (8 work + 2 travel) = 30 person-assignment dates, 24 work person-days, 6 travel allocations", () => {
    const consecutive = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"];
    const emp = (id: string) => ({ employeeId: id, workDates: consecutive, travelDates: ["2026-11-01", "2026-11-10"], workMinutes: 8 * 480, travelMinutes: 2 * 300 });
    const s = allocationSummary([emp("a"), emp("b"), emp("c")], 480);
    expect(s.personAssignmentDates).toBe(30);
    expect(s.workPersonDays).toBe("24");
    expect(s.travelAllocations).toBe(6);
    expect(s.perEmployee[0]!.elapsedCalendarDays).toBe(10);
  });
  it("empty assignment has 0 elapsed days", () => {
    expect(elapsedCalendarDays({ workDates: [], travelDates: [] })).toBe(0);
  });
});

describe("schedule start", () => {
  const base = { workingWeekdays: [1, 2, 3, 4, 5, 6], mode: "firm" as const };
  it("takes the maximum of all drivers and moves to a working day", () => {
    const r = deriveScheduleStart({ ...base, requestedInstallationStart: "2026-10-24", materialAvailable: "2026-10-24", siteAccessDate: "2026-10-25", clearanceDate: "2026-10-20" });
    expect(r.start).toBe("2026-10-26"); // 25 Oct 2026 is a Sunday
    expect(r.blockers).toEqual([]);
  });
  it("missing dates give a tentative result with named blockers; no buffer is invented", () => {
    const r = deriveScheduleStart({ ...base, requestedInstallationStart: "2026-10-24" });
    expect(r.tentative).toBe(true);
    expect(r.blockers).toEqual(expect.arrayContaining(["Missing material availability", "Missing site-access date", "Clearance not approved"]));
    expect(r.notes.some((n) => n.includes("buffer"))).toBe(false);
  });
  it("hotel nights follow the itinerary", () => {
    expect(hotelNights("2026-11-01", "2026-11-12")).toBe(11);
  });
});
