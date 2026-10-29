/**
 * Attendance: the fixed 8-hour session (docs/shift-contract.md). Clock-in sets an immutable anchor t0 and
 * schedules two durable jobs (reminder at t0+450, overtime at t0+480). State is always derived from server
 * timestamps; jobs only record the transition and notify, exactly once per shift and event.
 */
import { z } from "zod";
import type { Db, Queryable } from "../db/client";
import { audit } from "../audit";
import { forbidSelfApproval, requireEmployeeScope, requireRole } from "../auth/permissions";
import { conflict, forbidden, validation } from "../errors";
import { localDateOf, zonedToUtc } from "@/lib/dates";
import { SHIFT_MESSAGES, draftRows, overtimeAt, summarize, warnAt, type Activity, type ShiftEvent, type ShiftSummary } from "@/domain/shift";
import { durationMinutes, intersect } from "@/domain/intervals";
import { employeeCalendar } from "./time";
import { iso, one, parse, zDate, zId, zTime, type Ctx } from "./context";

export interface ShiftRow {
  id: string; employee_id: string; work_date: string; timezone: string; t0: number; warn_at: number; ot_at: number; revision: number;
  visit_id: string | null; missed_clock_out: boolean; clock_out_override: number | null; ot_reason: string | null; ot_reason_note: string | null; version: number;
  auto_closed: boolean; auto_closed_at: number | null;
}
export const SHIFT_SELECT = `select id, employee_id, work_date::text, timezone, t0, warn_at, ot_at, revision, visit_id, missed_clock_out, clock_out_override, ot_reason, ot_reason_note, version, auto_closed, auto_closed_at from shift_instance`;

/**
 * Owner's rule (28 Oct 2026): an open shift never counts more than 24 hours from its anchor t0. A shift still open
 * then is closed automatically as a missed clock-out: no clock-out time is invented, no timesheet rows are made, and it
 * waits in the manager's queue until a real clock-out time is approved. Hours shown for it stop at the 24-hour mark.
 */
export const MAX_SHIFT_MINUTES = 24 * 60;
export const shiftCapAt = (s: Pick<ShiftRow, "t0">) => Number(s.t0) + MAX_SHIFT_MINUTES * 60_000;
const AUTO_CLOSED_MESSAGE = "This shift was closed automatically after 24 hours without a clock-out. Ask your manager to correct the time.";
const longDate = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(Date.parse(`${d}T00:00:00Z`));

/** Summary for display: never past 24 hours; a missed (or auto-closed) shift is no longer running. */
export function summarizeShift(s: Pick<ShiftRow, "t0" | "missed_clock_out" | "clock_out_override">, events: ShiftEvent[], now: number): ShiftSummary {
  const t0 = Number(s.t0);
  let sum = summarize(t0, events, now);
  if (now > shiftCapAt(s) && sum.open) sum = summarize(t0, events, shiftCapAt(s));
  if (s.missed_clock_out && s.clock_out_override === null) return { ...sum, open: false, activity: null, state: "clocked_out" };
  return sum;
}

export async function shiftEvents(q: Queryable, shift: Pick<ShiftRow, "id" | "clock_out_override">): Promise<ShiftEvent[]> {
  const rows = await q.query<{ kind: ShiftEvent["kind"]; activity: Activity | null; at: number }>(
    "select kind, activity, effective_at at from attendance_event where shift_id = $1 order by effective_at, recorded_at", [shift.id]);
  const events = rows.map((r) => ({ kind: r.kind, activity: r.activity, at: Number(r.at) }));
  if (shift.clock_out_override === null) return events;
  const cut = Number(shift.clock_out_override);
  return [...events.filter((e) => e.at < cut), { kind: "clock_out" as const, at: cut }];
}

async function lockShift(q: Queryable, id: string) {
  return one<ShiftRow>(q, `${SHIFT_SELECT} where id = $1 for update`, [id], "Shift");
}

async function openShift(q: Queryable, employeeId: string, now: number) {
  const recent = await q.query<ShiftRow>(`${SHIFT_SELECT} where employee_id = $1 order by work_date desc limit 3`, [employeeId]);
  for (const s of recent) {
    if (s.missed_clock_out) continue;
    if (!summarize(Number(s.t0), await shiftEvents(q, s), now).open) continue;
    if (now >= shiftCapAt(s)) { await autoCloseShift(q, s.id, now); continue; }
    return s;
  }
  return null;
}

async function scheduleJobs(q: Queryable, shift: { id: string; revision: number; warn_at: number; ot_at: number }) {
  for (const [kind, due] of [["shift_warning", shift.warn_at], ["shift_overtime", shift.ot_at]] as const) {
    // Re-arm after an early clock-out and resume; delivered events never repeat (notification ledger is per shift + event).
    await q.query(`insert into due_job(shift_id, shift_revision, kind, due_at) values ($1,$2,$3,$4)
      on conflict (shift_id, shift_revision, kind) do update set status = 'pending', processed_at = null where due_job.status = 'cancelled'`, [shift.id, shift.revision, kind, iso(Number(due))]);
  }
}

/** The visit the employee is confirmed on today, used as default context for attendance-derived timesheet rows. */
async function todaysVisit(q: Queryable, employeeId: string, now: number) {
  const [v] = await q.query<{ id: string }>(
    `select r.visit_id id from reservation r join visit v on v.id = r.visit_id
     where r.employee_id = $1 and r.state = 'confirmed' and r.span @> $2::timestamptz and v.exec_status in ('scheduled','in_progress') limit 1`, [employeeId, iso(now)]);
  return v?.id ?? null;
}

/**
 * Clock-in photo (user rule, 23 Oct): every clock-in (and same-day re-clock-in) needs a photo that has already
 * uploaded and passed the content check. Returns the asset to link to the punch. Clock-out needs no photo.
 */
async function requireClockInPhoto(q: Queryable, actorId: string, draftKey: string | undefined, now: number) {
  if (!draftKey) throw validation("Take a clock-in photo first.", ["photo: required"]);
  const [a] = await q.query<{ asset_id: string }>(
    `select s.asset_id from upload_session s join evidence_asset a on a.id = s.asset_id
     where s.actor_id = $1 and s.draft_key = $2 and a.state = 'ready' and a.media_type = 'image' and s.created_at > $3::timestamptz
       and not exists (select 1 from evidence_link l where l.asset_id = s.asset_id) order by s.created_at desc limit 1`,
    [actorId, draftKey, iso(now - 15 * 60_000)]);
  if (!a) throw validation("The clock-in photo has not finished uploading, or it is older than 15 minutes. Take it again.", ["photo: required"]);
  return a.asset_id;
}

async function linkClockInPhoto(q: Queryable, assetId: string, eventId: string, actorId: string) {
  await q.query("insert into evidence_link(asset_id, parent_type, parent_id, context, actor_id) values ($1,'attendance_event',$2,'attendance.clock_in',$3) on conflict do nothing", [assetId, eventId, actorId]);
}

export async function clockIn(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ note: z.string().max(300).optional(), photoDraftKey: z.string().uuid().optional() }), input ?? {});
  const me = ctx.actor.id;
  return ctx.db.tx(async (q) => {
    const photo = await requireClockInPhoto(q, me, d.photoDraftKey, ctx.now);
    await q.query("select id from employee where id = $1 for update", [me]);
    const cal = await employeeCalendar(q, me);
    const today = localDateOf(ctx.now, cal.timezone);
    const open = await openShift(q, me, ctx.now);
    if (open && open.work_date === today) throw conflict("You are already clocked in.");
    if (open) {
      // A shift from an earlier date was never closed: keep it provisional for review, never invent its end.
      await q.query("update shift_instance set missed_clock_out = true where id = $1", [open.id]);
      await q.query("update due_job set status = 'cancelled' where shift_id = $1 and status = 'pending'", [open.id]);
      await audit(q, { actorId: me, action: "missed_clock_out", objectType: "shift_instance", objectId: open.id, correlationId: ctx.correlationId });
    }
    const [existing] = await q.query<ShiftRow>(`${SHIFT_SELECT} where employee_id = $1 and work_date = $2 for update`, [me, today]);
    if (existing) {
      // Same-day reopening keeps the original anchor: no second eight-hour allowance.
      const [ev] = await q.query<{ id: string }>("insert into attendance_event(shift_id, kind, effective_at, actor_id, note, shift_revision) values ($1,'resume',$2,$3,$4,$5) returning id", [existing.id, iso(ctx.now), me, d.note ?? null, existing.revision]);
      await linkClockInPhoto(q, photo, ev!.id, me);
      await scheduleJobs(q, existing);
      await audit(q, { actorId: me, action: "resume_shift", objectType: "shift_instance", objectId: existing.id, correlationId: ctx.correlationId });
      return { shiftId: existing.id, resumed: true, t0: Number(existing.t0) };
    }
    const visitId = await todaysVisit(q, me, ctx.now);
    const [s] = await q.query<{ id: string }>(
      `insert into shift_instance(employee_id, work_date, timezone, t0, warn_at, ot_at, visit_id) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [me, today, cal.timezone, iso(ctx.now), iso(warnAt(ctx.now)), iso(overtimeAt(ctx.now)), visitId]);
    const [ev] = await q.query<{ id: string }>("insert into attendance_event(shift_id, kind, effective_at, actor_id, note, shift_revision) values ($1,'clock_in',$2,$3,$4,1) returning id", [s!.id, iso(ctx.now), me, d.note ?? null]);
    await linkClockInPhoto(q, photo, ev!.id, me);
    await scheduleJobs(q, { id: s!.id, revision: 1, warn_at: warnAt(ctx.now), ot_at: overtimeAt(ctx.now) });
    await audit(q, { actorId: me, action: "clock_in", objectType: "shift_instance", objectId: s!.id, correlationId: ctx.correlationId });
    return { shiftId: s!.id, resumed: false, t0: ctx.now };
  });
}

export async function setActivity(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ shiftId: zId, activity: z.enum(["working", "break", "idle", "travel"]), note: z.string().max(300).optional() }), input);
  return ctx.db.tx(async (q) => {
    const s = await lockShift(q, d.shiftId);
    if (s.employee_id !== ctx.actor.id) throw forbidden("You can change only your own activity.");
    const sum = summarize(Number(s.t0), await shiftEvents(q, s), ctx.now);
    if (!sum.open) throw conflict("Clock in first.");
    if (s.missed_clock_out || ctx.now >= shiftCapAt(s)) throw conflict(AUTO_CLOSED_MESSAGE);
    if (sum.activity === d.activity) return { activity: d.activity };
    if (d.activity === "idle" && !d.note?.trim()) throw validation("Say what is holding the work up (power, access, material…).", ["note: required"]);
    const [ev] = await q.query<{ id: string }>("insert into attendance_event(shift_id, kind, activity, effective_at, actor_id, note, shift_revision) values ($1,'activity',$2,$3,$4,$5,$6) returning id",
      [s.id, d.activity, iso(ctx.now), ctx.actor.id, d.note ?? null, s.revision]);
    return { activity: d.activity, eventId: ev!.id };
  });
}

const OT_REASON_TEXT: Record<string, string> = {
  catch_up: "Finishing today's original target (catch-up)", future_task: "Tomorrow's task brought forward", additional_work: "Approved additional customer work",
  external_delay: "Site, material or equipment delay", other: "Other documented reason",
};

export async function setOvertimeReason(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ shiftId: zId, reason: z.enum(["catch_up", "future_task", "additional_work", "external_delay", "other"]), note: z.string().max(300).optional() }), input);
  return ctx.db.tx(async (q) => {
    const s = await lockShift(q, d.shiftId);
    if (s.employee_id !== ctx.actor.id) throw forbidden("You can explain only your own overtime.");
    if (ctx.now < Number(s.ot_at)) throw conflict("Overtime recording has not started for this shift.");
    if (d.reason === "other" && !d.note?.trim()) throw validation("Describe the reason.", ["note: required"]);
    await q.query("update shift_instance set ot_reason = $2, ot_reason_note = $3 where id = $1", [s.id, d.reason, d.note ?? null]);
    // Keep any automatic overtime candidates in step while they are still unreviewed.
    await q.query("update ot_request set claimed_reason = $2 where decision = 'requested' and reviewer_id is null and time_entry_id in (select id from time_entry where shift_id = $1)",
      [s.id, `${OT_REASON_TEXT[d.reason]}${d.note ? `: ${d.note}` : ""}`]);
    await audit(q, { actorId: ctx.actor.id, action: "overtime_reason", objectType: "shift_instance", objectId: s.id, after: d, correlationId: ctx.correlationId });
    return { reason: d.reason, catchUp: d.reason === "catch_up", message: d.reason === "catch_up" ? SHIFT_MESSAGES.catchUp : null };
  });
}

export async function clockOut(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ shiftId: zId }), input);
  return ctx.db.tx(async (q) => {
    const s = await lockShift(q, d.shiftId);
    if (s.employee_id !== ctx.actor.id) throw forbidden("You can clock out only yourself.");
    // Record any boundary strictly before this clock-out, effective at its own time. A clock-out exactly at
    // t0+480 creates no overtime session: the boundary job at that same instant is cancelled, not run.
    await processShiftJobs(q, s, ctx.now - 1);
    const events = await shiftEvents(q, s);
    if (!summarize(Number(s.t0), events, ctx.now).open) throw conflict("You are already clocked out.");
    if (s.missed_clock_out || ctx.now >= shiftCapAt(s)) throw conflict(AUTO_CLOSED_MESSAGE);
    await q.query("insert into attendance_event(shift_id, kind, effective_at, actor_id, shift_revision) values ($1,'clock_out',$2,$3,$4)", [s.id, iso(ctx.now), ctx.actor.id, s.revision]);
    await q.query("update due_job set status = 'cancelled' where shift_id = $1 and status = 'pending'", [s.id]);
    const sheet = await draftTimesheet(q, ctx, s, ctx.now);
    await audit(q, { actorId: ctx.actor.id, action: "clock_out", objectType: "shift_instance", objectId: s.id, after: sheet, correlationId: ctx.correlationId });
    const sum = summarize(Number(s.t0), [...events, { kind: "clock_out", at: ctx.now }], ctx.now);
    return { ...sheet, regularWorkMinutes: Math.round(sum.regularWorkMinutes), recordedOvertimeWorkMinutes: Math.round(sum.recordedOvertimeWorkMinutes) };
  });
}

/**
 * Draft timesheet rows from the shift. Rows already submitted stay untouched; only the not-yet-submitted part is
 * (re)generated. Work after t0+480 becomes an automatic overtime candidate: recorded, never approved by this step.
 */
async function draftTimesheet(q: Queryable, ctx: Ctx, s: ShiftRow, now: number) {
  const events = await shiftEvents(q, s);
  const kept = await q.query<{ hi: number }>("select upper(span) hi from time_entry where shift_id = $1 and is_current and state not in ('draft','voided')", [s.id]);
  const cutoff = kept.reduce((m, r) => Math.max(m, Number(r.hi)), 0);
  const oldDrafts = await q.query<{ id: string }>("select id from time_entry where shift_id = $1 and is_current and state = 'draft'", [s.id]);
  if (oldDrafts.length) {
    const ids = oldDrafts.map((r) => r.id);
    await q.query("delete from ot_request where time_entry_id = any($1::uuid[]) and decision = 'requested' and reviewer_id is null", [ids]);
    await q.query("update time_entry set state = 'voided', is_current = false where id = any($1::uuid[])", [ids]);
  }
  const [visit] = s.visit_id ? await q.query<{ project_id: string }>("select project_id from visit where id = $1", [s.visit_id]) : [];
  const created: string[] = [], skipped: string[] = [];
  let otMinutes = 0;
  for (const r of draftRows(events, now)) {
    const start = Math.max(r.start, cutoff);
    if (r.end - start < 60_000) continue;
    const span = { start, end: r.end };
    const clash = await q.query("select 1 from time_entry where employee_id = $1 and is_current and state <> 'voided' and span && tstzrange($2::timestamptz,$3::timestamptz) limit 1", [s.employee_id, iso(span.start), iso(span.end)]);
    if (clash.length) { skipped.push(`${new Date(span.start).toISOString()}–${new Date(span.end).toISOString()}`); continue; }
    const [e] = await q.query<{ id: string }>(
      `insert into time_entry(employee_id, project_id, visit_id, overhead_category, activity, span, is_exception, exception_note, note, shift_id, created_by)
       values ($1,$2,$3,$4,$5,tstzrange($6::timestamptz,$7::timestamptz),$8,$9,'From attendance',$10,$11) returning id`,
      [s.employee_id, visit?.project_id ?? null, s.visit_id, visit ? null : "attendance_unassigned", r.activity, iso(span.start), iso(span.end),
        !visit, visit ? null : "Recorded from attendance without a booked visit; assign the project before submitting.", s.id, ctx.actor.id]);
    for (const b of r.breaks) if (b.start >= span.start) await q.query("insert into break_interval(time_entry_id, span) values ($1, tstzrange($2::timestamptz,$3::timestamptz))", [e!.id, iso(b.start), iso(b.end)]);
    created.push(e!.id);
    if (r.activity === "installation") {
      const [ot] = intersect([span], [{ start: Number(s.ot_at), end: Math.max(span.end, Number(s.ot_at)) }]);
      if (ot && ot.end > ot.start) {
        otMinutes += durationMinutes(ot);
        await q.query("insert into ot_request(employee_id, time_entry_id, span, claimed_reason, created_by) values ($1,$2,tstzrange($3::timestamptz,$4::timestamptz),$5,$6)",
          [s.employee_id, e!.id, iso(ot.start), iso(ot.end), s.ot_reason ? `${OT_REASON_TEXT[s.ot_reason]}${s.ot_reason_note ? `: ${s.ot_reason_note}` : ""}` : "Recorded automatically after 8 hours; reason not given yet", s.employee_id]);
      }
    }
  }
  await q.query("update shift_instance set timesheet_generated_at = $2 where id = $1", [s.id, iso(now)]);
  return { draftEntries: created.length, skippedOverlaps: skipped, overtimeCandidateMinutes: otMinutes };
}

/** A note on today's attendance (photos/videos link to it). Notes never change punches or durations. */
export async function addAttendanceNote(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ shiftId: zId, note: z.string().min(1).max(500) }), input);
  return ctx.db.tx(async (q) => {
    const s = await lockShift(q, d.shiftId);
    if (s.employee_id !== ctx.actor.id) throw forbidden("Add notes to your own attendance.");
    const [e] = await q.query<{ id: string }>("insert into attendance_event(shift_id, kind, effective_at, actor_id, note, shift_revision) values ($1,'note',$2,$3,$4,$5) returning id",
      [s.id, iso(ctx.now), ctx.actor.id, d.note, s.revision]);
    return { id: e!.id };
  });
}

// ---------- Corrections (regularization) ----------

export async function requestCorrection(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ shiftId: zId, field: z.enum(["clock_in", "clock_out"]), date: zDate, time: zTime, reason: z.string().min(5).max(500) }), input);
  return ctx.db.tx(async (q) => {
    const s = await lockShift(q, d.shiftId);
    if (s.employee_id !== ctx.actor.id) throw forbidden("Request corrections for your own attendance.");
    const at = zonedToUtc(d.date, d.time, s.timezone);
    if (at > ctx.now) throw validation("A corrected time cannot be in the future.");
    if (d.field === "clock_out" && at > shiftCapAt(s)) throw validation("A shift cannot be longer than 24 hours. Check the date and time.", ["time: within 24 hours of clock-in"]);
    const [pending] = await q.query("select 1 from attendance_correction where shift_id = $1 and field = $2 and status = 'requested'", [s.id, d.field]);
    if (pending) throw conflict("A correction for this is already waiting for review.");
    const [c] = await q.query<{ id: string }>("insert into attendance_correction(shift_id, employee_id, field, requested_at, reason) values ($1,$2,$3,$4,$5) returning id",
      [s.id, s.employee_id, d.field, iso(at), d.reason]);
    await audit(q, { actorId: ctx.actor.id, action: "request_correction", objectType: "attendance_correction", objectId: c!.id, after: d, correlationId: ctx.correlationId });
    return { id: c!.id };
  });
}

export async function decideCorrection(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ correctionId: zId, decision: z.enum(["approved", "rejected"]), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "attendance corrections");
  return ctx.db.tx(async (q) => {
    const c = await one<{ id: string; shift_id: string; employee_id: string; field: "clock_in" | "clock_out"; requested_at: number; status: string }>(q,
      "select id, shift_id, employee_id, field, requested_at, status from attendance_correction where id = $1 for update", [d.correctionId], "Correction");
    forbidSelfApproval(ctx.actor, c.employee_id, "attendance correction");
    await requireEmployeeScope(q, ctx.actor, c.employee_id);
    if (c.status !== "requested") throw conflict(`This correction is already ${c.status}.`);
    await q.query("update attendance_correction set status = $2, decided_by = $3, decided_at = $4, decision_note = $5 where id = $1", [c.id, d.decision, ctx.actor.id, iso(ctx.now), d.note ?? null]);
    if (d.decision === "approved") {
      const s = await lockShift(q, c.shift_id);
      const at = Number(c.requested_at);
      const rev = s.revision + 1;
      if (c.field === "clock_in") {
        await q.query("update shift_instance set t0 = $2, warn_at = $3, ot_at = $4, revision = $5, version = version + 1 where id = $1", [s.id, iso(at), iso(warnAt(at)), iso(overtimeAt(at)), rev]);
        await q.query("update due_job set status = 'superseded' where shift_id = $1 and status = 'pending'", [s.id]);
        const open = summarize(at, await shiftEvents(q, s), ctx.now).open;
        if (open) await scheduleJobs(q, { id: s.id, revision: rev, warn_at: warnAt(at), ot_at: overtimeAt(at) });
      } else {
        if (at <= Number(s.t0)) throw validation("Clock-out must be after clock-in.");
        if (at > shiftCapAt(s)) throw validation("A shift cannot be longer than 24 hours.");
        await q.query("update shift_instance set clock_out_override = $2, missed_clock_out = false, revision = $3, version = version + 1 where id = $1", [s.id, iso(at), rev]);
        await q.query("update due_job set status = 'cancelled' where shift_id = $1 and status = 'pending'", [s.id]);
      }
      await q.query("insert into attendance_event(shift_id, kind, effective_at, actor_id, note, shift_revision) values ($1,'correction',$2,$3,$4,$5)",
        [s.id, iso(at), ctx.actor.id, `${c.field} corrected (request ${c.id})`, rev]);
      const fresh = await lockShift(q, s.id);
      if (!summarize(Number(fresh.t0), await shiftEvents(q, fresh), ctx.now).open) await draftTimesheet(q, ctx, fresh, ctx.now);
    }
    await audit(q, { actorId: ctx.actor.id, action: `correction_${d.decision}`, objectType: "attendance_correction", objectId: c.id, after: d, correlationId: ctx.correlationId });
    return { id: c.id, decision: d.decision };
  });
}

// ---------- Durable due jobs ----------

async function notify(q: Queryable, n: { employeeId: string; shiftId: string; kind: string; title: string; body: string; dedupe: string; effectiveAt: number; overdue?: boolean; href?: string }) {
  await q.query(`insert into notification(employee_id, shift_id, kind, title, body, dedupe_key, effective_at, overdue, href) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (dedupe_key) do nothing`,
    [n.employeeId, n.shiftId, n.kind, n.title, n.body, n.dedupe, iso(n.effectiveAt), n.overdue ?? false, n.href ?? null]);
}

/** The worker-facing warning for a shift closed after 24 hours (in-app only). */
export const autoClosedMessage = (workDate: string) =>
  `You didn't clock out on ${longDate(workDate)}. We closed that shift automatically after 24 hours. Ask your manager to correct the time.`;

/**
 * Close one shift that is still open 24 hours after t0. Runs inside the caller's transaction under the shift row
 * lock and re-checks everything, so repeats, two tabs and the runner racing a read close it (and warn) once.
 */
async function autoCloseShift(q: Queryable, shiftId: string, now: number) {
  const s = await lockShift(q, shiftId);
  if (s.missed_clock_out || s.clock_out_override !== null || now < shiftCapAt(s)) return false;
  if (!summarize(Number(s.t0), await shiftEvents(q, s), now).open) return false;
  await processShiftJobs(q, s, now); // settle the 7:30 / 8:00 boundaries first, effective at their own times
  await q.query("update shift_instance set missed_clock_out = true, auto_closed = true, auto_closed_at = $2, version = version + 1 where id = $1", [s.id, iso(now)]);
  await q.query("update due_job set status = 'cancelled' where shift_id = $1 and status = 'pending'", [s.id]);
  await notify(q, { employeeId: s.employee_id, shiftId: s.id, kind: "shift_auto_closed", title: "You didn't clock out", body: autoClosedMessage(s.work_date),
    dedupe: `${s.id}:shift_auto_closed`, effectiveAt: shiftCapAt(s), href: `/attendance#shift-${s.id}` });
  await audit(q, { actorId: null, action: "shift_auto_closed", objectType: "shift_instance", objectId: s.id, after: { autoClosedAt: now, capAt: shiftCapAt(s) } });
  return true;
}

/** Close every shift (or one employee's) still open past 24 hours. Used by the runner and every attendance read. */
export async function autoCloseStaleShifts(db: Db, now: number, employeeId?: string) {
  const cutoff = iso(now - MAX_SHIFT_MINUTES * 60_000);
  const stale = await db.query<{ id: string }>(
    `select s.id from shift_instance s where not s.missed_clock_out and s.clock_out_override is null and s.t0 <= $1 ${employeeId ? "and s.employee_id = $2" : ""}
       and coalesce((select e.kind from attendance_event e where e.shift_id = s.id and e.kind in ('clock_in','resume','clock_out') order by e.effective_at desc, e.recorded_at desc limit 1), 'clock_out') <> 'clock_out'
     limit 200`, employeeId ? [cutoff, employeeId] : [cutoff]);
  let n = 0;
  for (const { id } of stale) if (await db.tx((q) => autoCloseShift(q, id, now))) n++;
  return n;
}

/** Process this shift's due jobs. Idempotent: unique keys make repeats, restarts and multiple tabs harmless. */
async function processShiftJobs(q: Queryable, s: ShiftRow, now: number) {
  const jobs = await q.query<{ id: string; kind: string; due_at: number; shift_revision: number }>(
    "select id, kind, due_at, shift_revision from due_job where shift_id = $1 and status = 'pending' and due_at <= $2 order by due_at", [s.id, iso(now)]);
  if (!jobs.length) return 0;
  const events = await shiftEvents(q, s);
  for (const j of jobs) {
    if (j.shift_revision !== s.revision) { await q.query("update due_job set status = 'superseded', processed_at = $2 where id = $1", [j.id, iso(now)]); continue; }
    const due = Number(j.due_at);
    const openAtDue = summarize(Number(s.t0), events, due).open;
    if (openAtDue) {
      if (j.kind === "shift_warning") {
        const late = now >= Number(s.ot_at);
        await notify(q, { employeeId: s.employee_id, shiftId: s.id, kind: "shift_warning", title: late ? "Reminder (overdue)" : "30 minutes of regular time left",
          body: late ? `${SHIFT_MESSAGES.warning} (This reminder was due at ${new Date(due).toISOString()} and is now past.)` : SHIFT_MESSAGES.warning,
          dedupe: `${s.id}:shift_warning`, effectiveAt: due, overdue: late });
      } else {
        await q.query("insert into attendance_event(shift_id, kind, effective_at, note, shift_revision) values ($1,'overtime_started',$2,'Automatic at clock-in + 8 hours',$3) on conflict do nothing", [s.id, iso(due), s.revision]);
        await notify(q, { employeeId: s.employee_id, shiftId: s.id, kind: "shift_overtime", title: "Overtime recording started", body: SHIFT_MESSAGES.overtime, dedupe: `${s.id}:shift_overtime`, effectiveAt: due });
      }
    }
    await q.query("update due_job set status = 'done', attempts = attempts + 1, processed_at = $2 where id = $1", [j.id, iso(now)]);
  }
  return jobs.length;
}

/** Background runner and read-path entry point. Optionally limited to one employee. */
export async function processDueJobs(db: Db, now: number, employeeId?: string) {
  const due = await db.query<{ shift_id: string }>(
    `select distinct j.shift_id from due_job j join shift_instance s on s.id = j.shift_id where j.status = 'pending' and j.due_at <= $1 ${employeeId ? "and s.employee_id = $2" : ""} limit 200`,
    employeeId ? [iso(now), employeeId] : [iso(now)]);
  let n = 0;
  for (const { shift_id } of due) n += await db.tx(async (q) => processShiftJobs(q, await lockShift(q, shift_id), now));
  return n + await autoCloseStaleShifts(db, now, employeeId);
}

// ---------- Leave and emergency unavailability ----------

export async function requestLeave(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ kind: z.enum(["leave", "emergency_unavailability"]), startDate: zDate, endDate: zDate, reason: z.string().min(3).max(500) }), input);
  if (d.endDate < d.startDate) throw validation("The end date is before the start date.");
  return ctx.db.tx(async (q) => {
    const [r] = await q.query<{ id: string }>("insert into leave_request(employee_id, kind, start_date, end_date, reason) values ($1,$2,$3,$4,$5) returning id", [ctx.actor.id, d.kind, d.startDate, d.endDate, d.reason]);
    await audit(q, { actorId: ctx.actor.id, action: "request_leave", objectType: "leave_request", objectId: r!.id, after: { kind: d.kind, startDate: d.startDate, endDate: d.endDate }, correlationId: ctx.correlationId });
    return { id: r!.id };
  });
}

/** Leave is decided by the employee's own manager chain or an administrator, not by any project manager. */
export async function canSeeLeave(q: Queryable, actorId: string, actorRole: string, employeeId: string) {
  if (actorId === employeeId || actorRole === "admin") return true;
  const [r] = await q.query("with recursive chain(id, manager_id) as (select id, manager_id from employee where id = $1 union select e.id, e.manager_id from employee e join chain c on e.id = c.manager_id) select 1 from chain where manager_id = $2 limit 1", [employeeId, actorId]);
  return !!r;
}

export async function decideLeave(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ requestId: zId, decision: z.enum(["approved", "rejected"]), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "leave decisions");
  return ctx.db.tx(async (q) => {
    const r = await one<{ id: string; employee_id: string; kind: string; start_date: string; end_date: string; status: string }>(q,
      "select id, employee_id, kind, start_date::text, end_date::text, status from leave_request where id = $1 for update", [d.requestId], "Leave request");
    forbidSelfApproval(ctx.actor, r.employee_id, "leave request");
    if (!(await canSeeLeave(q, ctx.actor.id, ctx.actor.role, r.employee_id))) throw forbidden("Only the employee's manager chain or an administrator decides leave.");
    if (r.status !== "requested") throw conflict(`This request is already ${r.status}.`);
    let leaveId: string | null = null;
    if (d.decision === "approved") {
      const tz = (await employeeCalendar(q, r.employee_id)).timezone;
      const [l] = await q.query<{ id: string }>("insert into leave_record(employee_id, span, kind, status) values ($1, tstzrange($2::timestamptz,$3::timestamptz), $4, 'approved') returning id",
        [r.employee_id, iso(zonedToUtc(r.start_date, "00:00", tz)), iso(zonedToUtc(r.end_date, "23:59", tz) + 60_000), r.kind]);
      leaveId = l!.id;
    }
    await q.query("update leave_request set status = $2, decided_by = $3, decided_at = $4, decision_note = $5, leave_record_id = $6 where id = $1", [r.id, d.decision, ctx.actor.id, iso(ctx.now), d.note ?? null, leaveId]);
    await audit(q, { actorId: ctx.actor.id, action: `leave_${d.decision}`, objectType: "leave_request", objectId: r.id, after: d, correlationId: ctx.correlationId });
    return { id: r.id, decision: d.decision };
  });
}

export async function markNotificationsRead(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ ids: z.array(zId).max(100).optional() }), input ?? {});
  await ctx.db.query(`update notification set read_at = $2 where employee_id = $1 and read_at is null ${d.ids ? "and id = any($3::uuid[])" : ""}`,
    d.ids ? [ctx.actor.id, iso(ctx.now), d.ids] : [ctx.actor.id, iso(ctx.now)]);
  return { ok: true };
}
