import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { makeCtx } from "@/server/services/context";
import { approvePlan, commitScope, createPlan, createVisit, setSkillRequirements, submitPlan } from "@/server/services/planning";
import { bookVisit, setVisitStaffing, suggestTeamsForVisit } from "@/server/services/booking";
import { setClearance, setReadinessCheck } from "@/server/services/clearance";
import { createFollowUpVisit, recordProgress, setDailyTarget, freezeDailyTargets, transferOutstandingScope, transitionVisit } from "@/server/services/execution";
import { amendTimeEntry, createTimeEntry, requestOvertime, reviewEligibility, reviewTimeEntry, submitTimeEntries } from "@/server/services/time";
import { finalizeMonth, reconcileMonth } from "@/server/services/reconciliation";
import { approvePolicy, createPolicyVersion, updateDraftPolicy } from "@/server/services/settings";
import { allocateExpense, approveExpense, createEstimate, submitExpense } from "@/server/services/expenses";
import { AppError } from "@/server/errors";
import { actor, freshDb, idOf } from "./helpers";

let db: Db;
const T0 = Date.parse("2026-10-22T05:00:00Z");
const DURING = Date.parse("2026-11-02T04:00:00Z");
const MONTH_END = Date.parse("2026-12-02T05:00:00Z");
const as = async (bid: string, now = T0) => makeCtx(db, await actor(db, bid), now);
const asId = async (id: string, now = T0) => makeCtx(db, (await loadActor(db, id))!, now);
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };
const skill = async (code: string) => (await db.query<{ id: string }>("select id from skill where code = $1", [code]))[0]!.id;
const vt = async (visitId: string, task: string, kindName = "original") => (await db.query<{ id: string }>(
  "select vt.id from visit_task vt join installation_task t on t.id = vt.task_id where vt.visit_id = $1 and t.business_id = $2 and vt.kind = $3", [visitId, task, kindName]))[0]!.id;

let visitId = "", planId = "", memberId = "";
const entryIds: string[] = [];

beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db?.close(); });

describe("project -> plan -> execution -> timesheet -> reconciliation", () => {
  it("plans, books and deploys a visit only after clearance and readiness", async () => {
    const sup = await as("EMP-005");
    const mgr = await as("EMP-001");
    planId = (await createPlan(sup, { projectId: await idOf(db, "project", "PRJ-001") })).id;
    visitId = (await createVisit(sup, { planId, visitType: "fresh", plannedStart: "2026-11-02", plannedEnd: "2026-11-04", orderIds: [await idOf(db, "sales_order", "ORD-001")] })).id;
    await setSkillRequirements(sup, { visitId, requirements: [{ skillId: await skill("assembly"), minLevel: 1, headcount: 3, mode: "collective" }] });
    await commitScope(sup, { visitId, taskId: await idOf(db, "installation_task", "TSK-003"), quantity: "24" });
    await commitScope(sup, { visitId, taskId: await idOf(db, "installation_task", "TSK-006"), quantity: "12" });
    const opts = await suggestTeamsForVisit(sup, { visitId });
    // A member with plain employee permission (UUID order is random; a supervisor could record for others).
    const roles = await db.query<{ id: string }>("select id from employee where id = any($1::uuid[]) and permission_role = 'employee' order by business_id", [opts.earliest!.memberIds]);
    memberId = roles[0]!.id;
    await setVisitStaffing(sup, { visitId, employeeIds: opts.earliest!.memberIds });
    await submitPlan(sup, { planId });
    await approvePlan(mgr, { planId });
    for (const gate of ["accounts", "site", "installation"]) {
      const [c] = await db.query<{ version: number }>("select version from clearance where visit_id = $1 and gate = $2", [visitId, gate]);
      await setClearance(mgr, { visitId, gate, status: "cleared", version: c!.version, evidence: "Demo evidence" });
    }
    await bookVisit(mgr, { visitId });
    const version = async () => (await db.query<{ version: number }>("select version from visit where id = $1", [visitId]))[0]!.version;
    expect(await kind(transitionVisit(await as("EMP-005", DURING), { visitId, to: "in_progress", version: await version() }))).toBe("forbidden");
    for (const check of ["site_access", "materials", "drawings", "tools", "customer_confirmation", "skill_coverage"]) {
      await setReadinessCheck(sup, { visitId, checkCode: check, result: "pass", evidence: "Checked on site" });
    }
    await transitionVisit(await as("EMP-005", DURING), { visitId, to: "in_progress", version: await version() });
  });

  it("scenario 29: a frozen daily target edited later stays in history", async () => {
    const sup = await as("EMP-005", DURING);
    const shutters = await vt(visitId, "TSK-006");
    await setDailyTarget(sup, { visitTaskId: shutters, planDate: "2026-11-02", targetQuantity: "6" });
    await freezeDailyTargets(sup, { visitId, planDate: "2026-11-02" });
    expect(await kind(setDailyTarget(sup, { visitTaskId: shutters, planDate: "2026-11-02", targetQuantity: "4" }))).toBe("validation");
    await setDailyTarget(sup, { visitTaskId: shutters, planDate: "2026-11-02", targetQuantity: "4", changeReason: "Two shutters damaged in transit" });
    const rows = await db.query<{ target_quantity: string; is_current: boolean }>("select target_quantity::text, is_current from daily_target where visit_task_id = $1 order by created_at", [shutters]);
    expect(rows.map((r) => [Number(r.target_quantity), r.is_current])).toEqual([[6, false], [4, true]]);
  });

  it("scenario 10: carcasses done, shutters partly; follow-up carries only remaining shutters", async () => {
    const sup = await as("EMP-005", DURING);
    await recordProgress(sup, { visitTaskId: await vt(visitId, "TSK-003"), quantityDelta: "24", evidence: "Photos" });
    const p = await recordProgress(sup, { visitTaskId: await vt(visitId, "TSK-006"), quantityDelta: "6" });
    expect(p.remaining).toBe("6");
    // Additional scope is approved (as its own visit task) before the extra work it authorizes.
    const extra = await commitScope(sup, { visitId, taskId: await idOf(db, "installation_task", "TSK-007"), quantity: "10", kind: "additional", changeReason: "Customer added pantry unit" });
    await recordProgress(sup, { visitTaskId: extra.id, quantityDelta: "10" });
    const version = async () => (await db.query<{ version: number }>("select version from visit where id = $1", [visitId]))[0]!.version;
    expect(await kind(transitionVisit(sup, { visitId, to: "completed", version: await version() }))).toBe("conflict");
    await transferOutstandingScope(await as("EMP-001", DURING), { visitTaskId: await vt(visitId, "TSK-006"), reason: "Shutters short-shipped; follow-up visit" });
    await transitionVisit(sup, { visitId, to: "completed", version: await version() });
    const follow = await createFollowUpVisit(sup, { fromVisitId: visitId, visitType: "follow_up", repeatReason: "material_shortage", plannedStart: "2026-11-16", plannedEnd: "2026-11-16", changeReason: "Follow-up for remaining shutters" });
    expect(follow.carried).toEqual([{ task: "TSK-006", quantity: "6" }]);
    // Completed carcasses return only as explicit rework.
    expect(await kind(commitScope(sup, { visitId: follow.id, taskId: await idOf(db, "installation_task", "TSK-003"), quantity: "2" }))).toBe("conflict");
    expect(await kind(commitScope(sup, { visitId: follow.id, taskId: await idOf(db, "installation_task", "TSK-003"), quantity: "2", kind: "rework", changeReason: "Hinge alignment rework" }))).toBe("ok");
  });

  it("scenarios 11 and 20: actual time is kept; employees cannot approve their own time or record others'", async () => {
    const me = await asId(memberId, DURING);
    for (const date of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
      const r = await createTimeEntry(me, { employeeId: memberId, projectId: await idOf(db, "project", "PRJ-001"), visitId, activity: "installation",
        start: { date, time: "10:00" }, end: { date, time: "22:00" }, breaks: [{ start: { date, time: "13:00" }, end: { date, time: "14:00" } }] });
      expect(r.netMinutes).toBe(660);
      expect(r.isException).toBe(false);
      entryIds.push(r.id);
    }
    // Someone else with plain employee permission (the team member is chosen in random UUID order, so never assume who).
    const other = (await db.query<{ id: string }>("select id from employee where permission_role = 'employee' and id <> $1 order by business_id desc limit 1", [memberId]))[0]!.id;
    expect(await kind(createTimeEntry(me, { employeeId: other, overheadCategory: "training", activity: "other", start: { date: "2026-11-05", time: "10:00" }, end: { date: "2026-11-05", time: "11:00" } }))).toBe("forbidden");
    await submitTimeEntries(me, { entryIds });
    expect(await kind(reviewTimeEntry(me, { entryId: entryIds[0], decision: "accepted" }))).toBe("forbidden");
    const admin = await as("EMP-004", DURING);
    for (const id of entryIds) await reviewTimeEntry(admin, { entryId: id, decision: "accepted" });

    const catchUp = await requestOvertime(me, { entryId: entryIds[0], start: { date: "2026-11-02", time: "20:00" }, end: { date: "2026-11-02", time: "22:00" }, claimedReason: "Stayed to finish shutters" });
    const decision = await reviewEligibility(admin, { requestId: catchUp.id, verifiedReason: "original_target_catch_up" });
    expect(decision.status).toBe("ineligible");
    const [net] = await db.query<{ m: number }>("select (extract(epoch from upper(span) - lower(span))/60)::int m from time_entry where id = $1", [entryIds[0]]);
    expect(net!.m).toBe(720); // gross span untouched; break stored separately
  });

  it("scenarios 15, 31 and 33: monthly finalization with a concurrent approval allocates minutes once", async () => {
    const admin = await as("EMP-004", DURING);
    const sup = await as("EMP-005", DURING);
    const additional = await vt(visitId, "TSK-007", "additional");
    expect(await kind(commitScope(sup, { visitId, taskId: await idOf(db, "installation_task", "TSK-007"), quantity: "1", kind: "additional", changeReason: "late" }))).toBe("conflict");
    const nov = await createPolicyVersion(admin, { fromPolicyId: (await db.query<{ id: string }>("select id from time_policy where business_id = 'POL-001'"))[0]!.id, effectiveMonth: "2026-11" });
    await updateDraftPolicy(admin, { policyId: nov.id, fixedMonthlyMinutes: 1200, catchUpThresholdCredit: "exclude", allocationMethod: "chronological", leaveAdjustment: "subtract_scheduled_net" });
    // Four eyes: the administrator drafts the version; another policy_activate holder approves it.
    expect(await kind(approvePolicy(admin, { policyId: nov.id, acknowledgeIllustrative: true }))).toBe("forbidden");
    await approvePolicy(await as("EMP-001", DURING), { policyId: nov.id, acknowledgeIllustrative: true });
    const me = await asId(memberId, DURING);
    const req = await requestOvertime(me, { entryId: entryIds[1], start: { date: "2026-11-03", time: "20:00" }, end: { date: "2026-11-03", time: "22:00" }, claimedReason: "Pantry unit added by customer" });
    expect((await reviewEligibility(admin, { requestId: req.id, verifiedReason: "authorized_additional_scope", authorizationRef: additional })).status).toBe("eligible");


    const early = await reconcileMonth(admin, { employeeId: memberId, month: "2026-11" });
    expect(early.blockers.join(" ")).toContain("has not ended");
    expect([early.N, early.Q, early.X, early.E, early.cap]).toEqual([1200, 1860, 660, 120, 120]);

    const late = await as("EMP-004", MONTH_END);
    const results = await Promise.allSettled([finalizeMonth(late, { employeeId: memberId, month: "2026-11" }), finalizeMonth(await as("EMP-004", MONTH_END), { employeeId: memberId, month: "2026-11" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [alloc] = await db.query<{ n: number; m: number }>("select count(*)::int n, sum(minutes)::int m from reconciliation_allocation where employee_id = $1 and active", [memberId]);
    expect(alloc).toEqual({ n: 1, m: 120 });
  });

  it("scenarios 17 and 30: amending accepted time invalidates the final month and old revisions leave the totals", async () => {
    const me = await asId(memberId, MONTH_END);
    const date = "2026-11-04";
    const r = await amendTimeEntry(me, { entryId: entryIds[2], employeeId: memberId, projectId: await idOf(db, "project", "PRJ-001"), visitId, activity: "installation",
      start: { date, time: "10:00" }, end: { date, time: "20:00" }, breaks: [{ start: { date, time: "13:00" }, end: { date, time: "14:00" } }], reason: "End time was mistyped" });
    expect(r.invalidatedMonths).toEqual(["2026-11"]);
    const [act] = await db.query<{ n: number }>("select count(*)::int n from reconciliation_allocation where employee_id = $1 and active", [memberId]);
    expect(act!.n).toBe(0);
    const again = await reconcileMonth(await as("EMP-004", MONTH_END), { employeeId: memberId, month: "2026-11" });
    expect(again.Q).toBe(1200); // the replaced revision and the new draft are both excluded
    expect(again.canFinalize).toBe(false);
  });

  it("scenarios 18 and 19: shared accommodation once; allocations exact; no self-approval", async () => {
    const sup = await as("EMP-005");
    const est = await createEstimate(sup, { projectId: await idOf(db, "project", "PRJ-001"), visitId, lines: [
      { category: "accommodation", basis: "per_room_night", factors: { rooms: 2, nights: 3 }, unitRateMinor: 150000 },
      { category: "meal", basis: "per_person_day", factors: { people: 3, days: 3 }, unitRateMinor: 30000 },
    ] });
    expect(est.totalMinor).toBe(900000 + 270000);
    const exp = await submitExpense(sup, { projectId: await idOf(db, "project", "PRJ-001"), visitId, category: "accommodation", amountMinor: 100001, incurredOn: "2026-11-04", receiptRef: "HOTEL-INV-7" });
    expect(await kind(approveExpense(sup, { expenseId: exp.id, decision: "approved" }))).toBe("forbidden");
    const mgr = await as("EMP-001");
    await approveExpense(mgr, { expenseId: exp.id, decision: "approved" });
    const p = await idOf(db, "project", "PRJ-001");
    const parts = await allocateExpense(mgr, { expenseId: exp.id, targets: [{ projectId: p, weight: 1 }, { projectId: p, weight: 1 }, { projectId: p, weight: 1 }] });
    expect(parts.parts.reduce((a, b) => a + b, 0)).toBe(100001);
  });
});
