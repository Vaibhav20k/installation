import { describe, expect, it } from "vitest";
import { mergeIntervals, plannedDates, siteDays, splitAtMidnight } from "@/domain/site-days";
import { zonedToUtc } from "@/lib/dates";

const TZ = "Asia/Kolkata";
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);

describe("site days", () => {
  it("counts several sessions on one date as one recorded day and sums their union", () => {
    const s = siteDays([{ in: at("2026-11-02", "09:00"), out: at("2026-11-02", "12:00") }, { in: at("2026-11-02", "13:00"), out: at("2026-11-02", "17:30") }], TZ);
    expect(s.recordedDays).toBe(1);
    expect(s.recordedMinutes).toBe(450);
  });

  it("merges overlapping sessions before measuring", () => {
    const s = siteDays([{ in: at("2026-11-02", "09:00"), out: at("2026-11-02", "12:00") }, { in: at("2026-11-02", "11:00"), out: at("2026-11-02", "13:00") }], TZ);
    expect(s.recordedMinutes).toBe(240);
    expect(mergeIntervals([{ start: 1, end: 3 }, { start: 3, end: 5 }, { start: 7, end: 6 }])).toEqual([{ start: 1, end: 5 }]);
  });

  it("splits an overnight session at local midnight", () => {
    const s = siteDays([{ in: at("2026-11-02", "22:00"), out: at("2026-11-03", "02:00") }], TZ);
    expect(s.days).toEqual([{ date: "2026-11-02", minutes: 120 }, { date: "2026-11-03", minutes: 120 }]);
    expect(s.recordedDays).toBe(2);
  });

  it("does not add the next date when a session ends exactly at midnight", () => {
    const s = siteDays([{ in: at("2026-11-02", "20:00"), out: at("2026-11-03", "00:00") }], TZ);
    expect(s.days.map((d) => d.date)).toEqual(["2026-11-02"]);
    expect(splitAtMidnight(at("2026-11-02", "20:00"), at("2026-11-03", "00:00"), TZ)).toHaveLength(1);
  });

  it("keeps an open session out of days and duration and reports it separately", () => {
    const s = siteDays([{ in: at("2026-11-01", "09:00"), out: null }, { in: at("2026-11-04", "09:00"), out: at("2026-11-04", "10:00") }], TZ);
    expect(s.openSessions).toBe(1);
    expect(s.recordedDays).toBe(1);
    expect(s.recordedMinutes).toBe(60);
  });

  it("counts a short visit as a date of presence with its real duration", () => {
    const s = siteDays([{ in: at("2026-11-05", "10:00"), out: at("2026-11-05", "10:20") }], TZ);
    expect(s.recordedDays).toBe(1);
    expect(s.recordedMinutes).toBe(20);
  });

  it("lists planned dates from half-open reservation spans", () => {
    expect(plannedDates([{ start: at("2026-11-02", "00:00"), end: at("2026-11-05", "00:00") }], TZ)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });
});
