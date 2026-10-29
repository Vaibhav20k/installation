/**
 * Attendance reads. Every read first settles this employee's due jobs, so the state shown is correct even
 * if the background runner is late or was restarted (the boundary is effective at its own time).
 */
import type { Db, Queryable } from "../db/client";
import { visibleEmployeeIds, type Actor } from "../auth/permissions";
import type { ShiftSummary } from "@/domain/shift";
import { durationMinutes } from "@/domain/intervals";
import { SHIFT_SELECT, autoCloseStaleShifts, canSeeLeave, processDueJobs, shiftEvents, summarizeShift, type ShiftRow } from "../services/attendance";

export interface ShiftView { shift: ShiftRow; summary: ShiftSummary }

async function view(q: Queryable, s: ShiftRow, now: number): Promise<ShiftView> {
  // Capped at 24 hours: a forgotten clock-out never shows more than that (owner's rule, 28 Oct 2026).
  return { shift: s, summary: summarizeShift(s, await shiftEvents(q, s), now) };
}

/** The shift a worker should see now: an open one, else today's (possibly closed) one. */
export async function currentAttendance(db: Db, actor: Actor, today: string, now: number) {
  await processDueJobs(db, now, actor.id);
  const recent = await db.query<ShiftRow>(`${SHIFT_SELECT} where employee_id = $1 order by work_date desc limit 3`, [actor.id]);
  let current: ShiftView | null = null;
  const missed: ShiftView[] = [];
  for (const s of recent) {
    const v = await view(db, s, now);
    if (s.missed_clock_out) { missed.push(v); continue; }
    if (v.summary.open || s.work_date === today) { current ??= v; }
  }
  const [visit] = current?.shift.visit_id ? await db.query<{ business_id: string; project: string; site_address: string }>(
    "select v.business_id, p.name project, p.site_address from visit v join project p on p.id = v.project_id where v.id = $1", [current.shift.visit_id]) : [];
  const corrections = current ? await db.query<{ id: string; field: string; requested_at: number; status: string; reason: string }>(
    "select id, field, requested_at, status, reason from attendance_correction where shift_id = $1 order by created_at desc", [current.shift.id]) : [];
  return { current, missed, visit: visit ?? null, corrections, serverNow: now };
}

export interface HistoryRow { id: string; work_date: string; timezone: string; t0: number; summary: ShiftSummary; missed: boolean; autoClosed: boolean; otReason: string | null; approvedOtMinutes: number; pendingOtMinutes: number; ineligibleOtMinutes: number; corrections: number }

export async function attendanceHistory(db: Db, employeeId: string, now: number, limit = 31): Promise<HistoryRow[]> {
  await autoCloseStaleShifts(db, now, employeeId);
  const shifts = await db.query<ShiftRow>(`${SHIFT_SELECT} where employee_id = $1 order by work_date desc limit $2`, [employeeId, limit]);
  const out: HistoryRow[] = [];
  for (const s of shifts) {
    const v = await view(db, s, now);
    const ot = await db.query<{ decision: string; lo: number; hi: number }>(
      "select r.decision, lower(r.span) lo, upper(r.span) hi from ot_request r join time_entry e on e.id = r.time_entry_id where e.shift_id = $1", [s.id]);
    const mins = (d: string[]) => ot.filter((r) => d.includes(r.decision)).reduce((n, r) => n + durationMinutes({ start: Number(r.lo), end: Number(r.hi) }), 0);
    const [c] = await db.query<{ n: number }>("select count(*)::int n from attendance_correction where shift_id = $1", [s.id]);
    out.push({ id: s.id, work_date: s.work_date, timezone: s.timezone, t0: Number(s.t0), summary: v.summary, missed: s.missed_clock_out, autoClosed: s.auto_closed, otReason: s.ot_reason,
      approvedOtMinutes: mins(["eligible"]), pendingOtMinutes: mins(["requested", "pending_policy"]), ineligibleOtMinutes: mins(["ineligible"]), corrections: c?.n ?? 0 });
  }
  return out;
}

export interface NotificationRow { id: string; kind: string; title: string; body: string; effective_at: number; created_at: number; overdue: boolean; read_at: number | null; href: string | null }

export async function notificationsFor(db: Db, actorId: string, now: number) {
  await processDueJobs(db, now, actorId);
  const items = await db.query<NotificationRow>("select id, kind, title, body, effective_at, created_at, overdue, read_at, href from notification where employee_id = $1 order by effective_at desc limit 30", [actorId]);
  const [next] = await db.query<{ due_at: number }>(
    "select min(j.due_at) due_at from due_job j join shift_instance s on s.id = j.shift_id where s.employee_id = $1 and j.status = 'pending'", [actorId]);
  return { items, unread: items.filter((n) => !n.read_at).length, nextDueAt: next?.due_at ? Number(next.due_at) : null };
}

/** Manager work queue: missed clock-outs, correction requests and leave requests the actor may decide. */
export async function attendanceExceptions(db: Db, actor: Actor, now: number) {
  if (actor.role === "employee") return { missed: [], corrections: [], leave: [] };
  await autoCloseStaleShifts(db, now);
  const ids = await visibleEmployeeIds(db, actor);
  const scope = ids === "all" ? { sql: "true", params: [] as unknown[] } : { sql: "s.employee_id = any($1::uuid[])", params: [[...ids]] as unknown[] };
  // Includes shifts closed automatically after 24 hours (auto_closed): same queue, flagged.
  const missed = await db.query<{ id: string; employee: string; employee_id: string; work_date: string; t0: number; auto_closed: boolean; auto_closed_at: number | null }>(
    `select s.id, e.name employee, e.id employee_id, s.work_date::text, s.t0, s.auto_closed, s.auto_closed_at from shift_instance s join employee e on e.id = s.employee_id where s.missed_clock_out and ${scope.sql} order by s.work_date desc limit 50`, scope.params);
  const corrections = await db.query<{ id: string; employee: string; employee_id: string; field: string; requested_at: number; reason: string; work_date: string; t0: number }>(
    `select c.id, e.name employee, e.id employee_id, c.field, c.requested_at, c.reason, s.work_date::text, s.t0 from attendance_correction c join shift_instance s on s.id = c.shift_id join employee e on e.id = c.employee_id
     where c.status = 'requested' and ${scope.sql} order by c.created_at limit 50`, scope.params);
  const leaveAll = await db.query<{ id: string; employee: string; employee_id: string; kind: string; start_date: string; end_date: string; reason: string }>(
    `select r.id, e.name employee, e.id employee_id, r.kind, r.start_date::text, r.end_date::text, r.reason from leave_request r join employee e on e.id = r.employee_id where r.status = 'requested' order by r.created_at limit 100`);
  const leave = [];
  for (const l of leaveAll) if (l.employee_id !== actor.id && (await canSeeLeave(db, actor.id, actor.role, l.employee_id))) leave.push(l);
  return { missed: missed.filter((m) => m.employee_id !== actor.id), corrections: corrections.filter((c) => c.employee_id !== actor.id), leave };
}

export async function myRequests(db: Db, actorId: string) {
  const [leave, corrections, overtime] = await Promise.all([
    db.query<{ id: string; kind: string; start_date: string; end_date: string; reason: string; status: string; decision_note: string | null; created_at: number }>(
      "select id, kind, start_date::text, end_date::text, reason, status, decision_note, created_at from leave_request where employee_id = $1 order by created_at desc limit 30", [actorId]),
    db.query<{ id: string; field: string; requested_at: number; reason: string; status: string; decision_note: string | null; work_date: string; created_at: number }>(
      "select c.id, c.field, c.requested_at, c.reason, c.status, c.decision_note, s.work_date::text, c.created_at from attendance_correction c join shift_instance s on s.id = c.shift_id where c.employee_id = $1 order by c.created_at desc limit 30", [actorId]),
    db.query<{ id: string; claimed_reason: string; decision: string; decision_explanation: string | null; lo: number; hi: number; created_at: number }>(
      "select id, claimed_reason, decision, decision_explanation, lower(span) lo, upper(span) hi, created_at from ot_request where employee_id = $1 order by created_at desc limit 30", [actorId]),
  ]);
  return { leave, corrections, overtime };
}
