/**
 * Skill qualification and coverage (master prompt section 7).
 * Low=1, Medium=2, High=3 is an ordering, not a score: several Low never replace one High.
 */
import { dayDiff } from "@/lib/dates";
import { intersect, durationMinutes, type Interval } from "./intervals";

export type Level = 1 | 2 | 3;
export const LEVEL_LABEL: Record<Level, string> = { 1: "Low", 2: "Medium", 3: "High" };
export const LEVEL_VALUE: Record<string, Level> = { Low: 1, Medium: 2, High: 3 };

export interface EmployeeSkillRecord {
  skillCode: string;
  level: Level;
  verified: boolean;
  validFrom: string | null;
  validTo: string | null;
}

export interface SkillRequirement {
  id: string;
  skillCode: string;
  minLevel: Level;
  headcount: number;
  mode: "collective" | "per_person";
  /** per_person requirements apply to these job roles (all members when empty). */
  appliesToRoles?: string[];
  /** Requirements in the same group are simultaneous full-time slots needing distinct people. */
  concurrencyGroup?: string;
}

export interface TeamMember { id: string; jobRole: string; skills: EmployeeSkillRecord[] }

export function qualifiesOn(skills: EmployeeSkillRecord[], skillCode: string, minLevel: Level, date: string): { ok: boolean; reason?: string } {
  const recs = skills.filter((s) => s.skillCode === skillCode);
  if (recs.length === 0) return { ok: false, reason: `no ${skillCode} record` };
  const verified = recs.filter((s) => s.verified);
  if (verified.length === 0) return { ok: false, reason: `${skillCode} not verified` };
  const valid = verified.filter((s) => (!s.validFrom || dayDiff(s.validFrom, date) >= 0) && (!s.validTo || dayDiff(date, s.validTo) >= 0));
  if (valid.length === 0) return { ok: false, reason: `${skillCode} verification not valid on ${date}` };
  const best = Math.max(...valid.map((s) => s.level)) as Level;
  if (best < minLevel) return { ok: false, reason: `${skillCode} verified ${LEVEL_LABEL[best]}, needs ${LEVEL_LABEL[minLevel]}` };
  return { ok: true };
}

/** Validates a skill for every date of the assigned interval, so expiry midway is caught. */
export function qualifiesThroughout(skills: EmployeeSkillRecord[], skillCode: string, minLevel: Level, dates: string[]) {
  const failed: Array<{ date: string; reason: string }> = [];
  for (const d of dates) {
    const r = qualifiesOn(skills, skillCode, minLevel, d);
    if (!r.ok) failed.push({ date: d, reason: r.reason! });
  }
  return { ok: failed.length === 0, failed };
}

export interface RequirementResult {
  requirementId: string;
  skillCode: string;
  minLevel: Level;
  mode: SkillRequirement["mode"];
  needed: number;
  qualifying: string[];
  assigned: string[];
  met: boolean;
  message: string;
}

export function evaluateCoverage(team: TeamMember[], requirements: SkillRequirement[], dates: string[]) {
  const qualifiesAll = (m: TeamMember, r: SkillRequirement) => qualifiesThroughout(m.skills, r.skillCode, r.minLevel, dates);
  const results: RequirementResult[] = [];

  for (const r of requirements.filter((x) => x.mode === "per_person")) {
    const applicable = team.filter((m) => !r.appliesToRoles?.length || r.appliesToRoles.includes(m.jobRole));
    const failing = applicable.filter((m) => !qualifiesAll(m, r).ok);
    results.push({
      requirementId: r.id, skillCode: r.skillCode, minLevel: r.minLevel, mode: r.mode, needed: applicable.length,
      qualifying: applicable.filter((m) => !failing.includes(m)).map((m) => m.id), assigned: [], met: failing.length === 0,
      message: failing.length === 0 ? "Every applicable member qualifies" : `Not met by ${failing.map((m) => m.id).join(", ")}`,
    });
  }

  // Collective requirements: distinct people per concurrency group via bipartite matching.
  const groups = new Map<string, SkillRequirement[]>();
  for (const r of requirements.filter((x) => x.mode === "collective")) {
    const key = r.concurrencyGroup ?? `solo:${r.id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const reqs of groups.values()) {
    const slots: Array<{ req: SkillRequirement; idx: number }> = [];
    for (const r of reqs) for (let i = 0; i < r.headcount; i++) slots.push({ req: r, idx: i });
    const eligible = slots.map((s) => team.filter((m) => qualifiesAll(m, s.req).ok).map((m) => m.id));
    const match = maxMatching(eligible);
    for (const r of reqs) {
      const assigned = slots.map((s, i) => (s.req === r ? match[i] : undefined)).filter((x): x is string => !!x);
      const qualifying = team.filter((m) => qualifiesAll(m, r).ok).map((m) => m.id);
      const met = assigned.length >= r.headcount;
      results.push({
        requirementId: r.id, skillCode: r.skillCode, minLevel: r.minLevel, mode: r.mode, needed: r.headcount, qualifying, assigned, met,
        message: met
          ? `${assigned.length}/${r.headcount} distinct qualifying members assigned`
          : qualifying.length >= r.headcount
            ? `Only ${assigned.length}/${r.headcount} after distinct allocation: a member cannot fill two simultaneous slots`
            : `Only ${qualifying.length}/${r.headcount} members verified at ${LEVEL_LABEL[r.minLevel]}+ in ${r.skillCode}`,
      });
    }
  }
  return { met: results.every((r) => r.met), results };
}

/** Kuhn's augmenting-path matching. eligible[slot] = employee ids. Returns employee per slot. */
export function maxMatching(eligible: string[][]): Array<string | undefined> {
  const owner = new Map<string, number>();
  const tryAssign = (slot: number, seen: Set<string>): boolean => {
    for (const emp of eligible[slot]!) {
      if (seen.has(emp)) continue;
      seen.add(emp);
      const cur = owner.get(emp);
      if (cur === undefined || tryAssign(cur, seen)) { owner.set(emp, slot); return true; }
    }
    return false;
  };
  for (let s = 0; s < eligible.length; s++) tryAssign(s, new Set());
  const out: Array<string | undefined> = eligible.map(() => undefined);
  for (const [emp, slot] of owner) out[slot] = emp;
  return out;
}

/**
 * Crew presence: required roles must be on site together for minutesTogether.
 * Enough total role-hours in disjoint slots is a conflict, not coverage.
 */
export function checkCrewPresence(requiredRoles: string[], minutesTogether: number, members: Array<{ employeeId: string; role: string; intervals: Interval[] }>) {
  const byRole = requiredRoles.map((role) => members.filter((m) => m.role === role));
  const missing = requiredRoles.filter((_, i) => byRole[i]!.length === 0);
  if (missing.length) return { ok: false, togetherMinutes: 0, message: `No assigned member in role(s): ${missing.join(", ")}` };
  let best = 0;
  const walk = (i: number, acc: Interval[] | null) => {
    if (i === byRole.length) { best = Math.max(best, durationMinutes(acc ?? [])); return; }
    for (const m of byRole[i]!) walk(i + 1, acc === null ? m.intervals : intersect(acc, m.intervals));
  };
  walk(0, null);
  const ok = best >= minutesTogether;
  return { ok, togetherMinutes: best, message: ok ? `Crew overlaps for ${best} minutes` : `Required roles overlap only ${best} of ${minutesTogether} minutes` };
}

export interface BookedMember { id: string; jobRole: string; skills: EmployeeSkillRecord[]; from: number; until: number }

/**
 * Crew presence over time: membership changes (a replacement, an added person) split [from, end) into periods, and each
 * period must be covered by the people actually booked during it, not by the team's total over the whole visit.
 * `datesOf` turns a period into its local work dates (the caller owns the timezone).
 */
export function coverageByPeriod(members: BookedMember[], requirements: SkillRequirement[], from: number, end: number, teamSize: number, datesOf: (a: number, b: number) => string[]) {
  const cuts = [...new Set([from, end, ...members.flatMap((m) => [m.from, m.until]).filter((t) => t > from && t < end)])].sort((a, b) => a - b);
  const periods: Array<{ dates: string[]; present: string[]; problems: string[]; results: ReturnType<typeof evaluateCoverage>["results"] }> = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!, b = cuts[i + 1]!;
    const here = members.filter((m) => m.from <= a && m.until >= b);
    const dates = datesOf(a, b);
    const cov = evaluateCoverage(here.map((m) => ({ id: m.id, jobRole: m.jobRole, skills: m.skills })), requirements, dates);
    const problems = cov.results.filter((r) => !r.met).map((r) => `${r.skillCode}: ${r.message}`);
    if (here.length !== teamSize) problems.push(`Staffed ${here.length} of ${teamSize}`);
    periods.push({ dates, present: here.map((m) => m.id), problems, results: cov.results });
  }
  const label = (d: string[]) => periods.length > 1 ? `${d[0]}${d.length > 1 ? ` to ${d[d.length - 1]}` : ""}: ` : "";
  const problems = periods.flatMap((p) => p.problems.map((x) => `${label(p.dates)}${x}`));
  return { met: problems.length === 0, problems, periods };
}
