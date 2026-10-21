import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { makeCtx } from "@/server/services/context";
import { createTimeEntry, reviewTimeEntry, submitTimeEntries } from "@/server/services/time";
import { approvePlan, commitScope, createPlan, createVisit, submitPlan } from "@/server/services/planning";
import { recordExpenseCredit, submitExpense } from "@/server/services/expenses";
import { AppError } from "@/server/errors";
import { actor, freshDb, idOf } from "./helpers";

const NOW = Date.parse("2026-10-21T06:00:00Z");
let db: Db;
const as = async (bid: string) => makeCtx(db, await actor(db, bid), NOW);
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };
const empId = async (bid: string) => (await db.query<{ id: string }>("select id from employee where business_id = $1", [bid]))[0]!.id;

beforeAll(async () => { db = await freshDb({ operational: true }); }, 240_000);
afterAll(async () => { await db?.close(); });

describe("four-eyes and scope regressions", () => {
  it("a supervisor who records time for a report cannot also accept it", async () => {
    const sup = await as("EMP-005");
    const report = (await db.query<{ id: string }>("select id from employee where manager_id = (select id from employee where business_id = 'EMP-005') order by business_id limit 1"))[0]!.id;
    const e = await createTimeEntry(sup, { employeeId: report, overheadCategory: "training", activity: "other", start: { date: "2026-10-20", time: "10:00" }, end: { date: "2026-10-20", time: "12:00" } });
    await submitTimeEntries(sup, { entryIds: [e.id] });
    expect(await kind(reviewTimeEntry(sup, { entryId: e.id, decision: "accepted" }))).toBe("forbidden");
    expect(await kind(reviewTimeEntry(await as("EMP-004"), { entryId: e.id, decision: "accepted" }))).toBe("ok");
  });

  it("employees cannot submit plans, and the author of a revision cannot approve it through another submitter", async () => {
    const mgr = await as("EMP-001");
    const plan = await createPlan(mgr, { projectId: await idOf(db, "project", "PRJ-001") });
    const v = await createVisit(mgr, { planId: plan.id, visitType: "fresh", plannedStart: "2026-12-21", plannedEnd: "2026-12-22", orderIds: [await idOf(db, "sales_order", "ORD-001")] });
    await commitScope(mgr, { visitId: v.id, taskId: await idOf(db, "installation_task", "TSK-008"), quantity: "10" });
    const employee = makeCtx(db, (await loadActor(db, await empId("EMP-010")))!, NOW);
    expect(await kind(submitPlan(employee, { planId: plan.id }))).toBe("forbidden");
    await submitPlan(await as("EMP-005"), { planId: plan.id });
    expect(await kind(approvePlan(mgr, { planId: plan.id }))).toBe("forbidden");
  });

  it("credits need an approved original, supervisor permission, and cannot exceed it", async () => {
    const prj = await idOf(db, "project", "PRJ-001");
    const pending = await submitExpense(await as("EMP-005"), { projectId: prj, category: "consumables", amountMinor: 5000, incurredOn: "2026-10-15" });
    expect(await kind(recordExpenseCredit(await as("EMP-001"), { expenseId: pending.id, amountMinor: 100, reason: "Refund" }))).toBe("conflict");
    const [approved] = await db.query<{ id: string; amount_minor: number }>("select id, amount_minor from expense where state = 'approved' and not is_credit limit 1");
    const employee = makeCtx(db, (await loadActor(db, await empId("EMP-010")))!, NOW);
    expect(await kind(recordExpenseCredit(employee, { expenseId: approved!.id, amountMinor: 100, reason: "Refund" }))).toBe("forbidden");
    const results = await Promise.allSettled([
      recordExpenseCredit(await as("EMP-001"), { expenseId: approved!.id, amountMinor: approved!.amount_minor, reason: "Full refund A" }),
      recordExpenseCredit(await as("EMP-001"), { expenseId: approved!.id, amountMinor: approved!.amount_minor, reason: "Full refund B" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("idempotency tokens are per user", async () => {
    const a = makeCtx(db, (await loadActor(db, await empId("EMP-031")))!, NOW);
    const b = makeCtx(db, (await loadActor(db, await empId("EMP-032")))!, NOW);
    const entry = (emp: string) => ({ employeeId: emp, overheadCategory: "training", activity: "other" as const, start: { date: "2026-10-19", time: "10:00" }, end: { date: "2026-10-19", time: "11:00" }, idempotencyKey: "shared-token-123" });
    const r1 = await createTimeEntry(a, entry(a.actor.id));
    const r2 = await createTimeEntry(b, entry(b.actor.id));
    expect(r1.id).not.toBe(r2.id);
    expect((await createTimeEntry(a, entry(a.actor.id))).id).toBe(r1.id);
  });
});
