import { describe, expect, it } from "vitest";
import { applianceBlockers, driverEffort, effortQuantity, siteCapacity } from "@/domain/site";
import type { ProductivityRate } from "@/domain/effort";

// All rates and quantities here are isolated illustrative fixtures (spec §14), not approved values.
const rate = (over: Partial<ProductivityRate>): ProductivityRate => ({ id: "R", activity: "install", quantityKind: "counter_edge_length", unit: "rft", basis: "employee_hour", value: "10", status: "approved", version: 1, ...over });

describe("net vs gross quantity (scenario 56)", () => {
  it("effort uses net 100, never gross 125", () => {
    const q = effortQuantity([{ basis: "gross", quantity: "125", unit: "sqft", quantityKind: "counter_surface_area" }, { basis: "net", quantity: "100", unit: "sqft", quantityKind: "counter_surface_area" }]);
    expect(q?.quantity).toBe("100");
  });
  it("with only gross recorded there is no effort quantity (no derived conversion)", () => {
    expect(effortQuantity([{ basis: "gross", quantity: "125", unit: "sqft", quantityKind: "counter_surface_area" }])).toBeNull();
  });
});

describe("multi-driver effort", () => {
  it("adds separately covered drivers with matching rates", () => {
    const r = driverEffort([{ id: "a", driver: "linear", activity: "install", quantity: "30", unit: "rft", quantityKind: "counter_edge_length" }], [rate({})]);
    expect(r.knownMinutes).toBe(180);
    expect(r.complete).toBe(true);
  });
  it("a driver without a rate is unknown, not zero, and kinds must match even when units match (scenario 36)", () => {
    const r = driverEffort([{ id: "b", driver: "cutout", activity: "install", quantity: "2", unit: "count", quantityKind: "sink_cutout" },
      { id: "c", driver: "area", activity: "install", quantity: "50", unit: "rft", quantityKind: "floor_area" }], [rate({})]);
    expect(r.complete).toBe(false);
    expect(r.knownMinutes).toBe(0);
    expect(r.lines.every((l) => l.minutes === null && l.issue)).toBe(true);
  });
});

describe("site window (scenario 23)", () => {
  it("a six-hour site window needs more calendar days, without changing effort or the 8-hour session", () => {
    const effort = 3 * 480; // one eight-hour rate-day for three people, expressed in person-minutes
    const open = siteCapacity(null, effort, 3);
    const six = siteCapacity({ allowedWeekdays: [1, 2, 3, 4, 5, 6], startTime: "10:00", endTime: "16:00", restrictedActivities: [] }, effort, 3);
    expect(open.crewDays).toBe(1);
    expect(six.productiveMinutesPerDay).toBe(360);
    expect(six.crewDays).toBe(2);
    expect(six.extraDaysFromRestriction).toBe(1);
    expect(six.shortfallPerDay).toBe(120);
  });
});

describe("appliance readiness (scenario 57)", () => {
  it("selected-only appliances and unbooked brand technicians block; an exception keeps a visible risk", () => {
    const r = applianceBlockers([
      { appliance: "Hob", state: "selected", brandTechnician: "not_needed", exceptionReason: null, dependsOn: "hob cut-out" },
      { appliance: "Chimney", state: "on_site", brandTechnician: "needed", exceptionReason: null, dependsOn: null },
      { appliance: "Oven", state: "spec_final", brandTechnician: "booked", exceptionReason: "Customer will deliver on day 2", dependsOn: null },
      { appliance: "Sink", state: "inspected", brandTechnician: "not_needed", exceptionReason: null, dependsOn: null },
    ]);
    expect(r.blockers.map((b) => b.appliance)).toEqual(["Hob", "Chimney"]);
    expect(r.risks.map((b) => b.appliance)).toEqual(["Oven"]);
  });
});
