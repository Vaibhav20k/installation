import { describe, expect, it } from "vitest";
import { checkCrewPresence, evaluateCoverage, qualifiesThroughout, type EmployeeSkillRecord, type SkillRequirement } from "@/domain/skills";
import { suggestTeams, evaluateTeam, type Candidate, type SuggestInput } from "@/domain/team-suggest";
import { zonedToUtc, addDays } from "@/lib/dates";

const TZ = "Asia/Kolkata";
const v = (skillCode: string, level: 1 | 2 | 3, extra: Partial<EmployeeSkillRecord> = {}): EmployeeSkillRecord => ({ skillCode, level, verified: true, validFrom: null, validTo: null, ...extra });
const dates = ["2026-11-02", "2026-11-03"];

describe("scenario 2: verification", () => {
  it("unverified High does not qualify as verified High", () => {
    const r = qualifiesThroughout([v("carpentry", 3, { verified: false })], "carpentry", 3, dates);
    expect(r.ok).toBe(false);
    expect(r.failed[0]!.reason).toContain("not verified");
  });
  it("several Low employees cannot replace one High", () => {
    const req: SkillRequirement[] = [{ id: "r1", skillCode: "stone", minLevel: 3, headcount: 1, mode: "collective" }];
    const team = ["a", "b", "c"].map((id) => ({ id, jobRole: "technician", skills: [v("stone", 1)] }));
    expect(evaluateCoverage(team, req, dates).met).toBe(false);
  });
});

describe("scenario 25: skill expiry and crew presence", () => {
  it("flags a skill expiring midway through the work", () => {
    const r = qualifiesThroughout([v("stone", 3, { validTo: "2026-11-02" })], "stone", 3, dates);
    expect(r.ok).toBe(false);
    expect(r.failed.map((f) => f.date)).toEqual(["2026-11-03"]);
  });
  it("senior + helper with disjoint slots fail despite enough total role-hours", () => {
    const d = "2026-11-02";
    const senior = { employeeId: "s", role: "senior_technician", intervals: [{ start: zonedToUtc(d, "10:00", TZ), end: zonedToUtc(d, "14:00", TZ) }] };
    const helper = { employeeId: "h", role: "helper", intervals: [{ start: zonedToUtc(d, "14:00", TZ), end: zonedToUtc(d, "18:00", TZ) }] };
    const r = checkCrewPresence(["senior_technician", "helper"], 120, [senior, helper]);
    expect(r.ok).toBe(false);
    expect(r.togetherMinutes).toBe(0);
    const overlapHelper = { ...helper, intervals: [{ start: zonedToUtc(d, "12:00", TZ), end: zonedToUtc(d, "16:00", TZ) }] };
    expect(checkCrewPresence(["senior_technician", "helper"], 120, [senior, overlapHelper]).ok).toBe(true);
  });
});

describe("scenario 3: collective coverage with distinct people", () => {
  const reqs: SkillRequirement[] = [
    { id: "carp", skillCode: "carpentry", minLevel: 3, headcount: 1, mode: "collective", concurrencyGroup: "site" },
    { id: "stone", skillCode: "stone", minLevel: 2, headcount: 1, mode: "collective", concurrencyGroup: "site" },
    { id: "assist", skillCode: "assembly", minLevel: 1, headcount: 1, mode: "collective", concurrencyGroup: "site" },
  ];
  it("a three-person team meets collective requirements", () => {
    const team = [
      { id: "a", jobRole: "carpenter", skills: [v("carpentry", 3)] },
      { id: "b", jobRole: "stone_technician", skills: [v("stone", 2)] },
      { id: "c", jobRole: "helper", skills: [v("assembly", 1)] },
    ];
    expect(evaluateCoverage(team, reqs, dates).met).toBe(true);
  });
  it("one multi-skilled employee cannot fill two simultaneous slots", () => {
    const team = [
      { id: "a", jobRole: "senior_technician", skills: [v("carpentry", 3), v("stone", 3)] },
      { id: "c", jobRole: "helper", skills: [v("assembly", 1)] },
      { id: "d", jobRole: "helper", skills: [v("assembly", 1)] },
    ];
    const r = evaluateCoverage(team, reqs, dates);
    expect(r.met).toBe(false);
    expect(r.results.find((x) => !x.met)!.message).toContain("cannot fill two simultaneous slots");
  });
});

function input(cands: Candidate[], extra: Partial<SuggestInput> = {}): SuggestInput {
  return {
    candidates: cands,
    requirements: [
      { id: "carp", skillCode: "carpentry", minLevel: 3, headcount: 1, mode: "collective", concurrencyGroup: "site" },
      { id: "asm", skillCode: "assembly", minLevel: 1, headcount: 2, mode: "collective", concurrencyGroup: "site" },
    ],
    teamSize: 3, spanDays: 3, earliestStart: "2026-11-02", horizonDays: 14,
    workingWeekdays: [1, 2, 3, 4, 5, 6], continuity: "preferred",
    spanFor: (s) => ({ start: zonedToUtc(s, "00:00", TZ), end: zonedToUtc(addDays(s, 3), "00:00", TZ) }),
    ...extra,
  };
}
const cand = (id: string, skills: EmployeeSkillRecord[], blocking: Array<[string, string]> = [], workload = 0): Candidate => ({
  id, name: id.toUpperCase(), jobRole: "technician", active: true, skills, workloadMinutes: workload,
  blocking: blocking.map(([a, b]) => ({ start: zonedToUtc(a, "00:00", TZ), end: zonedToUtc(b, "00:00", TZ) })),
});

describe("scenario 4: preferred returning team", () => {
  const busyLead = cand("e01", [v("carpentry", 3)], [["2026-11-01", "2026-11-07"]]);
  const cands = [busyLead, cand("e02", [v("assembly", 1)]), cand("e03", [v("assembly", 2)]), cand("e04", [v("carpentry", 3)], [], 600), cand("e05", [v("assembly", 1)])];
  it("shows alternatives now and the preferred team at its next feasible date", () => {
    const r = suggestTeams(input(cands, { preferredTeam: ["e01", "e02", "e03"] }));
    expect(r.earliest!.start).toBe("2026-11-02");
    expect(r.earliest!.memberIds).not.toContain("e01");
    expect(r.strongestContinuity!.memberIds).toEqual(["e01", "e02", "e03"]);
    expect(r.strongestContinuity!.start).toBe("2026-11-07");
    expect(r.unavailableOnFirstDate.find((d) => d.id === "e01")!.reasons[0]).toContain("reserved");
  });
  it("mandatory continuity blocks substitution", () => {
    const r = suggestTeams(input(cands, { preferredTeam: ["e01", "e02", "e03"], continuity: "mandatory" }));
    expect(r.options.every((o) => ["e01", "e02", "e03"].every((id) => o.memberIds.includes(id)))).toBe(true);
    expect(r.earliest!.start).toBe("2026-11-07");
    expect(evaluateTeam(input(cands, { preferredTeam: ["e01", "e02", "e03"], continuity: "mandatory" }), ["e02", "e03", "e04"], "2026-11-02").ok).toBe(false);
  });
});

describe("scenario 26: team size and bounded search", () => {
  const cands = [cand("e01", [v("carpentry", 3)]), cand("e02", [v("assembly", 1)]), cand("e03", [v("assembly", 1)]), cand("e04", [v("assembly", 1)])];
  it("changing team size to four changes validation without a hidden 3-person limit", () => {
    const r3 = suggestTeams(input(cands, { continuity: "none" }));
    expect(r3.earliest!.memberIds).toHaveLength(3);
    const r4 = suggestTeams(input(cands, { continuity: "none", teamSize: 4 }));
    expect(r4.earliest!.memberIds).toHaveLength(4);
    expect(evaluateTeam(input(cands, { teamSize: 4 }), ["e01", "e02", "e03"], "2026-11-02").problems[0]).toContain("team size is 4");
  });
  it("reaching the horizon returns a bounded-search statement, not impossibility", () => {
    const r = suggestTeams(input([cand("e02", [v("assembly", 1)])], { horizonDays: 5 }));
    expect(r.noSolutionWithinHorizon).toBe(true);
    expect(r.resultStatement).toContain("bounded search result, not proof");
  });
  it("is deterministic and shows tie-break rules", () => {
    const a = suggestTeams(input(cands, { continuity: "none" }));
    const b = suggestTeams(input([...cands].reverse(), { continuity: "none" }));
    expect(a.options.map((o) => o.memberIds)).toEqual(b.options.map((o) => o.memberIds));
    expect(a.tieBreakRules.length).toBeGreaterThan(2);
  });
});
