import { approvalQueues } from "@/server/queries/time";
import { attendanceExceptions } from "@/server/queries/attendance";
import { pendingAdditionalWork } from "@/server/services/commercial";
import type { QueueInfo } from "./Queue";

type Db = Parameters<typeof attendanceExceptions>[0];
type Actor = Parameters<typeof attendanceExceptions>[1];

const minOf = (xs: number[]) => xs.reduce((a, x) => (Number.isFinite(x) && x < a ? x : a), Infinity);
const dateMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/**
 * Loads every approval queue the viewer can see (same server queries and scoping as before) and works out, per
 * queue, how many items this viewer can actually decide. The server actions still enforce every permission; this
 * only decides what is shown first.
 */
export async function loadApprovals(db: Db, actor: Actor, now: number) {
  const isManager = actor.role === "manager" || actor.role === "admin";
  const q = await approvalQueues(db, actor);
  const att = await attendanceExceptions(db, actor, now);
  const extra = await pendingAdditionalWork(db, actor);
  const notMine = <T>(rows: T[], who: (r: T) => string | null) => rows.filter((r) => who(r) !== actor.id);

  const plans = isManager ? notMine(q.plans, (p) => p.submitted_by_id) : [];
  const timeWaiting = q.time[0]?.waiting ?? 0;
  const timeMine = notMine(q.time, (t) => t.employee_id);
  const overtime = notMine(q.overtime, (o) => o.employee_id);
  const corrections = notMine(att.corrections, (c) => c.employee_id);
  const leave = notMine(att.leave, (l) => l.employee_id);
  const expenses = isManager ? notMine(q.expenses, (x) => x.claimant_id) : [];

  const queues: QueueInfo[] = [
    { id: "plans", title: "Plan changes", noun: ["plan change", "plan changes"], mine: plans.length, items: q.plans.length, oldest: minOf(plans.map((p) => p.submitted_at ?? Infinity)) },
    { id: "time", title: "Time entries", noun: ["time entry", "time entries"], mine: Math.max(0, timeWaiting - (q.time.length - timeMine.length)), items: timeWaiting, oldest: minOf(timeMine.map((t) => t.start)) },
    { id: "overtime", title: "Overtime checks", noun: ["overtime check", "overtime checks"], mine: overtime.length, items: q.overtime.length, oldest: minOf(overtime.map((o) => o.start)) },
    { id: "attendance", title: "Attendance and leave", noun: ["attendance or leave request", "attendance and leave requests"], mine: corrections.length + leave.length,
      items: att.corrections.length + att.missed.length + att.leave.length, oldest: minOf([...corrections.map((c) => c.t0), ...leave.map((l) => dateMs(l.start_date))]) },
    ...(isManager ? [{ id: "additional", title: "Extra work", noun: ["extra work request", "extra work requests"] as [string, string], mine: extra.length, items: extra.length, oldest: Infinity }] : []),
    { id: "expenses", title: "Expenses", noun: ["expense", "expenses"], mine: expenses.length, items: q.expenses.length, oldest: minOf(expenses.map((x) => dateMs(x.incurred_on))) },
  ];
  return { q, att, extra, isManager, queues };
}
