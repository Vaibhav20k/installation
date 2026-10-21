/**
 * Calendar and allocation metrics (master prompt section 6, "Calendar and allocation metrics").
 * Assigned dates, elapsed calendar days, work person-days and travel allocations are distinct.
 */
import { Dec } from "./decimal";
import { dayDiff } from "@/lib/dates";

export interface EmployeeAllocation {
  employeeId: string;
  workDates: string[];
  travelDates: string[];
  workMinutes: number;
  travelMinutes: number;
}

export function employeeAssignmentDates(a: Pick<EmployeeAllocation, "workDates" | "travelDates">): string[] {
  return [...new Set([...a.workDates, ...a.travelDates])].sort();
}

export function assignedDateCount(a: Pick<EmployeeAllocation, "workDates" | "travelDates">): number {
  return employeeAssignmentDates(a).length;
}

/** Inclusive calendar span including weekends/gaps; 0 for an empty assignment. */
export function elapsedCalendarDays(a: Pick<EmployeeAllocation, "workDates" | "travelDates">): number {
  const dates = employeeAssignmentDates(a);
  if (dates.length === 0) return 0;
  return dayDiff(dates[0]!, dates[dates.length - 1]!) + 1;
}

export function allocationSummary(allocs: EmployeeAllocation[], netDayMinutes: number) {
  if (!(netDayMinutes > 0)) throw new Error("A positive net-day denominator is required");
  let personAssignmentDates = 0;
  let travelAllocations = 0;
  let workPersonDays = Dec.zero;
  const perEmployee = allocs.map((a) => {
    const assigned = assignedDateCount(a);
    const travelOnly = new Set(a.travelDates.filter((d) => !a.workDates.includes(d))).size;
    personAssignmentDates += assigned;
    travelAllocations += new Set(a.travelDates).size;
    const wpd = Dec.of(a.workMinutes).div(netDayMinutes);
    workPersonDays = workPersonDays.add(wpd);
    return {
      employeeId: a.employeeId,
      assignedDateCount: assigned,
      elapsedCalendarDays: elapsedCalendarDays(a),
      workPersonDays: wpd.toString(),
      travelOnlyDates: travelOnly,
      workMinutes: a.workMinutes,
      travelMinutes: a.travelMinutes,
    };
  });
  return {
    perEmployee,
    personAssignmentDates,
    workPersonDays: workPersonDays.toString(),
    travelAllocations,
    denominatorMinutes: netDayMinutes,
  };
}

/** effortVariance = actualComparableWorkHours - baselinePlannedWorkHours (minutes here). */
export function effortVarianceMinutes(actualComparableWorkMinutes: number, baselinePlannedWorkMinutes: number): number {
  return actualComparableWorkMinutes - baselinePlannedWorkMinutes;
}
