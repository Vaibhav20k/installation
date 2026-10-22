import { describe, expect, it } from "vitest";
import { REGULAR_SESSION_MINUTES, REMINDER_MINUTES, draftRows, overtimeAt, summarize, warnAt, type ShiftEvent } from "@/domain/shift";

// Wall-clock times below are isolated test inputs (spec §14), not a universal start time. IST = UTC+05:30.
const at = (hhmm: string, day = "2026-10-12") => Date.parse(`${day}T${hhmm}:00+05:30`);

describe("fixed eight-hour session constants", () => {
  it("are 480 and 450 minutes (scenario 43, 67)", () => {
    expect(REGULAR_SESSION_MINUTES).toBe(480);
    expect(REMINDER_MINUTES).toBe(450);
    expect(warnAt(at("09:00"))).toBe(at("16:30"));
    expect(overtimeAt(at("09:00"))).toBe(at("17:00"));
    expect(warnAt(at("10:15"))).toBe(at("17:45"));
    expect(overtimeAt(at("10:15"))).toBe(at("18:15"));
  });

  it("crosses midnight without changing the duration (scenario 67)", () => {
    const t0 = at("20:30");
    expect(overtimeAt(t0)).toBe(Date.parse("2026-10-13T04:30:00+05:30"));
  });
});

describe("session state machine", () => {
  const t0 = at("09:00");
  const ev: ShiftEvent[] = [{ kind: "clock_in", at: t0 }];

  it("stays regular at 7:30 and switches to overtime at 8:00 without a second punch (scenario 43)", () => {
    expect(summarize(t0, ev, at("16:29")).state).toBe("regular");
    const atWarn = summarize(t0, ev, at("16:30"));
    expect(atWarn.state).toBe("regular");
    expect(atWarn.remainingRegularMinutes).toBe(30);
    expect(summarize(t0, ev, at("16:59")).state).toBe("regular");
    const atOt = summarize(t0, ev, at("17:00"));
    expect(atOt.state).toBe("overtime");
    expect(atOt.regularElapsedMinutes).toBe(480);
    expect(atOt.overtimePeriodElapsedMinutes).toBe(0);
  });

  it("an early clock-out creates no overtime; clock-out exactly at 8:00 gives zero overtime minutes (scenario 44)", () => {
    const early = summarize(t0, [...ev, { kind: "clock_out", at: at("16:00") }], at("18:00"));
    expect(early.state).toBe("clocked_out");
    expect(early.recordedOvertimeWorkMinutes).toBe(0);
    const exact = summarize(t0, [...ev, { kind: "clock_out", at: at("17:00") }], at("18:00"));
    expect(exact.state).toBe("clocked_out");
    expect(exact.overtimePeriodElapsedMinutes).toBe(0);
    expect(exact.recordedOvertimeWorkMinutes).toBe(0);
  });

  it("09:00 in, break 13:00–14:00, out 19:00: 10 h attended, 9 h work = 7 regular + 2 recorded OT (scenario 11)", () => {
    const s = summarize(t0, [...ev,
      { kind: "activity", at: at("13:00"), activity: "break" },
      { kind: "activity", at: at("14:00"), activity: "working" },
      { kind: "clock_out", at: at("19:00") }], at("20:00"));
    expect(s.elapsedMinutes).toBe(600);
    expect(s.breakMinutes).toBe(60);
    expect(s.regularWorkMinutes).toBe(420);
    expect(s.recordedOvertimeWorkMinutes).toBe(120);
    expect(s.netWorkMinutes).toBe(540);
  });

  it("idle 16:45–17:15 splits 15 regular / 15 overtime idle with zero productive OT in it (scenario 48)", () => {
    const s = summarize(t0, [...ev,
      { kind: "activity", at: at("16:45"), activity: "idle" },
      { kind: "activity", at: at("17:15"), activity: "working" },
      { kind: "clock_out", at: at("17:15") }], at("18:00"));
    expect(s.idleRegularMinutes).toBe(15);
    expect(s.idleOvertimeMinutes).toBe(15);
    expect(s.recordedOvertimeWorkMinutes).toBe(0);
  });

  it("breaks do not move the reminder or the end (scenario 48)", () => {
    const s = summarize(t0, [...ev, { kind: "activity", at: at("12:00"), activity: "break" }, { kind: "activity", at: at("13:30"), activity: "working" }], at("16:00"));
    expect(s.warnAt).toBe(at("16:30"));
    expect(s.otAt).toBe(at("17:00"));
  });

  it("reopening the same shift keeps the anchor and does not count the off-duty gap (scenario 49)", () => {
    const s = summarize(t0, [...ev, { kind: "clock_out", at: at("12:00") }, { kind: "resume", at: at("14:00") }, { kind: "clock_out", at: at("18:00") }], at("19:00"));
    expect(s.otAt).toBe(at("17:00"));
    expect(s.attendedMinutes).toBe(180 + 240);
    expect(s.regularWorkMinutes).toBe(180 + 180);
    expect(s.recordedOvertimeWorkMinutes).toBe(60);
  });

  it("a worker on break sees break, not a running work timer", () => {
    const s = summarize(t0, [...ev, { kind: "activity", at: at("13:00"), activity: "break" }], at("13:20"));
    expect(s.activity).toBe("break");
    expect(s.regularWorkMinutes).toBe(240);
  });
});

describe("timesheet rows from attendance", () => {
  it("keeps breaks inside the working row and splits travel and idle into their own rows", () => {
    const rows = draftRows([
      { kind: "clock_in", at: at("09:00") },
      { kind: "activity", at: at("09:00"), activity: "travel" },
      { kind: "activity", at: at("10:00"), activity: "working" },
      { kind: "activity", at: at("13:00"), activity: "break" },
      { kind: "activity", at: at("13:45"), activity: "working" },
      { kind: "activity", at: at("16:00"), activity: "idle" },
      { kind: "activity", at: at("16:30"), activity: "working" },
      { kind: "clock_out", at: at("18:00") },
    ], at("19:00"));
    expect(rows.map((r) => [r.activity, new Date(r.start).toISOString().slice(11, 16), new Date(r.end).toISOString().slice(11, 16), r.breaks.length])).toEqual([
      ["travel", "03:30", "04:30", 0],
      ["installation", "04:30", "10:30", 1],
      ["waiting", "10:30", "11:00", 0],
      ["installation", "11:00", "12:30", 0],
    ]);
  });
});
