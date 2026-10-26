/**
 * Availability for the admin skill cards, derived only from real commitments (approved leave, held or confirmed
 * reservations, travel inside them) and the person's work calendar. Nothing here is an editable flag, and when the
 * facts are missing the answer is Unknown, never Available.
 */
import { addDays, localDateOf, startOfLocalDay, weekday, type LocalDate } from "@/lib/dates";
import type { Interval } from "./intervals";

export type Availability = "available" | "assigned" | "on_leave" | "travelling" | "unknown";

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Available", assigned: "Assigned", on_leave: "On leave", travelling: "Travelling", unknown: "Unknown",
};

/**
 * First working date on which none of `blocks` (leave, held or confirmed bookings) is in force, searching
 * `horizonDays` ahead. Returns null when the search runs past the horizon: "not within N days", not "never".
 */
export function nextAvailableDate(blocks: Interval[], now: number, tz: string, workingWeekdays: number[], holidays: LocalDate[], horizonDays = 90): LocalDate | null {
  if (!workingWeekdays.length) return null;
  const limit = now + horizonDays * 86_400_000;
  const live = blocks.filter((b) => b.end > now);
  const stepPast = (from: number) => {
    let t = from;
    for (let moved = true; moved;) {
      moved = false;
      for (const b of live) if (b.start <= t && b.end > t) { t = b.end; moved = true; }
    }
    return t;
  };
  let t = now;
  for (let i = 0; i <= horizonDays; i++) {
    t = stepPast(t);
    if (t > limit) return null;
    const d = localDateOf(t, tz);
    if (workingWeekdays.includes(weekday(d)) && !holidays.includes(d)) return d;
    t = startOfLocalDay(addDays(d, 1), tz);
  }
  return null;
}
