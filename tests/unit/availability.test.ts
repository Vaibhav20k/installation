import { describe, expect, it } from "vitest";
import { nextAvailableDate } from "@/domain/availability";

// Isolated illustrative fixtures (spec §14): a Mon–Sat calendar in IST, not an approved calendar.
const TZ = "Asia/Kolkata";
const at = (s: string) => Date.parse(`${s}+05:30`);
const WEEK = [1, 2, 3, 4, 5, 6];

describe("next available date for the skill cards", () => {
  it("is the day a booking ends when it ends mid-day, otherwise the next working day", () => {
    const now = at("2026-10-22T10:00:00");
    expect(nextAvailableDate([{ start: at("2026-10-21T00:00:00"), end: at("2026-10-24T00:00:00") }], now, TZ, WEEK, [])).toBe("2026-10-24");
    expect(nextAvailableDate([{ start: at("2026-10-21T00:00:00"), end: at("2026-10-23T14:00:00") }], now, TZ, WEEK, [])).toBe("2026-10-23");
  });
  it("steps over back-to-back bookings and leave, Sundays and holidays", () => {
    const now = at("2026-10-22T10:00:00");
    const blocks = [{ start: at("2026-10-20T00:00:00"), end: at("2026-10-24T00:00:00") }, { start: at("2026-10-24T00:00:00"), end: at("2026-10-25T00:00:00") }];
    // Free from Sunday 25th, which is off; Monday 26th is a holiday; Tuesday 27th.
    expect(nextAvailableDate(blocks, now, TZ, WEEK, ["2026-10-26"])).toBe("2026-10-27");
  });
  it("a booking that starts again the next morning keeps the person unavailable", () => {
    const now = at("2026-10-22T10:00:00");
    const blocks = [{ start: at("2026-10-21T00:00:00"), end: at("2026-10-23T00:00:00") }, { start: at("2026-10-23T00:00:00"), end: at("2026-10-28T00:00:00") }];
    expect(nextAvailableDate(blocks, now, TZ, WEEK, [])).toBe("2026-10-28");
  });
  it("returns null past the horizon or without a calendar, never a guess", () => {
    const now = at("2026-10-22T10:00:00");
    expect(nextAvailableDate([{ start: now, end: at("2027-03-01T00:00:00") }], now, TZ, WEEK, [], 90)).toBeNull();
    expect(nextAvailableDate([], now, TZ, [], [])).toBeNull();
  });
});
