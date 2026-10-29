import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { makeCtx } from "@/server/services/context";
import { clockIn, clockOut, decideCorrection, processDueJobs, requestCorrection, setActivity } from "@/server/services/attendance";
import { attendanceExceptions, attendanceHistory, currentAttendance, notificationsFor } from "@/server/queries/attendance";
import { AppError } from "@/server/errors";
import { clockInPhoto, freshDb } from "./helpers";

// Owner's rule (28 Oct 2026): an open shift never counts more than 24 hours. IST = UTC+05:30.
const at = (hhmm: string, day: string) => Date.parse(`${day}T${hhmm}+05:30`);
const H = 3600_000;
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };

let db: Db;
let worker = "", worker2 = "", supervisor = "", otherSupervisor = "";
const as = async (id: string, now: number) => makeCtx(db, (await loadActor(db, id))!, now);
const shiftOn = async (id: string, date: string) => (await db.query<{ id: string; missed_clock_out: boolean; auto_closed: boolean; auto_closed_at: number | null; clock_out_override: number | null }>(
  "select id, missed_clock_out, auto_closed, auto_closed_at, clock_out_override from shift_instance where employee_id = $1 and work_date = $2", [id, date]))[0]!;
const autoNotes = async (id: string) => db.query<{ title: string; body: string; href: string | null }>("select title, body, href from notification where employee_id = $1 and kind = 'shift_auto_closed'", [id]);
const viewAt = async (id: string, now: number) => currentAttendance(db, (await loadActor(db, id))!, new Date(now + 5.5 * H).toISOString().slice(0, 10), now);

beforeAll(async () => {
  db = await freshDb();
  const ws = await db.query<{ id: string; manager_id: string }>("select id, manager_id from employee where permission_role = 'employee' and active order by business_id limit 2");
  worker = ws[0]!.id; worker2 = ws[1]!.id; supervisor = ws[0]!.manager_id;
  const [o] = await db.query<{ id: string }>(
    "select id from employee where permission_role = 'supervisor' and id <> $1 and id <> all(select manager_id from employee where id = $2) order by business_id limit 1", [supervisor, worker]);
  otherSupervisor = o!.id;
});
afterAll(async () => { await db.close(); });

describe("open shifts stop at 24 hours", () => {
  const day = "2026-10-20";
  const t0 = at("09:00", day);

  it("an open shift at 23 hours still runs and shows 23 hours", async () => {
    await clockIn(await as(worker, t0), { photoDraftKey: await clockInPhoto(db, worker, t0) });
    const v = await viewAt(worker, t0 + 23 * H);
    expect(v.current?.summary.open).toBe(true);
    expect(v.current!.summary.elapsedMinutes).toBeCloseTo(23 * 60, 0);
    expect(v.missed).toHaveLength(0);
    expect((await shiftOn(worker, day)).auto_closed).toBe(false);
    expect(await autoNotes(worker)).toHaveLength(0);
  });

  it("at 25 hours it is closed automatically on read, with no clock-out time and hours capped at 24", async () => {
    const now = t0 + 25 * H;
    const v = await viewAt(worker, now);
    const s = await shiftOn(worker, day);
    expect(s.auto_closed).toBe(true);
    expect(s.missed_clock_out).toBe(true);
    expect(Number(s.auto_closed_at)).toBe(now);
    expect(s.clock_out_override).toBeNull();
    expect(await db.query("select 1 from attendance_event where shift_id = $1 and kind = 'clock_out'", [s.id])).toHaveLength(0);
    expect(await db.query("select 1 from due_job where shift_id = $1 and status = 'pending'", [s.id])).toHaveLength(0);
    expect(await db.query("select 1 from time_entry where shift_id = $1", [s.id])).toHaveLength(0);
    expect(v.current).toBeNull();
    expect(v.missed.map((m) => m.shift.id)).toEqual([s.id]);
    expect(v.missed[0]!.shift.auto_closed).toBe(true);
    expect(v.missed[0]!.summary.elapsedMinutes).toBeLessThanOrEqual(24 * 60);
    expect(v.missed[0]!.summary.lastClockOut).toBeNull();
  });

  it("the warning reaches the worker in the app exactly once, however often the page is read", async () => {
    const now = t0 + 26 * H;
    await Promise.all([viewAt(worker, now), viewAt(worker, now), notificationsFor(db, worker, now)]);
    await processDueJobs(db, now);
    await processDueJobs(db, now + H);
    const n = await autoNotes(worker);
    expect(n).toHaveLength(1);
    expect(n[0]!.body).toMatch(/didn't clock out on 20 Oct/i);
    expect(n[0]!.body).toMatch(/after 24 hours/);
    expect(n[0]!.href).toMatch(/^\/attendance/);
    // Only this worker hears about it.
    expect(await db.query("select 1 from notification where kind = 'shift_auto_closed' and employee_id <> $1", [worker])).toHaveLength(0);
  });

  it("history never shows more than 24 hours, even days later", async () => {
    const rows = await attendanceHistory(db, worker, t0 + 111 * H);
    const r = rows.find((x) => x.work_date === day)!;
    expect(r.missed).toBe(true);
    expect(r.summary.elapsedMinutes).toBeLessThanOrEqual(24 * 60);
    expect(r.summary.regularWorkMinutes + r.summary.recordedOvertimeWorkMinutes).toBeLessThanOrEqual(24 * 60);
  });

  it("the closed shift cannot be clocked out or changed, but a new clock-in works", async () => {
    const now = t0 + 26 * H;
    const s = await shiftOn(worker, day);
    expect(await kind(clockOut(await as(worker, now), { shiftId: s.id }))).toBe("conflict");
    expect(await kind(setActivity(await as(worker, now), { shiftId: s.id, activity: "break" }))).toBe("conflict");
    const r = await clockIn(await as(worker, now), { photoDraftKey: await clockInPhoto(db, worker, now) });
    expect(r.resumed).toBe(false);
    const v = await viewAt(worker, now + 60_000);
    expect(v.current?.shift.id).toBe(r.shiftId);
    expect(v.current!.summary.open).toBe(true);
    expect(v.current!.summary.elapsedMinutes).toBeCloseTo(1, 0);
    await clockOut(await as(worker, now + 2 * H), { shiftId: r.shiftId });
  });

  it("the manager in scope sees it flagged in attendance exceptions; others and the worker do not", async () => {
    const mine = await attendanceExceptions(db, (await loadActor(db, supervisor))!, t0 + 27 * H);
    const row = mine.missed.find((m) => m.employee_id === worker);
    expect(row?.auto_closed).toBe(true);
    const other = await attendanceExceptions(db, (await loadActor(db, otherSupervisor))!, t0 + 27 * H);
    expect(other.missed.find((m) => m.employee_id === worker)).toBeUndefined();
    const self = await attendanceExceptions(db, (await loadActor(db, worker))!, t0 + 27 * H);
    expect(self.missed).toHaveLength(0);
  });

  it("a correction cannot make the shift longer than 24 hours; a real clock-out time closes it", async () => {
    const s = await shiftOn(worker, day);
    const now = t0 + 28 * H;
    expect(await kind(requestCorrection(await as(worker, now), { shiftId: s.id, field: "clock_out", date: "2026-10-21", time: "10:00", reason: "Forgot to clock out" }))).toBe("validation");
    const c = await requestCorrection(await as(worker, now), { shiftId: s.id, field: "clock_out", date: day, time: "18:00", reason: "Forgot to clock out at the site" });
    expect(await kind(decideCorrection(await as(otherSupervisor, now), { correctionId: c.id, decision: "approved" }))).toBe("forbidden");
    await decideCorrection(await as(supervisor, now), { correctionId: c.id, decision: "approved" });
    const after = await shiftOn(worker, day);
    expect(after.missed_clock_out).toBe(false);
    expect(after.auto_closed).toBe(true); // history keeps that the system closed it
    expect((await db.query("select 1 from time_entry where shift_id = $1 and is_current", [s.id])).length).toBeGreaterThan(0);
    const ex = await attendanceExceptions(db, (await loadActor(db, supervisor))!, now);
    expect(ex.missed.find((m) => m.id === s.id)).toBeUndefined();
  });
});

describe("the background runner closes stale shifts too", () => {
  it("closes a shift nobody looks at, once", async () => {
    const day = "2026-10-22";
    const t0 = at("08:00", day);
    await clockIn(await as(worker2, t0), { photoDraftKey: await clockInPhoto(db, worker2, t0) });
    await processDueJobs(db, t0 + 23 * H + 59 * 60_000);
    expect((await shiftOn(worker2, day)).auto_closed).toBe(false);
    await processDueJobs(db, t0 + 24 * H);
    await processDueJobs(db, t0 + 30 * H);
    const s = await shiftOn(worker2, day);
    expect(s.auto_closed).toBe(true);
    expect(Number(s.auto_closed_at)).toBe(t0 + 24 * H);
    expect(await autoNotes(worker2)).toHaveLength(1);
  });
});
