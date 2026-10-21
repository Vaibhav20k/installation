import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { makeCtx, type Ctx } from "@/server/services/context";
import { approvePlan, commitScope, createPlan, createPlanRevision, createVisit, setSkillRequirements, submitPlan } from "@/server/services/planning";
import { bookVisit, holdCapacity, setVisitStaffing, suggestTeamsForVisit } from "@/server/services/booking";
import { grantClearanceException, setClearance } from "@/server/services/clearance";
import { AppError } from "@/server/errors";
import { actor, freshDb, idOf } from "./helpers";

const NOW = Date.parse("2026-10-22T05:00:00Z");
let db: Db;
const ctxs: Record<string, Ctx> = {};
const as = async (bid: string, now = NOW) => makeCtx(db, ctxs[bid]?.actor ?? (await actor(db, bid)), now);
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };

async function skill(code: string) { const [r] = await db.query<{ id: string }>("select id from skill where code = $1", [code]); return r!.id; }
async function task(bid: string) { return idOf(db, "installation_task", bid); }

/** Draft plan with one visit, scope and requirements on PRJ-001 by supervisor EMP-005. */
async function draftVisit(start: string, end: string, extra: Record<string, unknown> = {}) {
  const sup = await as("EMP-005");
  const plan = await createPlan(sup, { projectId: await idOf(db, "project", "PRJ-001") });
  const visit = await createVisit(sup, { planId: plan.id, visitType: "fresh", plannedStart: start, plannedEnd: end, orderIds: [await idOf(db, "sales_order", "ORD-001")], ...extra });
  await setSkillRequirements(sup, { visitId: visit.id, requirements: [
    { skillId: await skill("carpentry"), minLevel: 3, headcount: 1, mode: "collective" },
    { skillId: await skill("assembly"), minLevel: 1, headcount: 2, mode: "collective" },
  ] });
  return { plan, visit, sup };
}

beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db?.close(); });

describe("planning and booking", () => {
  it("scenario 1: a visit cannot link an order from another project", async () => {
    const sup = await as("EMP-005");
    const plan = await createPlan(sup, { projectId: await idOf(db, "project", "PRJ-001") });
    const other = await idOf(db, "sales_order", "ORD-003");
    expect(await kind(createVisit(sup, { planId: plan.id, visitType: "fresh", orderIds: [other] }))).toBe("validation");
  });

  it("supervisor outside the project's scope is forbidden", async () => {
    const outsider = await as("EMP-006"); // reports to EMP-002, who does not manage PRJ-001
    expect(await kind(createPlan(outsider, { projectId: await idOf(db, "project", "PRJ-001") }))).toBe("forbidden");
  });

  it("scenario 24: the same remaining shutters cannot be committed to two visits", async () => {
    const a = await draftVisit("2026-11-16", "2026-11-17");
    const b = await draftVisit("2026-11-18", "2026-11-19");
    const shutters = await task("TSK-006");
    const results = await Promise.allSettled([
      commitScope(a.sup, { visitId: a.visit.id, taskId: shutters, quantity: "12" }),
      commitScope(b.sup, { visitId: b.visit.id, taskId: shutters, quantity: "12" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await kind(commitScope(b.sup, { visitId: b.visit.id, taskId: shutters, quantity: "1" }))).toBe("conflict");
  });

  it("scenarios 8 and 9: approval, blocked booking without clearance, exception, immutable baseline", async () => {
    const { plan, visit, sup } = await draftVisit("2026-11-02", "2026-11-06");
    await commitScope(sup, { visitId: visit.id, taskId: await task("TSK-007"), quantity: "320" });
    const options = await suggestTeamsForVisit(sup, { visitId: visit.id });
    expect(options.earliest).not.toBeNull();
    expect(options.earliest!.members).toHaveLength(3);
    await setVisitStaffing(sup, { visitId: visit.id, employeeIds: options.earliest!.memberIds });
    await submitPlan(sup, { planId: plan.id });
    expect(await kind(approvePlan(sup, { planId: plan.id }))).toBe("forbidden");
    const mgr = await as("EMP-001");
    await approvePlan(mgr, { planId: plan.id });

    expect(await kind(bookVisit(mgr, { visitId: visit.id }))).toBe("forbidden");
    const ver = async (gate: string) => (await db.query<{ version: number }>("select version from clearance where visit_id = $1 and gate = $2", [visit.id, gate]))[0]!.version;
    await setClearance(mgr, { visitId: visit.id, gate: "site", status: "cleared", version: await ver("site"), evidence: "Site photos 21 Oct", validUntil: "2026-12-31" });
    await setClearance(mgr, { visitId: visit.id, gate: "installation", status: "cleared", version: await ver("installation"), evidence: "Drawings signed" });
    expect(await kind(bookVisit(mgr, { visitId: visit.id }))).toBe("forbidden"); // accounts still pending
    expect(await kind(grantClearanceException(await as("EMP-002"), { visitId: visit.id, gate: "accounts", reason: "Urgent handover", conditions: "Balance before handover", validUntil: "2026-11-30" }))).toBe("forbidden");
    await grantClearanceException(mgr, { visitId: visit.id, gate: "accounts", reason: "Customer urgent move-in", conditions: "Balance paid before handover", validUntil: "2026-11-30" });
    const booked = await bookVisit(mgr, { visitId: visit.id, idempotencyKey: "book-test-0001" });
    expect(booked.confirmed).toBe(3);
    expect(booked.exceptionsUsed[0]).toContain("accounts");
    // Replaying the same idempotency key does not book twice.
    expect(await bookVisit(mgr, { visitId: visit.id, idempotencyKey: "book-test-0001" })).toEqual(booked);

    const [p] = await db.query<{ baseline_revision_id: string }>("select baseline_revision_id from plan where id = $1", [plan.id]);
    const before = await db.query<{ snapshot: unknown }>("select snapshot from plan_revision where id = $1", [p!.baseline_revision_id]);
    await createPlanRevision(sup, { planId: plan.id, changeReason: "Customer asked for an extra helper" });
    await setSkillRequirements(sup, { visitId: visit.id, requirements: [{ skillId: await skill("assembly"), minLevel: 1, headcount: 3, mode: "collective" }] });
    const after = await db.query<{ snapshot: unknown }>("select snapshot from plan_revision where id = $1", [p!.baseline_revision_id]);
    expect(after[0]!.snapshot).toEqual(before[0]!.snapshot);
    await expect(db.query("update plan_revision set change_reason = 'x' where id = $1", [p!.baseline_revision_id])).rejects.toThrow();
  });

  it("scenario 7: concurrent bookings for the same employee cannot both succeed", async () => {
    const mgr = await as("EMP-001");
    const a = await draftVisit("2026-11-23", "2026-11-25");
    const b = await draftVisit("2026-11-24", "2026-11-26");
    for (const v of [a, b]) await commitScope(v.sup, { visitId: v.visit.id, taskId: await task("TSK-008"), quantity: v === a ? "20" : "25" });
    const opts = await suggestTeamsForVisit(a.sup, { visitId: a.visit.id });
    // Proposed staffing does not block, so both visits can propose the same people.
    await setVisitStaffing(a.sup, { visitId: a.visit.id, employeeIds: opts.earliest!.memberIds });
    await setVisitStaffing(b.sup, { visitId: b.visit.id, employeeIds: opts.earliest!.memberIds });
    for (const v of [a, b]) {
      await submitPlan(v.sup, { planId: v.plan.id });
      await approvePlan(mgr, { planId: v.plan.id });
      for (const gate of ["site", "installation", "accounts"]) {
        const [c] = await db.query<{ version: number }>("select version from clearance where visit_id = $1 and gate = $2", [v.visit.id, gate]);
        await setClearance(mgr, { visitId: v.visit.id, gate, status: "cleared", version: c!.version, evidence: "ok" });
      }
    }
    const results = await Promise.allSettled([bookVisit(mgr, { visitId: a.visit.id }), bookVisit(await as("EMP-001"), { visitId: b.visit.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as AppError).kind).toBe("conflict");
  });

  it("scenario 27: held slots block until expiry; proposed ones never block", async () => {
    const mgr = await as("EMP-001");
    const a = await draftVisit("2026-12-07", "2026-12-08");
    const opts = await suggestTeamsForVisit(a.sup, { visitId: a.visit.id });
    const team = opts.earliest!.memberIds;
    await setVisitStaffing(a.sup, { visitId: a.visit.id, employeeIds: team });
    const b = await draftVisit("2026-12-07", "2026-12-08");
    const before = await suggestTeamsForVisit(b.sup, { visitId: b.visit.id });
    expect(before.earliest!.start).toBe("2026-12-07");
    expect(before.earliest!.memberIds).toEqual(team); // proposals are not reservations

    const held = await holdCapacity(mgr, { visitId: a.visit.id });
    expect(held.held).toBe(3);
    const during = await suggestTeamsForVisit(b.sup, { visitId: b.visit.id });
    expect(during.earliest!.memberIds.some((id) => team.includes(id))).toBe(false);
    const afterExpiry = await suggestTeamsForVisit(await as("EMP-005", held.expiresAt + 1), { visitId: b.visit.id });
    expect(afterExpiry.earliest!.memberIds).toEqual(team);
  });

  it("scenarios 4 and 26: mandatory continuity and configurable team size", async () => {
    const a = await draftVisit("2026-12-14", "2026-12-15", { continuity: "mandatory", preferredTeamId: (await db.query<{ id: string }>("select id from team where business_id='TEAM-01'"))[0]!.id });
    const r = await suggestTeamsForVisit(a.sup, { visitId: a.visit.id });
    const preferred = r.preferredTeam.map((p) => p.id).sort();
    expect(r.options.every((o) => preferred.every((id) => o!.memberIds.includes(id)))).toBe(true);
    const four = await suggestTeamsForVisit(a.sup, { visitId: a.visit.id, teamSize: 4 });
    expect(four.options.every((o) => o!.memberIds.length === 4)).toBe(true);
    const tiny = await suggestTeamsForVisit(a.sup, { visitId: a.visit.id, teamSize: 1, horizonDays: 3 });
    expect(tiny.noSolutionWithinHorizon).toBe(true);
    expect(tiny.resultStatement).toContain("not proof");
  });
});
