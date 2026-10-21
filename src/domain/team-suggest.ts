/**
 * Deterministic, explainable team suggestion (master prompt section 7, MVP algorithm).
 * A suggestion is not a reservation; booking revalidates inside a transaction.
 */
import { addDays, datesBetween, weekday } from "@/lib/dates";
import { overlaps, type Interval } from "./intervals";
import { evaluateCoverage, type EmployeeSkillRecord, type SkillRequirement } from "./skills";

export interface Candidate {
  id: string;
  name: string;
  jobRole: string;
  active: boolean;
  skills: EmployeeSkillRecord[];
  /** Held/confirmed reservations and approved leave as UTC intervals. */
  blocking: Interval[];
  workloadMinutes: number;
}

export interface SuggestInput {
  candidates: Candidate[];
  requirements: SkillRequirement[];
  teamSize: number;
  /** Calendar days the reservation occupies (departure through return/release). */
  spanDays: number;
  earliestStart: string;
  horizonDays: number;
  workingWeekdays: number[];
  holidays?: string[];
  /** Converts a start date into the reservation interval in the operational timezone. */
  spanFor: (start: string) => Interval;
  preferredTeam?: string[];
  continuity: "none" | "preferred" | "mandatory";
  maxCombinationsPerDate?: number;
  maxOptions?: number;
}

export interface TeamOption {
  start: string;
  memberIds: string[];
  continuityMembers: number;
  workloadMinutes: number;
  coverage: ReturnType<typeof evaluateCoverage>;
}

export const TIE_BREAK_RULES = [
  "1. Preferred-team continuity (more returning members first)",
  "2. Earliest feasible start date",
  "3. Lower total assigned workload",
  "4. Employee ID order (stable, deterministic)",
];

export function unavailableReasons(c: Candidate, span: Interval, dates: string[], requirements: SkillRequirement[]): string[] {
  const reasons: string[] = [];
  if (!c.active) reasons.push("inactive");
  if (c.blocking.some((b) => overlaps(b, span))) reasons.push("already reserved or on leave in this span");
  const relevant = requirements.filter((r) => c.skills.some((s) => s.skillCode === r.skillCode));
  if (requirements.length && relevant.length === 0) reasons.push("holds none of the required skills");
  void dates;
  return reasons;
}

export function evaluateTeam(input: SuggestInput, memberIds: string[], start: string) {
  const span = input.spanFor(start);
  const dates = datesBetween(start, addDays(start, input.spanDays - 1));
  const members = memberIds.map((id) => input.candidates.find((c) => c.id === id));
  const problems: string[] = [];
  if (members.some((m) => !m)) problems.push("Unknown employee selected");
  const present = members.filter((m): m is Candidate => !!m);
  if (new Set(memberIds).size !== memberIds.length) problems.push("The same employee is selected twice");
  if (present.length !== input.teamSize) problems.push(`Team has ${present.length} members; configured team size is ${input.teamSize}`);
  for (const m of present) {
    if (!m.active) problems.push(`${m.name} is inactive`);
    if (m.blocking.some((b) => overlaps(b, span))) problems.push(`${m.name} is already reserved or on leave`);
  }
  const coverage = evaluateCoverage(present.map((m) => ({ id: m.id, jobRole: m.jobRole, skills: m.skills })), input.requirements, dates);
  for (const r of coverage.results.filter((x) => !x.met)) problems.push(`${r.skillCode}: ${r.message}`);
  if (input.continuity === "mandatory" && input.preferredTeam?.some((id) => !memberIds.includes(id))) {
    problems.push("Continuity is mandatory and the preferred team is not intact");
  }
  return { ok: problems.length === 0, problems, coverage, dates };
}

export function suggestTeams(input: SuggestInput) {
  const budget = input.maxCombinationsPerDate ?? 20_000;
  const maxOptions = input.maxOptions ?? 5;
  const preferred = new Set(input.preferredTeam ?? []);
  const isWorkday = (d: string) => input.workingWeekdays.includes(weekday(d)) && !(input.holidays ?? []).includes(d);
  const searched = { dates: 0, combinations: 0, truncatedDates: [] as string[] };
  const found: TeamOption[] = [];
  let firstDateDiagnostics: Array<{ id: string; name: string; reasons: string[] }> | null = null;

  for (let offset = 0; offset <= input.horizonDays; offset++) {
    const start = addDays(input.earliestStart, offset);
    if (!isWorkday(start)) continue;
    searched.dates++;
    const span = input.spanFor(start);
    const dates = datesBetween(start, addDays(start, input.spanDays - 1));
    const available = input.candidates
      .filter((c) => unavailableReasons(c, span, dates, input.requirements).length === 0)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!firstDateDiagnostics) {
      firstDateDiagnostics = input.candidates
        .map((c) => ({ id: c.id, name: c.name, reasons: unavailableReasons(c, span, dates, input.requirements) }))
        .filter((d) => d.reasons.length > 0);
    }
    // After the earliest options are found, later dates only search for the intact preferred team.
    const continuityOnly = input.continuity === "mandatory" || found.length > 0;
    const mustInclude = continuityOnly ? available.filter((c) => preferred.has(c.id)) : [];
    if (continuityOnly && mustInclude.length < preferred.size) continue;
    const pool = available.filter((c) => !mustInclude.includes(c));
    const pick = input.teamSize - mustInclude.length;
    if (pick < 0 || pool.length < pick) continue;

    let combos = 0;
    let truncated = false;
    const perDate: TeamOption[] = [];
    const chosen: Candidate[] = [];
    const recurse = (from: number) => {
      if (truncated) return;
      if (chosen.length === pick) {
        combos++;
        if (combos > budget) { truncated = true; return; }
        const team = [...mustInclude, ...chosen];
        const coverage = evaluateCoverage(team.map((m) => ({ id: m.id, jobRole: m.jobRole, skills: m.skills })), input.requirements, dates);
        if (coverage.met) {
          perDate.push({
            start,
            memberIds: team.map((m) => m.id).sort(),
            continuityMembers: team.filter((m) => preferred.has(m.id)).length,
            workloadMinutes: team.reduce((s, m) => s + m.workloadMinutes, 0),
            coverage,
          });
        }
        return;
      }
      for (let i = from; i <= pool.length - (pick - chosen.length); i++) {
        chosen.push(pool[i]!);
        recurse(i + 1);
        chosen.pop();
        if (truncated) return;
      }
    };
    recurse(0);
    searched.combinations += Math.min(combos, budget);
    if (truncated) searched.truncatedDates.push(start);
    found.push(...perDate);
    const haveFullContinuity = preferred.size === 0 || found.some((o) => o.continuityMembers === preferred.size);
    if (found.length > 0 && haveFullContinuity) break;
  }

  const byRank = (a: TeamOption, b: TeamOption) =>
    b.continuityMembers - a.continuityMembers || a.start.localeCompare(b.start) || a.workloadMinutes - b.workloadMinutes || a.memberIds.join().localeCompare(b.memberIds.join());
  const byEarliest = (a: TeamOption, b: TeamOption) =>
    a.start.localeCompare(b.start) || b.continuityMembers - a.continuityMembers || a.workloadMinutes - b.workloadMinutes || a.memberIds.join().localeCompare(b.memberIds.join());
  const ranked = [...found].sort(byRank);
  const earliest = [...found].sort(byEarliest)[0] ?? null;
  const strongestContinuity = preferred.size ? ranked.find((o) => o.continuityMembers > 0) ?? null : null;

  const horizonEnd = addDays(input.earliestStart, input.horizonDays);
  return {
    options: ranked.slice(0, maxOptions),
    earliest,
    strongestContinuity,
    noSolutionWithinHorizon: found.length === 0,
    resultStatement: found.length === 0
      ? `No feasible team found between ${input.earliestStart} and ${horizonEnd}. This is a bounded search result, not proof that no team exists.`
      : `${found.length} feasible team(s) found within the horizon ending ${horizonEnd}.`,
    searched: { ...searched, horizonEnd, combinationBudgetPerDate: budget },
    unavailableOnFirstDate: firstDateDiagnostics ?? [],
    tieBreakRules: TIE_BREAK_RULES,
  };
}
