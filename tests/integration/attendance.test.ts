import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { makeCtx } from "@/server/services/context";
import { addAttendanceNote, clockIn, clockOut, decideCorrection, decideLeave, processDueJobs, requestCorrection, requestLeave, setActivity, setOvertimeReason } from "@/server/services/attendance";
import { currentAttendance, notificationsFor } from "@/server/queries/attendance";
import { AppError } from "@/server/errors";
import { clockInPhoto, freshDb } from "./helpers";

// Clock times are isolated test inputs (spec §14). IST = UTC+05:30.
const at = (hhmm: string, day = "2026-10-12") => Date.parse(`${day}T${hhmm}+05:30`);
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };

let db: Db;
let worker = "", supervisor = "", otherSupervisor = "", manager = "";
const as = async (id: string, now: number) => makeCtx(db, (await loadActor(db, id))!, now);
const shiftOf = async (id: string, date = "2026-10-12") => (await db.query<{ id: string; t0: number; warn_at: number; ot_at: number; revision: number }>(
  "select id, t0, warn_at, ot_at, revision from shift_instance where employee_id = $1 and work_date = $2", [id, date]))[0]!;
const notes = async (id: string) => db.query<{ kind: string; overdue: boolean; effective_at: number }>("select kind, overdue, effective_at from notification where employee_id = $1 order by effective_at", [id]);

beforeAll(async () => {
  db = await freshDb();
  const [w] = await db.query<{ id: string; manager_id: string }>("select id, manager_id from employee where permission_role = 'employee' and active order by business_id limit 1");
  worker = w!.id; supervisor = w!.manager_id;
  const [o] = await db.query<{ id: string }>("select id from employee where permission_role = 'supervisor' and id <> $1 order by business_id limit 1", [supervisor]);
  otherSupervisor = o!.id;
  const [m] = await db.query<{ id: string }>("select manager_id id from employee where id = $1", [supervisor]);
  manager = m!.id;
});
afterAll(async () => { await db.close(); });

describe("fixed 8-hour session with durable jobs", () => {
  it("clock-in needs a fresh, unused photo (user rule, 23 Oct)", async () => {
    expect(await kind(clockIn(await as(worker, at("08:50")), {}))).toBe("validation");
    expect(await kind(clockIn(await as(worker, at("08:50")), { photoDraftKey: await clockInPhoto(db, worker, at("08:30")) }))).toBe("validation");
  });

  it("clock-in stores t0 and the 450/480-minute deadlines, and schedules two jobs (scenario 43)", async () => {
    const r = await clockIn(await as(worker, at("09:00")), { photoDraftKey: await clockInPhoto(db, worker, at("09:00")) });
    expect(r.resumed).toBe(false);
    const s = await shiftOf(worker);
    const linked = await db.query("select 1 from evidence_link l join attendance_event e on e.id = l.parent_id where e.shift_id = $1 and e.kind = 'clock_in' and l.context = 'attendance.clock_in'", [s.id]);
    expect(linked).toHaveLength(1);
    expect(Number(s.warn_at)).toBe(at("16:30"));
    expect(Number(s.ot_at)).toBe(at("17:00"));
    const jobs = await db.query("select kind from due_job where shift_id = $1 and status = 'pending'", [s.id]);
    expect(jobs).toHaveLength(2);
    expect(await kind(clockIn(await as(worker, at("09:05")), { photoDraftKey: await clockInPhoto(db, worker, at("09:05")) }))).toBe("conflict");
  });

  it("no reminder before 7:30; exactly one at 7:30, even if processed repeatedly (scenarios 43, 45)", async () => {
    await processDueJobs(db, at("16:29:59"));
    expect(await notes(worker)).toHaveLength(0);
    await processDueJobs(db, at("16:30"));
    await processDueJobs(db, at("16:30"));
    await notificationsFor(db, worker, at("16:31"));
    const n = await notes(worker);
    expect(n.map((x) => x.kind)).toEqual(["shift_warning"]);
    const view = await currentAttendance(db, (await loadActor(db, worker))!, "2026-10-12", at("16:31"));
    expect(view.current!.summary.state).toBe("regular");
    expect(view.current!.summary.remainingRegularMinutes).toBeCloseTo(29, 0);
  });

  it("a five-minute-late runner still records overtime effective at 8:00, once (scenario 46)", async () => {
    await processDueJobs(db, at("17:05"));
    await processDueJobs(db, at("17:06"));
    const s = await shiftOf(worker);
    const ev = await db.query<{ effective_at: number; recorded_at: number }>("select effective_at, recorded_at from attendance_event where shift_id = $1 and kind = 'overtime_started'", [s.id]);
    expect(ev).toHaveLength(1);
    expect(Number(ev[0]!.effective_at)).toBe(at("17:00"));
    expect((await notes(worker)).map((x) => x.kind)).toEqual(["shift_warning", "shift_overtime"]);
  });

  it("break/idle states, OT reason and clock-out produce draft rows and an automatic OT candidate (scenarios 11, 51)", async () => {
    // Break 13:00–14:00 recorded retroactively is not possible from the panel; this test records activities at their times.
    const s = await shiftOf(worker);
    await expect(setActivity(await as(worker, at("17:10")), { shiftId: s.id, activity: "idle" })).rejects.toBeInstanceOf(AppError);
    await setOvertimeReason(await as(worker, at("17:20")), { shiftId: s.id, reason: "catch_up" });
    const out = await clockOut(await as(worker, at("19:00")), { shiftId: s.id });
    expect(out.regularWorkMinutes).toBe(480);
    expect(out.recordedOvertimeWorkMinutes).toBe(120);
    expect(out.overtimeCandidateMinutes).toBe(120);
    const ot = await db.query<{ claimed_reason: string; decision: string }>("select claimed_reason, decision from ot_request where employee_id = $1", [worker]);
    expect(ot).toHaveLength(1);
    expect(ot[0]!.decision).toBe("requested");
    expect(ot[0]!.claimed_reason).toMatch(/catch-up/);
    const rows = await db.query<{ activity: string; state: string }>("select activity, state from time_entry where shift_id = $1 and is_current", [s.id]);
    expect(rows).toEqual([{ activity: "installation", state: "draft" }]);
    expect(await kind(clockOut(await as(worker, at("19:01")), { shiftId: s.id }))).toBe("conflict");
  });

  it("an attendance note never changes punches", async () => {
    const s = await shiftOf(worker);
    const before = await db.query("select count(*)::int n from attendance_event where shift_id = $1 and kind in ('clock_in','clock_out','resume')", [s.id]);
    const r = await addAttendanceNote(await as(worker, at("19:05")), { shiftId: s.id, note: "Gate opened late" });
    expect(r.id).toBeTruthy();
    const after = await db.query("select count(*)::int n from attendance_event where shift_id = $1 and kind in ('clock_in','clock_out','resume')", [s.id]);
    expect(after).toEqual(before);
  });
});

describe("early and boundary clock-outs, resume and missed clock-out", () => {
  const day = "2026-10-13";
  it("clock-out at 16:00 cancels pending reminders and creates no overtime (scenario 44)", async () => {
    await clockIn(await as(worker, at("09:00", day)), { photoDraftKey: await clockInPhoto(db, worker, at("09:00", day)) });
    const s = await shiftOf(worker, day);
    await clockOut(await as(worker, at("16:00", day)), { shiftId: s.id });
    await processDueJobs(db, at("18:00", day));
    const n = await db.query("select 1 from notification where shift_id = $1", [s.id]);
    expect(n).toHaveLength(0);
    expect(await db.query("select 1 from attendance_event where shift_id = $1 and kind = 'overtime_started'", [s.id])).toHaveLength(0);
  });

  it("clocking in again keeps the anchor and re-arms the deadlines without a fresh 8 hours (scenario 49)", async () => {
    const r = await clockIn(await as(worker, at("16:20", day)), { photoDraftKey: await clockInPhoto(db, worker, at("16:20", day)) });
    expect(r.resumed).toBe(true);
    const s = await shiftOf(worker, day);
    expect(Number(s.t0)).toBe(at("09:00", day));
    // The reminder is due at 16:30 and the worker is clocked in again at that moment.
    await processDueJobs(db, at("16:30", day));
    expect((await db.query<{ kind: string }>("select kind from notification where shift_id = $1", [s.id])).map((x) => x.kind)).toEqual(["shift_warning"]);
  });

  it("clock-out exactly at 8:00 records zero overtime and no overtime session (scenario 44)", async () => {
    const s = await shiftOf(worker, day);
    const out = await clockOut(await as(worker, at("17:00", day)), { shiftId: s.id });
    expect(out.recordedOvertimeWorkMinutes).toBe(0);
    await processDueJobs(db, at("17:30", day));
    expect(await db.query("select 1 from attendance_event where shift_id = $1 and kind = 'overtime_started'", [s.id])).toHaveLength(0);
    expect(await db.query("select 1 from notification where shift_id = $1 and kind = 'shift_overtime'", [s.id])).toHaveLength(0);
  });

  it("an unclosed shift becomes a provisional missed clock-out, never auto-finalised (scenario 52)", async () => {
    await clockIn(await as(worker, at("09:00", "2026-10-14")), { photoDraftKey: await clockInPhoto(db, worker, at("09:00", "2026-10-14")) });
    await clockIn(await as(worker, at("09:10", "2026-10-15")), { photoDraftKey: await clockInPhoto(db, worker, at("09:10", "2026-10-15")) });
    const [old] = await db.query<{ missed_clock_out: boolean; clock_out_override: number | null }>("select missed_clock_out, clock_out_override from shift_instance where employee_id = $1 and work_date = '2026-10-14'", [worker]);
    expect(old!.missed_clock_out).toBe(true);
    expect(old!.clock_out_override).toBeNull();
    expect(await db.query("select 1 from time_entry where shift_id = (select id from shift_instance where employee_id = $1 and work_date = '2026-10-14')", [worker])).toHaveLength(0);
  });
});

describe("corrections and leave privacy", () => {
  it("a worker cannot approve their own correction; an approved clock-in correction moves the anchor with a new revision (scenario 50)", async () => {
    const s = await shiftOf(worker, "2026-10-15");
    const c = await requestCorrection(await as(worker, at("10:00", "2026-10-15")), { shiftId: s.id, field: "clock_in", date: "2026-10-15", time: "08:40", reason: "Phone had no network at the gate" });
    expect(await kind(decideCorrection(await as(worker, at("10:05", "2026-10-15")), { correctionId: c.id, decision: "approved" }))).toBe("forbidden");
    await decideCorrection(await as(supervisor, at("10:10", "2026-10-15")), { correctionId: c.id, decision: "approved" });
    const after = await shiftOf(worker, "2026-10-15");
    expect(Number(after.t0)).toBe(at("08:40", "2026-10-15"));
    expect(Number(after.ot_at)).toBe(at("16:40", "2026-10-15"));
    expect(after.revision).toBe(2);
    const jobs = await db.query<{ shift_revision: number; status: string }>("select shift_revision, status from due_job where shift_id = $1 order by shift_revision, kind", [s.id]);
    expect(jobs.filter((j) => j.shift_revision === 1).every((j) => j.status === "superseded")).toBe(true);
    expect(jobs.filter((j) => j.shift_revision === 2 && j.status === "pending")).toHaveLength(2);
  });

  it("a clock-out correction closes the missed shift and creates its draft rows", async () => {
    const [s] = await db.query<{ id: string }>("select id from shift_instance where employee_id = $1 and work_date = '2026-10-14'", [worker]);
    const c = await requestCorrection(await as(worker, at("11:00", "2026-10-15")), { shiftId: s!.id, field: "clock_out", date: "2026-10-14", time: "18:00", reason: "Forgot to clock out at the site" });
    await decideCorrection(await as(supervisor, at("11:05", "2026-10-15")), { correctionId: c.id, decision: "approved" });
    const rows = await db.query("select 1 from time_entry where shift_id = $1 and is_current", [s!.id]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("leave is decided only by the employee's manager chain or an admin", async () => {
    const r = await requestLeave(await as(worker, at("12:00", "2026-10-15")), { kind: "leave", startDate: "2026-11-02", endDate: "2026-11-03", reason: "Family function" });
    expect(await kind(decideLeave(await as(otherSupervisor, at("12:05", "2026-10-15")), { requestId: r.id, decision: "approved" }))).toBe("forbidden");
    await decideLeave(await as(manager, at("12:10", "2026-10-15")), { requestId: r.id, decision: "approved" });
    const [l] = await db.query<{ status: string; leave_record_id: string | null }>("select status, leave_record_id from leave_request where id = $1", [r.id]);
    expect(l!.status).toBe("approved");
    expect(l!.leave_record_id).toBeTruthy();
  });
});
