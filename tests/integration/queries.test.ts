import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { dashboard, expenseSummary, plannedVsActual } from "@/server/queries/dashboard";
import { planningBoard, planningSheet, visitDetail } from "@/server/queries/planning";
import { listProjects, projectDetail } from "@/server/queries/projects";
import { employeeProfile, listEmployees } from "@/server/queries/people";
import { approvalQueues, myDay, timesheet } from "@/server/queries/time";
import { installationTracker, issuesTracker, manpowerTracker } from "@/server/queries/trackers";
import { costTracker, ftrTracker } from "@/server/queries/trackers-quality-cost";
import { kraReview } from "@/server/queries/kra";
import { toCsv } from "@/lib/csv";
import { AppError } from "@/server/errors";
import { actor, freshDb, idOf } from "./helpers";

const NOW = Date.parse("2026-10-21T06:00:00Z");
let db: Db;
beforeAll(async () => { db = await freshDb({ operational: true }); }, 240_000);
afterAll(async () => { await db?.close(); });

describe("operational seed and read models", () => {
  it("creates the demo storyline through the services", async () => {
    const [v] = await db.query<{ n: number; completed: number; follow: number }>(
      "select count(*)::int n, count(*) filter (where exec_status = 'completed')::int completed, count(*) filter (where visit_type = 'follow_up')::int follow from visit");
    expect(v!.completed).toBe(1);
    expect(v!.follow).toBe(1);
    const [carried] = await db.query<{ q: string }>("select vt.scoped_quantity::int::text q from visit_task vt join visit v on v.id = vt.visit_id where v.visit_type = 'follow_up'");
    expect(carried!.q).toBe("6");
    const [ot] = await db.query<{ decision: string }>("select decision from ot_request limit 1");
    expect(ot!.decision).toBe("ineligible");
  });

  it("scenario 21: dashboard figures match their detail rows", async () => {
    const mgr = await actor(db, "EMP-001");
    const d = await dashboard(db, mgr, { month: "2026-10" }, NOW);
    const queues = await approvalQueues(db, mgr);
    const pending = d.metrics.find((m) => m.id === "approvals")!;
    expect(Number(pending.value)).toBe(queues.plans.length + queues.time.length + queues.overtime.length + queues.expenses.length);
    expect(queues.time.length).toBe(1);
    expect(queues.plans.length).toBe(1);
    const sheet = await planningSheet(db, mgr, {}, NOW);
    expect(Number(d.metrics.find((m) => m.id === "conflicts")!.value)).toBe(sheet.filter((r) => r.conflicts.length && r.plannedStart && r.plannedStart >= d.today).length);
    const pva = await plannedVsActual(db, mgr, "2026-10");
    // 3 people x 3 days x 8h, plus 2h late on one day, minus the entry still awaiting review (8h).
    expect(pva.actualWorkMinutes).toBe((3 * 3 * 480 + 120) - 480);
    const exp = await expenseSummary(db, mgr);
    const prj1 = exp.find((e) => e.business_id === "PRJ-001")!;
    expect(prj1.actual).toBe(280000);
    expect(prj1.submitted).toBe(255000);
    expect(prj1.estimate).toBe(3 * 3 * 30000 + 6 * 45000 + 250000);
    expect(prj1.budgetVariancePercent).toBeNull(); // no approved budget -> N/A, not 0%
  });

  it("scopes reads to the actor", async () => {
    const outsider = await actor(db, "EMP-003");
    const projects = await listProjects(db, outsider);
    expect(projects.map((p) => p.business_id)).not.toContain("PRJ-001");
    await expect(projectDetail(db, outsider, await idOf(db, "project", "PRJ-001"))).rejects.toBeInstanceOf(AppError);
    const employee = await actor(db, "EMP-030");
    expect((await listEmployees(db, employee)).map((e) => e.business_id)).toEqual(["EMP-030"]);
    const [someone] = await db.query<{ id: string }>("select id from employee where business_id = 'EMP-031'");
    await expect(employeeProfile(db, employee, someone!.id, NOW)).rejects.toBeInstanceOf(AppError);
  });

  it("renders every read model on the seed", async () => {
    const admin = await actor(db, "EMP-004");
    const board = await planningBoard(db, admin, { from: "2026-10-12", days: 28 }, NOW);
    expect(board.rows.some((r) => r.segments.some((s) => s.kind === "confirmed"))).toBe(true);
    expect(board.rows.some((r) => r.segments.some((s) => s.kind === "leave"))).toBe(true);
    const sheet = await planningSheet(db, admin, {}, NOW);
    expect(sheet.length).toBeGreaterThanOrEqual(3);
    const detail = await projectDetail(db, admin, await idOf(db, "project", "PRJ-001"));
    const shutters = detail.scope.find((t) => t.task_bid === "TSK-006")!;
    expect([shutters.accepted, shutters.remaining].map(Number)).toEqual([6, 6]);
    const vd = await visitDetail(db, admin, sheet[0]!.visitId, NOW);
    expect(vd.readiness.length).toBe(6);
    const crewMember = (await db.query<{ employee_id: string }>("select employee_id from reservation where state = 'confirmed' limit 1"))[0]!.employee_id;
    const ts = await timesheet(db, admin, crewMember, { from: "2026-10-12", days: 7 }, NOW);
    expect(ts.entries.length).toBe(3);
    expect(ts.reconciliation.canFinalize).toBe(false); // illustrative draft policy keeps the month provisional
    await myDay(db, admin, NOW);
    await employeeProfile(db, admin, crewMember, NOW);
  });

  it("scenarios 37-42: trackers, KRA review and safe exports", async () => {
    const admin = await actor(db, "EMP-004");
    const inst = await installationTracker(db, admin, {}, NOW);
    const ord1 = inst.rows.find((r) => r.orderId === "ORD-001")!;
    expect(ord1.projectId).toBe("PRJ-001");
    expect(ord1.customerId).toBe("CUS-001");
    expect(ord1.actualCompletion).toBeNull(); // shutters remain
    expect(ord1.delayReason).toContain("materials");
    const man = await manpowerTracker(db, admin, { month: "2026-10" });
    const day = man.rows.find((r) => r.date === "2026-10-12")!;
    expect(day.plannedHours).toBe(24);
    expect(day.output).toContain("12 unit carcass_count");
    expect(day.kitchensCompleted).toBe(0);
    const ftr = await ftrTracker(db, admin, {});
    const f1 = ftr.rows.find((r) => r.orderId === "ORD-001")!;
    expect(f1.completedFirstVisit).toBe("N");
    expect(f1.unplannedReturns).toBe(1);
    expect(f1.complaint).toBe("Y");
    const cost = await costTracker(db, admin, { month: "2026-10" });
    expect(cost.rows.map((r) => r.loadId)).toContain("LOAD-0412");
    expect(cost.projects.find((p) => p.projectId === "PRJ-001")!.verifiedSavingsMinor).toBe(0);
    const issues = await issuesTracker(db, admin, {});
    expect(issues.rows[0]!.owner).toBeTruthy();
    // Every workbook header is mapped to a column.
    for (const t of [inst, man, ftr, cost, issues]) expect(t.columns.every((c) => c.source.length > 0)).toBe(true);
    const kra = await kraReview(db, admin, { month: "2026-10" }, NOW);
    expect(kra.rows).toHaveLength(8);
    expect(kra.rows.every((r) => r.status === "Not rated")).toBe(true);
    expect(kra.rows.find((r) => r.code === "ftr_rate")!.actual).toBe("Not rated");
    expect(kra.rows.find((r) => r.code === "installation_days")!.targetText).toContain("reference target: 6 days");
    const csv = toCsv(issues.columns.map((c) => c.label), issues.rows.map((r) => issues.columns.map((c) => r[c.key])), [["View", issues.title]]);
    expect(csv.split("\r\n").length).toBeGreaterThan(2);
  });
});
