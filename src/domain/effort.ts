/**
 * Quantity-based effort estimation (master prompt section 6).
 * Rate-based effort and role templates are alternative methods; never add both for the same work.
 */
import { Dec } from "./decimal";

export type RateBasis = "employee_day" | "team_day" | "employee_hour";
export type ApprovalStatus = "illustrative" | "draft" | "approved";

export interface Quantity { value: string; unit: string; quantityKind: string }

export interface ProductivityRate {
  id: string;
  activity: string;
  quantityKind: string;
  unit: string;
  basis: RateBasis;
  /** Output quantity per basis unit (per employee-day, team-day or employee-hour). */
  value: string;
  /** Required crew size for team-day rates. */
  crewSize?: number | null;
  /** Net working minutes in one rate-day, stored with the approved rate version. */
  netDayMinutes?: number | null;
  status: ApprovalStatus;
  version: number;
}

export interface EstimateIssue { code: string; message: string }

export interface RateEstimate {
  ok: boolean;
  method: "rate";
  rateId: string;
  provisional: boolean;
  issues: EstimateIssue[];
  /** Q / R in the rate's own basis unit. */
  basisUnits?: string;
  teamDays?: string;
  personDays?: string;
  employeeHours?: string;
  /** Total person-minutes of effort (fractional, unrounded). */
  personMinutes?: string;
  netDayMinutes?: number;
  explanation: string[];
}

export function estimateFromRate(scope: Quantity, rate: ProductivityRate, opts: { fullCrewAttendance?: boolean } = {}): RateEstimate {
  const issues: EstimateIssue[] = [];
  const explanation: string[] = [];
  const base = { method: "rate" as const, rateId: rate.id, provisional: rate.status !== "approved" };

  if (scope.quantityKind !== rate.quantityKind) {
    issues.push({ code: "quantity_kind_mismatch", message: `Scope is "${scope.quantityKind}" but the rate measures "${rate.quantityKind}". Same unit (${scope.unit}) does not make them comparable.` });
  }
  if (scope.unit !== rate.unit) {
    issues.push({ code: "unit_mismatch", message: `Scope unit ${scope.unit} does not match rate unit ${rate.unit}.` });
  }
  let q: Dec, r: Dec;
  try { q = Dec.of(scope.value); } catch { return { ...base, ok: false, issues: [...issues, { code: "invalid_quantity", message: "Scope quantity is not a number." }], explanation }; }
  try { r = Dec.of(rate.value); } catch { return { ...base, ok: false, issues: [...issues, { code: "invalid_rate", message: "Rate value is not a number." }], explanation }; }
  if (q.isNegative()) issues.push({ code: "negative_quantity", message: "Scope quantity cannot be negative." });
  if (!r.isPositive()) issues.push({ code: "missing_rate", message: "Rate is missing or zero; duration cannot be derived." });
  if (rate.basis !== "employee_hour" && !(rate.netDayMinutes && rate.netDayMinutes > 0)) {
    issues.push({ code: "missing_net_day", message: "Day-based rate has no net-day minutes on its version; hours cannot be derived." });
  }
  if (rate.basis === "team_day" && opts.fullCrewAttendance !== false && !(rate.crewSize && rate.crewSize > 0)) {
    issues.push({ code: "missing_crew_size", message: "Team-day rate needs a defined crew size to convert to person-days." });
  }
  if (issues.length) return { ...base, ok: false, issues, explanation };

  const units = q.div(r);
  const out: RateEstimate = { ...base, ok: true, issues, explanation, basisUnits: units.toString() };
  if (base.provisional) explanation.push(`Rate ${rate.id} v${rate.version} is ${rate.status}, so this estimate is provisional.`);

  if (rate.basis === "employee_hour") {
    out.employeeHours = units.toString();
    out.personMinutes = units.mul(60).toString();
    explanation.push(`${q} ${scope.unit} / ${r} per employee-hour = ${units} employee-hours.`);
    return out;
  }

  const net = rate.netDayMinutes!;
  out.netDayMinutes = net;
  if (rate.basis === "employee_day") {
    out.personDays = units.toString();
    out.personMinutes = units.mul(net).toString();
    explanation.push(`${q} ${scope.unit} / ${r} per employee-day = ${units} person-days (rate-day = ${net} net minutes).`);
    return out;
  }

  out.teamDays = units.toString();
  explanation.push(`${q} ${scope.unit} / ${r} per team-day = ${units} team-days.`);
  if (opts.fullCrewAttendance === false) {
    explanation.push("Partial crew attendance: person-hours must be summed from role/employee hours, not derived from team-days.");
    return out;
  }
  const crew = rate.crewSize!;
  const personDays = units.mul(crew);
  out.personDays = personDays.toString();
  out.personMinutes = personDays.mul(net).toString();
  explanation.push(`${units} team-days x crew of ${crew} attending the full interval = ${personDays} person-days.`);
  return out;
}

export interface RoleTemplateLine { role: string; hoursPerUnit?: string | null; fixedHours?: string | null; status: ApprovalStatus }

export interface RoleEffort { role: string; hours: string; minutes: string; provisional: boolean }

/** roleHours[r] = quantity * approvedHoursPerUnit[r], or explicit fixed hours. */
export function estimateFromRoleTemplate(quantity: string, lines: RoleTemplateLine[]): { ok: boolean; roles: RoleEffort[]; totalMinutes: string; issues: EstimateIssue[] } {
  const issues: EstimateIssue[] = [];
  const roles: RoleEffort[] = [];
  let total = Dec.zero;
  const q = Dec.of(quantity);
  for (const line of lines) {
    let hours: Dec;
    if (line.fixedHours != null && line.fixedHours !== "") hours = Dec.of(line.fixedHours);
    else if (line.hoursPerUnit != null && line.hoursPerUnit !== "") hours = q.mul(line.hoursPerUnit);
    else { issues.push({ code: "missing_template_value", message: `Role ${line.role} has no hours per unit or fixed hours.` }); continue; }
    if (hours.isNegative()) { issues.push({ code: "negative_hours", message: `Role ${line.role} has negative hours.` }); continue; }
    const minutes = hours.mul(60);
    total = total.add(minutes);
    roles.push({ role: line.role, hours: hours.toString(), minutes: minutes.toString(), provisional: line.status !== "approved" });
  }
  return { ok: issues.length === 0, roles, totalMinutes: total.toString(), issues };
}

/** Partial-attendance team: personHours = sum(roleOrEmployeeHours). */
export function sumPersonHours(hours: string[]): string {
  return hours.reduce((acc, h) => acc.add(h), Dec.zero).toString();
}

/**
 * Schedules a fixed amount of effort against an employee's daily available minutes.
 * Effort never shrinks to fit a shorter calendar; more calendar days are needed instead.
 */
export function scheduleEffortAcrossDays(requiredMinutes: string, dailyAvailable: Array<{ date: string; minutes: number }>, granularityMinutes = 15) {
  const required = Dec.of(requiredMinutes);
  // Scheduling granularity applies once to the total, never per task.
  const slotMinutes = Number(required.div(granularityMinutes).ceilToInt()) * granularityMinutes;
  let left = slotMinutes;
  const days: Array<{ date: string; minutes: number }> = [];
  for (const d of dailyAvailable) {
    if (left <= 0) break;
    if (d.minutes <= 0) continue;
    const use = Math.min(d.minutes, left);
    days.push({ date: d.date, minutes: use });
    left -= use;
  }
  return { estimatedMinutes: required.toString(), scheduledMinutes: slotMinutes, days, unscheduledMinutes: Math.max(0, left), fits: left <= 0 };
}
