/**
 * Handover due state of a visit. The due date is the last day of the visit's customer schedule (whose final
 * step is the handover) or, without a schedule, the approved planned end date. Date-only rule: an unfinished
 * visit is overdue once the site-local date is later than the due date. No daily cut-off time is assumed.
 */
import { localDateOf, type LocalDate } from "@/lib/dates";

export const DONE_STATES = ["completed", "closed"] as const;
export type HandoverState = { kind: "not_set" } | { kind: "done"; due: LocalDate | null } | { kind: "cancelled" } | { kind: "due"; due: LocalDate } | { kind: "overdue"; due: LocalDate; days: number };

export function handoverDue(scheduleEnd: string | null, plannedEnd: string | null): LocalDate | null {
  return scheduleEnd ?? plannedEnd ?? null;
}

export function handoverState(v: { exec_status: string; schedule_end: string | null; planned_end: string | null; timezone: string }, now: number): HandoverState {
  const due = handoverDue(v.schedule_end, v.planned_end);
  if (v.exec_status === "cancelled") return { kind: "cancelled" };
  if ((DONE_STATES as readonly string[]).includes(v.exec_status)) return { kind: "done", due };
  if (!due) return { kind: "not_set" };
  const today = localDateOf(now, v.timezone);
  if (today <= due) return { kind: "due", due };
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000);
  return { kind: "overdue", due, days };
}
