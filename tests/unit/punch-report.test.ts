/** Pure helpers of the punch location report: the date range people ask for, and how far a punch was from the site. */
import { describe, expect, it } from "vitest";
import { distanceMeters, distanceText, punchCsv, punchRange, type PunchRow } from "@/domain/punch-report";

describe("date range", () => {
  it("defaults to this month so far", () => {
    expect(punchRange({}, "2026-11-15")).toEqual({ from: "2026-11-01", to: "2026-11-15" });
  });
  it("uses valid dates, and puts them in order", () => {
    expect(punchRange({ from: "2026-09-01", to: "2026-09-30" }, "2026-11-15")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(punchRange({ from: "2026-09-30", to: "2026-09-01" }, "2026-11-15")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("ignores nonsense and limits a request to 92 days", () => {
    expect(punchRange({ from: "bad'; drop", to: "2026-13-45" }, "2026-11-15")).toEqual({ from: "2026-11-01", to: "2026-11-15" });
    expect(punchRange({ from: "2020-01-01", to: "2026-11-15" }, "2026-11-15").from).toBe("2026-08-15");
  });
});

describe("distance from the site", () => {
  it("is zero at the site and about right for a known distance", () => {
    expect(distanceMeters(28.4356, 77.1057, 28.4356, 77.1057)).toBe(0);
    const d = distanceMeters(28.4356, 77.1057, 28.4456, 77.1057); // 0.01 degree of latitude is about 1.11 km
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });
});

describe("distance words", () => {
  it("reads in metres up to 1 km, then km", () => {
    expect(distanceText(45)).toBe("45 m");
    expect(distanceText(8883)).toBe("8.9 km");
    expect(distanceText(1727058)).toBe("1,727.1 km");
  });
});

describe("download", () => {
  const row: PunchRow = {
    id: "1", date: "2026-09-10", business_id: "EMP-020", name: "=Rakesh", designation: "helper", project: "Mehta", city: "Gurugram", timezone: "Asia/Kolkata",
    check_in_at: Date.parse("2026-09-10T03:30:00Z"), check_out_at: Date.parse("2026-09-10T12:00:00Z"), hours: 8.5, source: "live", missed: false,
    in: { latitude: 28.4356, longitude: 77.1057, accuracy: 12, distanceM: 0 }, out: null,
  };
  it("has one row per punch, local times, map links, a blank for no location, and neutralised formulas", () => {
    const { headers, rows } = punchCsv([row]);
    const at = (h: string) => rows[0]![headers.indexOf(h)];
    expect(at("Date")).toBe("2026-09-10");
    expect(at("Clock-in time")).toBe("09:00");
    expect(at("Clock-in map")).toBe("https://www.google.com/maps?q=28.4356,77.1057");
    expect(at("Clock-in distance from site (m)")).toBe(0);
    expect(at("Clock-out latitude")).toBe("");
    expect(at("Hours")).toBe(8.5);
    expect(at("Name")).toBe("=Rakesh"); // toCsv escapes formulas when it writes the file
  });
});
