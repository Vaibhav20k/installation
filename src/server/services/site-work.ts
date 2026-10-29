/**
 * Manager's dated work plan for a visit and the workers' daily checklist. A task spans actual plan dates; its
 * checklist items are dated and shared by the task's team, so one tick counts once however many people are
 * assigned. A tick is "worker reported" only: quantity acceptance and customer sign-off stay with the visit's
 * existing execution steps. Reschedules and reopenings keep their history; nothing is silently erased.
 */
import { z } from "zod";
import { audit } from "../audit";
import { atLeast, requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, forbidden, validation } from "../errors";
import { datesBetween, dayDiff } from "@/lib/dates";
import { one, parse, zDate, zId, zVersion, type Ctx } from "./context";
import type { Queryable } from "../db/client";

const MAX_DAYS = 62;
const zLines = z.array(z.string().trim().min(2).max(200)).max(12);

async function visitFor(q: Queryable, visitId: string) {
  return one<{ project_id: string; exec_status: string }>(q, "select project_id, exec_status from visit where id = $1", [visitId], "Visit");
}

async function event(q: Queryable, itemId: string, kind: string, before: unknown, after: unknown, reason: string | null, actorId: string) {
  await q.query("insert into site_work_item_event(item_id, kind, before, after, reason, actor_id) values ($1,$2,$3,$4,$5,$6)",
    [itemId, kind, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), reason, actorId]);
}

/** Assignees must be on the visit's team (proposed, held or confirmed). */
async function checkAssignees(q: Queryable, visitId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await q.query<{ employee_id: string }>("select distinct employee_id from reservation where visit_id = $1 and employee_id = any($2::uuid[]) and state in ('proposed','held','confirmed')", [visitId, ids]);
  const missing = ids.filter((id) => !rows.some((r) => r.employee_id === id));
  if (missing.length) throw validation("Assign only people on this visit's team.", [`${missing.length} selected ${missing.length === 1 ? "person is" : "people are"} not on the team`]);
}

export async function createWorkTask(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    visitId: zId, title: z.string().trim().min(3).max(120), description: z.string().trim().max(1000).optional(),
    startDate: zDate, dueDate: zDate, assigneeIds: z.array(zId).max(20).default([]), checklist: zLines.default([]),
  }), input);
  requireRole(ctx.actor, "manager", "planning site work");
  if (d.dueDate < d.startDate) throw validation("The due date is before the start date.");
  if (dayDiff(d.startDate, d.dueDate) + 1 > MAX_DAYS) throw validation(`A task can span at most ${MAX_DAYS} days. Split longer work into several tasks.`);
  return ctx.db.tx(async (q) => {
    const v = await visitFor(q, d.visitId);
    await requireProjectScope(q, ctx.actor, v.project_id);
    if (["completed", "closed", "cancelled"].includes(v.exec_status)) throw conflict(`This visit is ${v.exec_status}.`);
    const people = [...new Set(d.assigneeIds)];
    await checkAssignees(q, d.visitId, people);
    const [t] = await q.query<{ id: string }>(
      "insert into site_work_task(visit_id, title, description, start_date, due_date, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
      [d.visitId, d.title, d.description ?? null, d.startDate, d.dueDate, ctx.actor.id]);
    for (const p of people) await q.query("insert into site_work_assignee(task_id, employee_id) values ($1,$2)", [t!.id, p]);
    // Each checklist line is repeated on every date of the task, so a multi-day task has a list per day.
    for (const date of datesBetween(d.startDate, d.dueDate)) for (const line of d.checklist) {
      await q.query("insert into site_work_item(task_id, item_date, original_date, text, created_by) values ($1,$2,$2,$3,$4)", [t!.id, date, line, ctx.actor.id]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "create_work_task", objectType: "site_work_task", objectId: t!.id, after: d, correlationId: ctx.correlationId });
    return { taskId: t!.id };
  });
}

async function lockTask(q: Queryable, taskId: string) {
  return one<{ id: string; visit_id: string; project_id: string; start_date: string; due_date: string; status: string; version: number }>(q,
    "select t.id, t.visit_id, v.project_id, t.start_date::text, t.due_date::text, t.status, t.version from site_work_task t join visit v on v.id = t.visit_id where t.id = $1 for update of t", [taskId], "Task");
}

export async function updateWorkTask(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    taskId: zId, version: zVersion, title: z.string().trim().min(3).max(120).optional(), description: z.string().trim().max(1000).nullable().optional(),
    assigneeIds: z.array(zId).max(20).optional(), cancelled: z.boolean().optional(), reason: z.string().trim().min(3).max(300),
  }), input);
  requireRole(ctx.actor, "manager", "planning site work");
  return ctx.db.tx(async (q) => {
    const t = await lockTask(q, d.taskId);
    await requireProjectScope(q, ctx.actor, t.project_id);
    if (t.version !== d.version) throw conflict("This task changed since you opened it. Reload to see the latest.");
    if (d.assigneeIds) {
      const people = [...new Set(d.assigneeIds)];
      await checkAssignees(q, t.visit_id, people);
      await q.query("delete from site_work_assignee where task_id = $1", [t.id]);
      for (const p of people) await q.query("insert into site_work_assignee(task_id, employee_id) values ($1,$2)", [t.id, p]);
    }
    await q.query(`update site_work_task set title = coalesce($2, title), description = case when $3::boolean then $4 else description end,
      status = case when $5::boolean then 'cancelled' else status end, version = version + 1, updated_at = now(), updated_by = $6 where id = $1`,
      [t.id, d.title ?? null, d.description !== undefined, d.description ?? null, d.cancelled === true, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: d.cancelled ? "cancel_work_task" : "update_work_task", objectType: "site_work_task", objectId: t.id, before: t, after: d, reason: d.reason, correlationId: ctx.correlationId });
    return { taskId: t.id };
  });
}

/** Adds dated checklist items to an existing task (one line on each chosen date). */
export async function addWorkItems(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ taskId: zId, dates: z.array(zDate).min(1).max(MAX_DAYS), lines: zLines.min(1) }), input);
  requireRole(ctx.actor, "manager", "planning site work");
  return ctx.db.tx(async (q) => {
    const t = await lockTask(q, d.taskId);
    await requireProjectScope(q, ctx.actor, t.project_id);
    if (t.status === "cancelled") throw conflict("This task is cancelled.");
    const outside = d.dates.filter((x) => x < t.start_date || x > t.due_date);
    if (outside.length) throw validation("Items must fall within the task's dates. Change the task dates first.", outside);
    let n = 0;
    for (const date of [...new Set(d.dates)]) for (const line of d.lines) {
      await q.query("insert into site_work_item(task_id, item_date, original_date, text, created_by) values ($1,$2,$2,$3,$4)", [t.id, date, line, ctx.actor.id]); n++;
    }
    await audit(q, { actorId: ctx.actor.id, action: "add_work_items", objectType: "site_work_task", objectId: t.id, after: d, correlationId: ctx.correlationId });
    return { added: n };
  });
}

/**
 * Tick or untick a checklist item. Allowed for the task's assignees, or a supervisor or above with the
 * project in scope (recorded as the actor). The tick is idempotent; every change is kept in the item's events.
 */
export async function setWorkItemDone(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ itemId: zId, done: z.boolean(), reason: z.string().trim().max(300).optional() }), input);
  return ctx.db.tx(async (q) => {
    const it = await one<{ id: string; task_id: string; project_id: string; status: string; cancelled: boolean; reported_done_at: number | null; item_date: string }>(q,
      `select i.id, i.task_id, v.project_id, t.status, i.cancelled, i.reported_done_at, i.item_date::text from site_work_item i
       join site_work_task t on t.id = i.task_id join visit v on v.id = t.visit_id where i.id = $1 for update of i`, [d.itemId], "Checklist item");
    const [assigned] = await q.query("select 1 from site_work_assignee where task_id = $1 and employee_id = $2", [it.task_id, ctx.actor.id]);
    if (!assigned) {
      if (!atLeast(ctx.actor, "supervisor")) throw forbidden("This item is not on a task assigned to you.");
      await requireProjectScope(q, ctx.actor, it.project_id);
    }
    if (it.cancelled || it.status === "cancelled") throw conflict("This item was cancelled.");
    const isDone = it.reported_done_at !== null;
    if (isDone === d.done) return { itemId: it.id, already: true };
    if (!d.done && !(d.reason && d.reason.length >= 3)) throw validation("Say why the item is not done after all.");
    await q.query("update site_work_item set reported_done_at = $2, reported_done_by = $3, version = version + 1 where id = $1",
      [it.id, d.done ? new Date(ctx.now).toISOString() : null, d.done ? ctx.actor.id : null]);
    await event(q, it.id, d.done ? "reported_done" : "reopened", { done: isDone }, { done: d.done }, d.reason ?? null, ctx.actor.id);
    return { itemId: it.id, already: false };
  });
}

/** Move an unfinished item to another date of its task. The original planned date stays on the item. */
export async function rescheduleWorkItem(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ itemId: zId, version: zVersion, date: zDate, reason: z.string().trim().min(3).max(300) }), input);
  requireRole(ctx.actor, "manager", "rescheduling site work");
  return ctx.db.tx(async (q) => {
    const it = await one<{ id: string; item_date: string; version: number; reported_done_at: number | null; start_date: string; due_date: string; project_id: string }>(q,
      `select i.id, i.item_date::text, i.version, i.reported_done_at, t.start_date::text, t.due_date::text, v.project_id from site_work_item i
       join site_work_task t on t.id = i.task_id join visit v on v.id = t.visit_id where i.id = $1 for update of i`, [d.itemId], "Checklist item");
    await requireProjectScope(q, ctx.actor, it.project_id);
    if (it.version !== d.version) throw conflict("This item changed since you opened it. Reload to see the latest.");
    if (it.reported_done_at !== null) throw conflict("This item is already reported done.");
    if (d.date < it.start_date || d.date > it.due_date) throw validation("Pick a date within the task's dates, or change the task first.");
    if (d.date === it.item_date) throw validation("That is already the item's date.");
    await q.query("update site_work_item set item_date = $2, version = version + 1 where id = $1", [it.id, d.date]);
    await event(q, it.id, "rescheduled", { date: it.item_date }, { date: d.date }, d.reason, ctx.actor.id);
    return { itemId: it.id };
  });
}
