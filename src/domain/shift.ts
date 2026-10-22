/**
 * Fixed eight-hour attendance session (confirmed user rule, spec V3 §9).
 * The session runs on elapsed wall-clock time from the actual clock-in anchor t0:
 * reminder at t0 + 450 min, automatic switch to recorded overtime at t0 + 480 min.
 * Breaks and idle do not move either boundary. Pure functions; times are epoch ms.
 */
export const REGULAR_SESSION_MINUTES = 480;
export const REMINDER_MINUTES = 450;
const MIN = 60_000;

export type Activity = "working" | "break" | "idle" | "travel";
export type SessionState = "not_started" | "regular" | "overtime" | "clocked_out";

export interface ShiftEvent { kind: "clock_in" | "resume" | "clock_out" | "activity" | "overtime_started" | "correction" | "note"; at: number; activity?: Activity | null }

export const warnAt = (t0: number) => t0 + REMINDER_MINUTES * MIN;
export const overtimeAt = (t0: number) => t0 + REGULAR_SESSION_MINUTES * MIN;

interface Segment { start: number; end: number; activity: Activity }

/** Activity segments inside open attendance, clipped to [.., now]. Clocked-out gaps are not counted. */
export function segments(events: ShiftEvent[], now: number): Segment[] {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const out: Segment[] = [];
  let open: number | null = null;
  let activity: Activity = "working";
  let cursor = 0;
  const close = (end: number) => { if (open !== null && end > cursor) out.push({ start: cursor, end, activity }); };
  for (const e of sorted) {
    if (e.at > now) break;
    if (e.kind === "clock_in" || e.kind === "resume") {
      if (open === null) { open = e.at; cursor = e.at; activity = "working"; }
    } else if (e.kind === "clock_out") {
      if (open !== null) { close(e.at); open = null; }
    } else if (e.kind === "activity" && e.activity) {
      if (open !== null) { close(e.at); cursor = e.at; }
      activity = e.activity;
    }
  }
  if (open !== null) close(now);
  return out.filter((s) => s.end > s.start);
}

const overlap = (s: Segment, a: number, b: number) => Math.max(0, Math.min(s.end, b) - Math.max(s.start, a));

export interface ShiftSummary {
  state: SessionState;
  activity: Activity | null;
  t0: number | null;
  warnAt: number | null;
  otAt: number | null;
  open: boolean;
  elapsedMinutes: number;
  regularElapsedMinutes: number;
  overtimePeriodElapsedMinutes: number;
  remainingRegularMinutes: number;
  regularWorkMinutes: number;
  recordedOvertimeWorkMinutes: number;
  netWorkMinutes: number;
  breakMinutes: number;
  idleRegularMinutes: number;
  idleOvertimeMinutes: number;
  travelMinutes: number;
  attendedMinutes: number;
  lastClockOut: number | null;
}

/**
 * Summarise one shift. `t0` is the stored anchor (it survives resumes and only changes by approved correction).
 * elapsed = max(0, tEnd - t0) where tEnd is now while open or the last clock-out when closed.
 */
export function summarize(t0: number | null, events: ShiftEvent[], now: number): ShiftSummary {
  const segs = t0 === null ? [] : segments(events, now);
  const sorted = [...events].filter((e) => e.at <= now).sort((a, b) => a.at - b.at);
  let open = false, lastClockOut: number | null = null, activity: Activity | null = null;
  for (const e of sorted) {
    if (e.kind === "clock_in" || e.kind === "resume") { open = true; activity = "working"; }
    else if (e.kind === "clock_out") { open = false; lastClockOut = e.at; }
    else if (e.kind === "activity" && e.activity) activity = e.activity;
  }
  if (t0 === null) {
    return { state: "not_started", activity: null, t0: null, warnAt: null, otAt: null, open: false, elapsedMinutes: 0, regularElapsedMinutes: 0, overtimePeriodElapsedMinutes: 0,
      remainingRegularMinutes: REGULAR_SESSION_MINUTES, regularWorkMinutes: 0, recordedOvertimeWorkMinutes: 0, netWorkMinutes: 0, breakMinutes: 0, idleRegularMinutes: 0,
      idleOvertimeMinutes: 0, travelMinutes: 0, attendedMinutes: 0, lastClockOut: null };
  }
  const ot = overtimeAt(t0);
  const tEnd = open ? now : (lastClockOut ?? now);
  const elapsed = Math.max(0, (tEnd - t0) / MIN);
  const sum = (pred: (s: Segment) => boolean, a: number, b: number) => segs.filter(pred).reduce((n, s) => n + overlap(s, a, b), 0) / MIN;
  const regularWork = sum((s) => s.activity === "working", t0, ot);
  const otWork = sum((s) => s.activity === "working", ot, Infinity);
  const state: SessionState = !open ? "clocked_out" : now >= ot ? "overtime" : "regular";
  return {
    state,
    activity: open ? activity : null,
    t0, warnAt: warnAt(t0), otAt: ot, open,
    elapsedMinutes: elapsed,
    regularElapsedMinutes: Math.min(elapsed, REGULAR_SESSION_MINUTES),
    overtimePeriodElapsedMinutes: Math.max(0, elapsed - REGULAR_SESSION_MINUTES),
    remainingRegularMinutes: Math.max(0, REGULAR_SESSION_MINUTES - elapsed),
    regularWorkMinutes: regularWork,
    recordedOvertimeWorkMinutes: otWork,
    netWorkMinutes: regularWork + otWork,
    breakMinutes: sum((s) => s.activity === "break", -Infinity, Infinity),
    idleRegularMinutes: sum((s) => s.activity === "idle", t0, ot),
    idleOvertimeMinutes: sum((s) => s.activity === "idle", ot, Infinity),
    travelMinutes: sum((s) => s.activity === "travel", -Infinity, Infinity),
    attendedMinutes: segs.reduce((n, s) => n + (s.end - s.start), 0) / MIN,
    lastClockOut,
  };
}

/** Worker-facing messages, verbatim from the confirmed contract. */
export const SHIFT_MESSAGES = {
  warning: "Your regular 8-hour session ends in 30 minutes. Update today's tasks and clock out when you finish.",
  overtime: "Your regular session has ended. Overtime recording is now active; approval is pending.",
  catchUp: "Recorded after regular hours. Original-target catch-up is not eligible for overtime approval.",
} as const;

/**
 * Timesheet rows from attendance: contiguous working time (with breaks inside it) becomes one installation row,
 * travel and idle become their own rows; a break outside working time is simply unlogged time.
 */
export interface DraftRow { activity: "installation" | "travel" | "waiting"; start: number; end: number; breaks: Array<{ start: number; end: number }> }
export function draftRows(events: ShiftEvent[], now: number): DraftRow[] {
  const segs = segments(events, now);
  const rows: DraftRow[] = [];
  let cur: DraftRow | null = null;
  let pendingBreak: Segment | null = null;
  const flush = () => { if (cur) rows.push(cur); cur = null; pendingBreak = null; };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const contiguous = cur !== null && (pendingBreak ? pendingBreak.end === s.start : cur.end === s.start);
    if (s.activity === "working") {
      if (cur && cur.activity === "installation" && contiguous) {
        if (pendingBreak) cur.breaks.push({ start: pendingBreak.start, end: pendingBreak.end });
        cur.end = s.end; pendingBreak = null;
      } else { flush(); cur = { activity: "installation", start: s.start, end: s.end, breaks: [] }; }
    } else if (s.activity === "break") {
      if (cur && cur.activity === "installation" && cur.end === s.start) pendingBreak = s;
      else flush();
    } else {
      flush();
      const activity = s.activity === "travel" ? "travel" : "waiting";
      const last = rows[rows.length - 1];
      if (last && last.activity === activity && last.end === s.start) last.end = s.end;
      else rows.push({ activity, start: s.start, end: s.end, breaks: [] });
    }
  }
  flush();
  return rows;
}
