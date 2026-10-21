import { describe, expect, it } from "vitest";
import { decideEligibility, entryOverlaps, netEntryMinutes, scheduleIntervals, validateEntry, workMetrics, type CalendarDef, type EligibilityPolicy } from "@/domain/time";
import { splitAtLocalDays, splitAtLocalMonths, durationMinutes } from "@/domain/intervals";
import { zonedToUtc } from "@/lib/dates";

const TZ = "Asia/Kolkata";
const at = (d: string, t: string) => zonedToUtc(d, t, TZ);
const cal: CalendarDef = { timezone: TZ, holidays: [], pattern: { 1: { shifts: [{ start: "10:00", end: "20:00" }], netMinutes: 540 }, 2: { shifts: [{ start: "10:00", end: "20:00" }], netMinutes: 540 } } };
const policy: EligibilityPolicy = { candidateRule: "outside_schedule_only", externalDelayEligibility: "unset", otherDocumentedEligibility: "unset" };

describe("scenario 11: shift 10-20, break 13-14, work until 22", () => {
  const entry = { id: "t1", activity: "installation" as const, start: at("2026-11-02", "10:00"), end: at("2026-11-02", "22:00"), breaks: [{ start: at("2026-11-02", "13:00"), end: at("2026-11-02", "14:00") }] };
  it("gives 11 net hours, 9 within schedule, 2 outside", () => {
    const S = scheduleIntervals(cal, "2026-11-02", "2026-11-02");
    const m = workMetrics([entry], S);
    expect(m.actualWorkMinutes).toBe(660);
    expect(m.withinScheduleMinutes).toBe(540);
    expect(m.outsideScheduleMinutes).toBe(120);
    expect(m.withinScheduleMinutes + m.outsideScheduleMinutes).toBe(m.actualWorkMinutes);
  });
  it("verified original-target catch-up is ineligible; no override exists; actual time unchanged", () => {
    const d = decideEligibility({ verifiedReason: "original_target_catch_up", activity: "installation", outsideSchedule: true }, { ...policy, externalDelayEligibility: "eligible", otherDocumentedEligibility: "eligible" });
    expect(d.status).toBe("ineligible");
    expect(d.code).toBe("catch_up_excluded");
    expect(netEntryMinutes(entry)).toBe(660);
  });
  it("authorized additional scope outside schedule is eligible only with a dated approval", () => {
    expect(decideEligibility({ verifiedReason: "authorized_additional_scope", activity: "additional", outsideSchedule: true, authorizationRef: "SCOPE-12" }, policy).status).toBe("eligible");
    expect(decideEligibility({ verifiedReason: "authorized_additional_scope", activity: "additional", outsideSchedule: true }, policy).status).toBe("ineligible");
    expect(decideEligibility({ verifiedReason: "authorized_additional_scope", activity: "additional", outsideSchedule: false, authorizationRef: "SCOPE-12" }, policy).code).toBe("inside_schedule");
  });
  it("external delay needs its own rule; travel is never overtime work", () => {
    expect(decideEligibility({ verifiedReason: "external_delay", activity: "installation", outsideSchedule: true }, policy).status).toBe("pending_policy");
    expect(decideEligibility({ verifiedReason: "authorized_additional_scope", activity: "travel", outsideSchedule: true, authorizationRef: "x" }, policy).code).toBe("not_work");
  });
});

describe("scenario 12: overnight entry", () => {
  it("22:00-02:00 with a 30-minute break = 210 net minutes, split at the date and month boundary", () => {
    const e = { id: "n1", activity: "installation" as const, start: at("2026-10-31", "22:00"), end: at("2026-11-01", "02:00"), breaks: [{ start: at("2026-11-01", "00:30"), end: at("2026-11-01", "01:00") }] };
    expect(validateEntry(e)).toEqual([]);
    expect(netEntryMinutes(e)).toBe(210);
    const days = splitAtLocalDays({ start: e.start, end: e.end }, TZ);
    expect(days.map((d) => [d.date, durationMinutes(d)])).toEqual([["2026-10-31", 120], ["2026-11-01", 120]]);
    const months = splitAtLocalMonths({ start: e.start, end: e.end }, TZ);
    expect(months.map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect(months.reduce((s, m) => s + durationMinutes(m), 0)).toBe(240);
  });
});

describe("scenario 13: overlaps", () => {
  it("overlapping entries and breaks fail; adjacent entries pass", () => {
    const a = { id: "a", start: at("2026-11-02", "10:00"), end: at("2026-11-02", "14:00") };
    const b = { id: "b", start: at("2026-11-02", "14:00"), end: at("2026-11-02", "18:00") };
    const c = { id: "c", start: at("2026-11-02", "13:00"), end: at("2026-11-02", "15:00") };
    expect(entryOverlaps([a, b])).toEqual([]);
    expect(entryOverlaps([a, b, c]).length).toBe(2);
    const e = { id: "x", activity: "installation" as const, start: a.start, end: b.end, breaks: [{ start: at("2026-11-02", "12:00"), end: at("2026-11-02", "13:00") }, { start: at("2026-11-02", "12:30"), end: at("2026-11-02", "13:30") }] };
    expect(validateEntry(e)).toContain("Breaks overlap each other.");
    const outside = { ...e, breaks: [{ start: at("2026-11-02", "09:00"), end: at("2026-11-02", "10:30") }] };
    expect(validateEntry(outside)).toContain("Breaks must lie inside the entry.");
  });
});
