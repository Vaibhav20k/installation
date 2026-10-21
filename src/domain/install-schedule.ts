/**
 * Installation schedule layout: a template's steps placed on working days from a start date,
 * with weekly offs and holidays shown as off days, plus the customer-facing text copy.
 */
import { addDays, weekday, type LocalDate } from "@/lib/dates";

export interface ScheduleStep { name: string; days: number }
export interface ScheduleDay { date: LocalDate; kind: "work" | "off"; stepNo: number | null; stepName: string | null; offReason: string | null }

/** Lays steps out from `start`; the first scheduled day is the first working day on or after it. */
export function layoutSchedule(steps: ScheduleStep[], start: LocalDate, workingWeekdays: number[], holidays: Record<LocalDate, string>): ScheduleDay[] {
  const out: ScheduleDay[] = [];
  const queue = steps.flatMap((s, i) => Array.from({ length: s.days }, () => ({ no: i + 1, name: s.name })));
  let d = start;
  while (queue.length) {
    const holiday = holidays[d];
    if (holiday || !workingWeekdays.includes(weekday(d))) {
      if (out.length) out.push({ date: d, kind: "off", stepNo: null, stepName: null, offReason: holiday ?? "Weekly off" });
    } else {
      const s = queue.shift()!;
      out.push({ date: d, kind: "work", stepNo: s.no, stepName: s.name, offReason: null });
    }
    d = addDays(d, 1);
  }
  return out;
}

/** "2026-09-30" as "30.09.26", the format customers already receive. */
export function shortDate(d: LocalDate) {
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;
}

/** Plain-text schedule for sharing with the customer; consecutive days of one step collapse to a range. */
export function customerText(title: string, days: Array<Pick<ScheduleDay, "date" | "kind" | "stepNo" | "stepName" | "offReason">>) {
  const lines = [title];
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    if (d.kind === "off") { lines.push(`${shortDate(d.date)} ${d.offReason === "Weekly off" ? "Weekly off" : `Off (${d.offReason})`}`); continue; }
    let j = i;
    while (days[j + 1]?.kind === "work" && days[j + 1]!.stepNo === d.stepNo) j++;
    lines.push(j > i ? `${shortDate(d.date)} to ${shortDate(days[j]!.date)}` : shortDate(d.date), d.stepName!);
    i = j;
  }
  return lines.join("\n");
}
