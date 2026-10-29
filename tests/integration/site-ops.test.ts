import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { makeCtx } from "@/server/services/context";
import { addPresence, correctPresence, siteCheckIn, siteCheckOut } from "@/server/services/site-presence";
import { createWorkTask, rescheduleWorkItem, setWorkItemDone, updateWorkTask } from "@/server/services/site-work";
import { updateEmployeeSkill } from "@/server/services/master";
import { setSiteLocation } from "@/server/services/site";
import { teamCandidates } from "@/server/queries/installations";
import { myPresence, siteWorkforce, todaysWork, workPlan } from "@/server/queries/site-ops";
import { installCalendar } from "@/server/queries/install-calendar";
import { handoverState } from "@/domain/handover";
import { AppError, toAppError } from "@/server/errors";
import { actor, freshDb } from "./helpers";

const NOW = Date.parse("2026-10-22T06:00:00Z");
const HOUR = 3_600_000;
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };
let db: Db;
let worker = "", workerBid = "", visitId = "", managerBid = "", otherVisit = "";
const as = async (bid: string, now = NOW) => makeCtx(db, await actor(db, bid), now);

beforeAll(async () => {
  db = await freshDb({ operational: true });
  // A worker confirmed on a visit at NOW, and that project's manager.
  const [r] = await db.query<{ employee_id: string; bid: string; visit_id: string; manager: string }>(
    `select r.employee_id, e.business_id bid, r.visit_id, m.business_id manager from reservation r join employee e on e.id = r.employee_id
     join visit v on v.id = r.visit_id join project p on p.id = v.project_id join employee m on m.id = p.manager_id
     where r.state = 'confirmed' and r.span @> $1::timestamptz and e.permission_role = 'employee' and v.exec_status in ('scheduled','in_progress') order by e.business_id limit 1`, [new Date(NOW).toISOString()]);
  worker = r!.employee_id; workerBid = r!.bid; visitId = r!.visit_id; managerBid = r!.manager;
  const [o] = await db.query<{ id: string }>("select id from visit where id <> $1 limit 1", [visitId]);
  otherVisit = o!.id;
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("site check-in and check-out", () => {
  it("offers only sites booked today and refuses others", async () => {
    const mine = await myPresence(db, await actor(db, workerBid), NOW);
    expect(mine.sites.map((s) => s.visit_id)).toContain(visitId);
    expect(await kind(siteCheckIn(await as(workerBid), { visitId: otherVisit }))).toBe("forbidden");
  });

  it("is idempotent, prevents a second open session and leaves the daily shift untouched", async () => {
    const shiftsBefore = await db.query("select id, t0, version from shift_instance where employee_id = $1 order by id", [worker]);
    const a = await siteCheckIn(await as(workerBid), { visitId });
    const b = await siteCheckIn(await as(workerBid, NOW + 60_000), { visitId });
    expect(b.already).toBe(true);
    expect(b.presenceId).toBe(a.presenceId);
    const [n] = await db.query<{ n: number }>("select count(*)::int n from site_presence where employee_id = $1", [worker]);
    expect(n!.n).toBe(1);
    expect(await db.query("select id, t0, version from shift_instance where employee_id = $1 order by id", [worker])).toEqual(shiftsBefore);
    const out = await siteCheckOut(await as(workerBid, NOW + 3 * HOUR), { presenceId: a.presenceId });
    const again = await siteCheckOut(await as(workerBid, NOW + 3 * HOUR + 5000), { presenceId: a.presenceId });
    expect(out.already).toBe(false);
    expect(again.already).toBe(true);
    expect(again.checkOutAt).toBe(NOW + 3 * HOUR);
  });

  it("the database refuses overlapping sessions even if the service is bypassed", async () => {
    const [v] = await db.query<{ project_id: string }>("select project_id from visit where id = $1", [visitId]);
    expect(await kind(db.query("insert into site_presence(employee_id, visit_id, project_id, check_in_at, check_out_at) values ($1,$2,$3,$4,$5)",
      [worker, visitId, v!.project_id, new Date(NOW + HOUR).toISOString(), new Date(NOW + 2 * HOUR).toISOString()]).catch((e) => { throw toAppError(e); }))).toBe("conflict");
  });

  it("a missed check-out stays open and adds no days; a supervisor correction closes it with history", async () => {
    const later = NOW + 5 * HOUR;
    const s = await siteCheckIn(await as(workerBid, later), { visitId });
    const head = await actor(db, managerBid);
    let wf = await siteWorkforce(db, head, visitId, later + 30 * HOUR);
    let row = wf.rows.find((r) => r.id === worker)!;
    expect(row.summary.openSessions).toBe(1);
    expect(row.summary.recordedDays).toBe(1);
    expect(row.summary.recordedMinutes).toBe(180);
    expect(row.plannedDates.length).toBeGreaterThan(0);
    expect(await kind(correctPresence(await as(workerBid, later + 30 * HOUR), { presenceId: s.presenceId, version: 1, checkOut: { date: "2026-10-22", time: "20:00" }, reason: "Forgot" }))).toBe("forbidden");
    await correctPresence(await as(managerBid, later + 30 * HOUR), { presenceId: s.presenceId, version: 1, checkOut: { date: "2026-10-22", time: "19:30" }, reason: "Left at 7:30 pm, confirmed by phone" });
    wf = await siteWorkforce(db, head, visitId, later + 30 * HOUR);
    row = wf.rows.find((r) => r.id === worker)!;
    expect(row.summary.openSessions).toBe(0);
    expect(row.summary.recordedMinutes).toBe(180 + 180); // 16:30 to 19:30 IST
    const [c] = await db.query<{ n: number }>("select count(*)::int n from site_presence_change where presence_id = $1 and change = 'corrected'", [s.presenceId]);
    expect(c!.n).toBe(1);
  });

  it("a check-out forgotten overnight is never closed with the next morning's time", async () => {
    // Clear earlier sessions of this worker so this case stands alone.
    await db.query("update site_presence set voided = true where employee_id = $1", [worker]);
    const evening = Date.parse("2026-10-22T13:00:00Z"); // 18:30 IST
    const s = await siteCheckIn(await as(workerBid, evening), { visitId });
    const morning = Date.parse("2026-10-23T03:30:00Z"); // 09:00 IST next day
    expect(await kind(siteCheckOut(await as(workerBid, morning), { presenceId: s.presenceId }))).toBe("conflict");
    const next = await siteCheckIn(await as(workerBid, morning), { visitId });
    expect(next.presenceId).not.toBe(s.presenceId);
    const [old] = await db.query<{ missed_checkout: boolean; check_out_at: number | null }>("select missed_checkout, check_out_at from site_presence where id = $1", [s.presenceId]);
    expect(old).toMatchObject({ missed_checkout: true, check_out_at: null });
    const wf = await siteWorkforce(db, await actor(db, managerBid), visitId, morning + HOUR);
    const row = wf.rows.find((r) => r.id === worker)!;
    expect(row.summary.openSessions).toBe(2);
    expect(row.summary.recordedDays).toBe(0);
    // The supervisor enters the real time; it then counts on its own date only.
    await siteCheckOut(await as(workerBid, morning + 2 * HOUR), { presenceId: next.presenceId });
    const [v] = await db.query<{ version: number }>("select version from site_presence where id = $1", [s.presenceId]);
    await correctPresence(await as(managerBid, morning + 3 * HOUR), { presenceId: s.presenceId, version: v!.version, checkOut: { date: "2026-10-22", time: "20:00" }, reason: "Left at 8 pm per supervisor" });
    const after = (await siteWorkforce(db, await actor(db, managerBid), visitId, morning + 3 * HOUR)).rows.find((r) => r.id === worker)!;
    expect(after.summary.days.map((d) => d.date)).toEqual(["2026-10-22", "2026-10-23"]);
    expect(after.summary.recordedMinutes).toBe(90 + 120);
    expect(after.summary.openSessions).toBe(0);
  });

  it("supervisors can add a missing session only for booked, past time; workers and outsiders cannot read the head view", async () => {
    expect(await kind(addPresence(await as(managerBid), { employeeId: worker, visitId, checkIn: { date: "2026-10-30", time: "09:00" }, checkOut: { date: "2026-10-30", time: "10:00" }, reason: "Future" }))).toBe("validation");
    expect(await kind(siteWorkforce(db, await actor(db, workerBid), visitId, NOW))).toBe("forbidden");
  });
});

describe("work plan and daily checklist", () => {
  let taskId = "";
  it("a manager splits work into dated tasks with a list per day; workers see their own items", async () => {
    const other = (await db.query<{ employee_id: string }>("select employee_id from reservation where visit_id = $1 and employee_id <> $2 and state in ('held','confirmed') limit 1", [visitId, worker]))[0]?.employee_id;
    const r = await createWorkTask(await as(managerBid), { visitId, title: "Base cabinets", startDate: "2026-10-22", dueDate: "2026-10-24", assigneeIds: [worker, ...(other ? [other] : [])], checklist: ["Level the base", "Fix plinths"] });
    taskId = r.taskId;
    const plan = await workPlan(db, await actor(db, managerBid), visitId);
    const t = plan.tasks.find((x) => x.id === taskId)!;
    expect(t.items).toHaveLength(6);
    const mine = await todaysWork(db, await actor(db, workerBid), "2026-10-22");
    expect(mine.today.filter((i) => i.task_id === taskId)).toHaveLength(2);
    expect(await kind(createWorkTask(await as(workerBid), { visitId, title: "Mine", startDate: "2026-10-22", dueDate: "2026-10-22" }))).toBe("forbidden");
  });

  it("ticks once per shared item, is idempotent, needs a reason to reopen, and keeps history", async () => {
    const mine = await todaysWork(db, await actor(db, workerBid), "2026-10-22");
    const item = mine.today.find((i) => i.task_id === taskId)!;
    await setWorkItemDone(await as(workerBid), { itemId: item.id, done: true });
    expect((await setWorkItemDone(await as(workerBid), { itemId: item.id, done: true })).already).toBe(true);
    expect(await kind(setWorkItemDone(await as(workerBid), { itemId: item.id, done: false }))).toBe("validation");
    await setWorkItemDone(await as(workerBid), { itemId: item.id, done: false, reason: "Plinth came loose" });
    await setWorkItemDone(await as(workerBid), { itemId: item.id, done: true });
    const [e] = await db.query<{ n: number }>("select count(*)::int n from site_work_item_event where item_id = $1", [item.id]);
    expect(e!.n).toBe(3);
    // One finished day does not finish a three-day task.
    const plan = await workPlan(db, await actor(db, managerBid), visitId);
    const t = plan.tasks.find((x) => x.id === taskId)!;
    expect(t.items.filter((i) => i.done_at).length).toBe(1);
    // Someone not assigned and below supervisor cannot tick it.
    const [stranger] = await db.query<{ business_id: string }>("select business_id from employee where permission_role = 'employee' and id not in (select employee_id from site_work_assignee where task_id = $1) limit 1", [taskId]);
    expect(await kind(setWorkItemDone(await as(stranger!.business_id), { itemId: item.id, done: false, reason: "Not mine" }))).toBe("forbidden");
  });

  it("an unfinished item shows as overdue later and a reschedule keeps the original date", async () => {
    const later = await todaysWork(db, await actor(db, workerBid), "2026-10-23");
    expect(later.overdue.some((i) => i.task_id === taskId && i.item_date === "2026-10-22")).toBe(true);
    const it = later.overdue.find((i) => i.task_id === taskId)!;
    await rescheduleWorkItem(await as(managerBid), { itemId: it.id, version: it.version, date: "2026-10-24", reason: "Material late" });
    const plan = await workPlan(db, await actor(db, managerBid), visitId);
    const moved = plan.tasks.find((x) => x.id === taskId)!.items.find((i) => i.id === it.id)!;
    expect(moved.item_date).toBe("2026-10-24");
    expect(moved.original_date).toBe("2026-10-22");
    expect(await kind(rescheduleWorkItem(await as(managerBid), { itemId: it.id, version: moved.version, date: "2026-11-30", reason: "Way out" }))).toBe("validation");
    await updateWorkTask(await as(managerBid), { taskId, version: 1, title: "Base cabinets and plinths", reason: "Clearer name" });
    expect(await kind(updateWorkTask(await as(managerBid), { taskId, version: 1, title: "Stale", reason: "Stale edit" }))).toBe("conflict");
  });
});

describe("calendar, handover and skills", () => {
  it("counts each visit once per date however many people are booked", async () => {
    const cal = await installCalendar(db, await actor(db, "EMP-004"), "2026-10", NOW);
    for (const [, list] of cal.byDate) expect(new Set(list.map((v) => v.visit_id)).size).toBe(list.length);
    expect(cal.visits.some((v) => v.team > 1)).toBe(true);
    expect(await kind(installCalendar(db, await actor(db, workerBid), "2026-10", NOW))).toBe("forbidden");
  });

  it("overdue only when unfinished and past the due date in the site's time zone; missing date is not overdue", () => {
    const base = { timezone: "Asia/Kolkata", schedule_end: null };
    expect(handoverState({ ...base, exec_status: "in_progress", planned_end: "2026-10-21" }, NOW)).toMatchObject({ kind: "overdue", days: 1 });
    expect(handoverState({ ...base, exec_status: "in_progress", planned_end: "2026-10-22" }, NOW).kind).toBe("due");
    expect(handoverState({ ...base, exec_status: "completed", planned_end: "2026-10-01" }, NOW).kind).toBe("done");
    expect(handoverState({ ...base, exec_status: "scheduled", planned_end: null }, NOW).kind).toBe("not_set");
    // 23:30 IST on the due date is still the due date, not overdue.
    expect(handoverState({ ...base, exec_status: "in_progress", planned_end: "2026-10-22" }, Date.parse("2026-10-22T18:00:00Z")).kind).toBe("due");
  });

  it("a supervisor corrects a skill for someone in scope with history; a worker cannot", async () => {
    const [s] = await db.query<{ id: string; version: number; bid: string; level: number }>(
      `select es.id, es.version, e.business_id bid, es.level from employee_skill es join employee e on e.id = es.employee_id where e.manager_id = (select id from employee where business_id = $1) limit 1`, [managerBid]);
    if (!s) return;
    await updateEmployeeSkill(await as(managerBid), { employeeSkillId: s.id, version: s.version, level: s.level === 3 ? 2 : s.level + 1, reason: "Observed on site" });
    const [h] = await db.query<{ n: number }>("select count(*)::int n from employee_skill_change where employee_skill_id = $1 and change = 'level'", [s.id]);
    expect(h!.n).toBe(1);
    expect(await kind(updateEmployeeSkill(await as(workerBid), { employeeSkillId: s.id, version: s.version + 1, level: 1, reason: "Trying" }))).toBe("forbidden");
  });

  it("a manager pins a site in scope; workers cannot; the calendar returns the location", async () => {
    const [v] = await db.query<{ project_id: string }>("select project_id from visit where id = $1", [visitId]);
    await setSiteLocation(await as(managerBid), { projectId: v!.project_id, location: { latitude: 28.5, longitude: 77.3 } });
    expect(await kind(setSiteLocation(await as(workerBid), { projectId: v!.project_id, location: null }))).toBe("forbidden");
    expect(await kind(setSiteLocation(await as(managerBid), { projectId: v!.project_id, location: { latitude: 120, longitude: 0 } }))).toBe("validation");
    const cal = await installCalendar(db, await actor(db, "EMP-004"), "2026-10", NOW);
    const row = cal.visits.find((x) => x.project_id === v!.project_id)!;
    expect([row.latitude, row.longitude]).toEqual([28.5, 77.3]);
  });

  it("lists candidates for a visit whose bookings already ended (late handover) instead of failing", async () => {
    const [v] = await db.query<{ visit_id: string; hi: number }>("select visit_id, max(upper(span)) hi from reservation where state in ('held','confirmed') group by visit_id order by max(upper(span)) limit 1");
    const list = await teamCandidates(db, v!.visit_id, Number(v!.hi) + 4 * 86_400_000);
    expect(Array.isArray(list)).toBe(true);
  });
});
