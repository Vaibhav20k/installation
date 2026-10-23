/**
 * Installation schedules: lay a template onto a visit from a start date, then tick days off on site.
 * Supervisors and above edit; the schedule is what the customer is shown.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { layoutSchedule, type ScheduleStep } from "@/domain/install-schedule";
import { loadVisit } from "./plan-support";
import { iso, one, parse, zDate, zId, type Ctx } from "./context";

export async function scheduleCalendar(q: Queryable, projectId?: string) {
  const [cal] = await q.query<{ week_pattern: Record<string, unknown> }>("select week_pattern from work_calendar order by created_at limit 1");
  const workingWeekdays = Object.keys(cal?.week_pattern ?? { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }).map(Number);
  const holidays = Object.fromEntries((await q.query<{ date: string; name: string }>("select date::text, name from holiday")).map((h) => [h.date, h.name]));
  return { workingWeekdays, holidays, siteWeekdays: projectId ? await siteWeekdays(q, projectId) : undefined };
}

/** Weekdays the site allows work on, from its current recorded window; undefined when no window is recorded. */
export async function siteWeekdays(q: Queryable, projectId: string): Promise<number[] | undefined> {
  const [r] = await q.query<{ allowed_weekdays: number[] }>("select allowed_weekdays from site_restriction where project_id = $1 and active order by created_at desc limit 1", [projectId]);
  return r?.allowed_weekdays;
}

export async function applySchedule(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, templateCode: z.string().min(1).max(60), startDate: zDate }), input);
  requireRole(ctx.actor, "supervisor", "installation schedules");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId, true);
    await requireProjectScope(q, ctx.actor, v.project_id);
    if (["completed", "closed", "cancelled"].includes(v.exec_status)) throw conflict(`This visit is ${v.exec_status}; its schedule is final.`);
    const t = await one<{ steps: ScheduleStep[]; name: string }>(q, "select steps, name from schedule_template where code = $1", [d.templateCode], "Schedule template");
    const [started] = await q.query("select 1 from visit_schedule_day where visit_id = $1 and status <> 'planned' limit 1", [d.visitId]);
    if (started) throw conflict("Days on this schedule are already ticked off; adjust days individually instead of replacing it.");
    const { workingWeekdays, holidays, siteWeekdays: siteDays } = await scheduleCalendar(q, v.project_id);
    const days = layoutSchedule(t.steps, d.startDate, workingWeekdays, holidays, siteDays);
    if (!days.length) throw validation("The template has no working days.");
    await q.query("delete from visit_schedule_day where visit_id = $1", [d.visitId]);
    for (const day of days) {
      await q.query(`insert into visit_schedule_day(visit_id, template_code, day_date, kind, step_no, step_name, off_reason) values ($1,$2,$3,$4,$5,$6,$7)`,
        [d.visitId, d.templateCode, day.date, day.kind, day.stepNo, day.stepName, day.offReason]);
    }
    const end = days[days.length - 1]!.date, workDays = days.filter((x) => x.kind === "work").length;
    await audit(q, { actorId: ctx.actor.id, action: "apply_schedule", objectType: "visit", objectId: d.visitId, after: { template: d.templateCode, start: days[0]!.date, end, workDays }, correlationId: ctx.correlationId });
    return { start: days[0]!.date, end, workDays, outsideBooking: !!(v.planned_end && end > v.planned_end) || !!(v.planned_start && days[0]!.date < v.planned_start) };
  });
}

export async function setScheduleDay(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ dayId: zId, status: z.enum(["planned", "done", "delayed"]), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "ticking off schedule days");
  return ctx.db.tx(async (q) => {
    const day = await one<{ project_id: string; kind: string; day_date: string; status: string }>(q,
      `select v.project_id, s.kind, s.day_date::text, s.status from visit_schedule_day s join visit v on v.id = s.visit_id where s.id = $1 for update of s`, [d.dayId], "Schedule day");
    await requireProjectScope(q, ctx.actor, day.project_id);
    if (day.kind === "off") throw validation("Off days have no work to tick off.");
    if (d.status === "delayed" && !d.note?.trim()) throw validation("Say why the day slipped; the customer may ask.", ["note: required"]);
    await q.query("update visit_schedule_day set status = $2, note = $3, updated_at = $4, updated_by = $5 where id = $1", [d.dayId, d.status, d.note ?? null, iso(ctx.now), ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "set_schedule_day", objectType: "visit_schedule_day", objectId: d.dayId, before: { status: day.status }, after: d, reason: d.note, correlationId: ctx.correlationId });
    return { id: d.dayId, status: d.status };
  });
}
