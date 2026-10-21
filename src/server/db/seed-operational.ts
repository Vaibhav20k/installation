/**
 * Operational demo records created through the application services, so every record passed the
 * same validation, permission and audit path as real use. All data is fictional.
 */
import type { Db } from "./client";
import { loadActor } from "../auth/actor";
import { makeCtx } from "../services/context";
import { approvePlan, commitScope, createPlan, createVisit, setSkillRequirements, submitPlan } from "../services/planning";
import { bookVisit, holdCapacity, setVisitStaffing } from "../services/booking";
import { setClearance, setReadinessCheck } from "../services/clearance";
import { createFollowUpVisit, recordAcceptance, recordDelay, recordProgress, setDailyTarget, freezeDailyTargets, transferOutstandingScope, transitionVisit } from "../services/execution";
import { createTimeEntry, requestOvertime, reviewEligibility, reviewTimeEntry, submitTimeEntries } from "../services/time";
import { approveExpense, createEstimate, submitExpense } from "../services/expenses";
import { applySchedule, setScheduleDay } from "../services/schedule";
import { closeQualityCase, createIssue, openQualityCase, createSavingsClaim } from "../services/quality";

const at = (iso: string) => Date.parse(iso);

export async function seedOperational(db: Db) {
  const id = async (table: string, bid: string) => (await db.query<{ id: string }>(`select id from ${table} where business_id = $1`, [bid]))[0]!.id;
  const as = async (bid: string, now: number) => makeCtx(db, (await loadActor(db, await id("employee", bid)))!, now);
  const skill = async (code: string) => (await db.query<{ id: string }>("select id from skill where code = $1", [code]))[0]!.id;
  const version = async (table: string, rowId: string) => (await db.query<{ version: number }>(`select version from ${table} where id = $1`, [rowId]))[0]!.version;
  const clear = async (ctxBid: string, visitId: string, gates: string[], now: number) => {
    for (const gate of gates) {
      const [c] = await db.query<{ version: number }>("select version from clearance where visit_id = $1 and gate = $2", [visitId, gate]);
      await setClearance(await as(ctxBid, now), { visitId, gate, status: "cleared", version: c!.version, evidence: "Demo evidence (fictional)" });
    }
  };

  // Crew from supervisor EMP-005's reports with verified assembly skill, so EMP-005 reviews their time.
  const crew = (await db.query<{ id: string }>(
    `select e.id from employee e join employee_skill es on es.employee_id = e.id join skill s on s.id = es.skill_id
     where e.manager_id = (select id from employee where business_id = 'EMP-005') and e.active and s.code = 'assembly' and es.verified
       and not exists (select 1 from leave_record l where l.employee_id = e.id)
     order by e.business_id limit 3`)).map((r) => r.id);
  if (crew.length < 3) return;

  // Visit A: PRJ-001 kitchen, 12-14 Oct 2026, completed with shutters short-shipped.
  const t0 = at("2026-10-05T05:00:00Z");
  const sup = await as("EMP-005", t0);
  const planA = await createPlan(sup, { projectId: await id("project", "PRJ-001") });
  const vA = await createVisit(sup, { planId: planA.id, visitType: "fresh", requestedStart: "2026-10-12", requestedStartMeaning: "installation_start", plannedStart: "2026-10-12", plannedEnd: "2026-10-14", orderIds: [await id("sales_order", "ORD-001")] });
  await setSkillRequirements(sup, { visitId: vA.id, sourceComplexityLabel: "Medium", requirements: [{ skillId: await skill("assembly"), minLevel: 1, headcount: 3, mode: "collective" }] });
  await commitScope(sup, { visitId: vA.id, taskId: await id("installation_task", "TSK-003"), quantity: "24" });
  await commitScope(sup, { visitId: vA.id, taskId: await id("installation_task", "TSK-006"), quantity: "12" });
  await setVisitStaffing(sup, { visitId: vA.id, employeeIds: crew });
  await submitPlan(sup, { planId: planA.id });
  await approvePlan(await as("EMP-001", t0), { planId: planA.id, note: "Approved for demo" });
  await clear("EMP-001", vA.id, ["accounts", "site", "installation"], t0);
  await bookVisit(await as("EMP-001", t0), { visitId: vA.id });
  for (const check of ["site_access", "materials", "drawings", "tools", "customer_confirmation", "skill_coverage"]) {
    await setReadinessCheck(sup, { visitId: vA.id, checkCode: check, result: "pass", evidence: "Checked (demo)" });
  }
  const day1 = at("2026-10-12T03:30:00Z");
  const vtShutter = (await db.query<{ id: string }>("select vt.id from visit_task vt join installation_task t on t.id = vt.task_id where vt.visit_id = $1 and t.business_id = 'TSK-006'", [vA.id]))[0]!.id;
  const vtCarcass = (await db.query<{ id: string }>("select vt.id from visit_task vt join installation_task t on t.id = vt.task_id where vt.visit_id = $1 and t.business_id = 'TSK-003'", [vA.id]))[0]!.id;
  await setDailyTarget(await as("EMP-005", day1), { visitTaskId: vtCarcass, planDate: "2026-10-12", targetQuantity: "12" });
  await setDailyTarget(await as("EMP-005", day1), { visitTaskId: vtShutter, planDate: "2026-10-13", targetQuantity: "6" });
  await freezeDailyTargets(await as("EMP-005", day1), { visitId: vA.id, planDate: "2026-10-12" });
  await transitionVisit(await as("EMP-005", day1), { visitId: vA.id, to: "in_progress", version: await version("visit", vA.id) });
  await recordProgress(await as("EMP-005", at("2026-10-12T13:00:00Z")), { visitTaskId: vtCarcass, quantityDelta: "12", evidence: "Site photos (demo)" });
  await recordProgress(await as("EMP-005", at("2026-10-13T13:00:00Z")), { visitTaskId: vtCarcass, quantityDelta: "12" });
  await recordProgress(await as("EMP-005", at("2026-10-14T12:00:00Z")), { visitTaskId: vtShutter, quantityDelta: "6" });
  await recordDelay(await as("EMP-005", at("2026-10-14T12:00:00Z")), { visitId: vA.id, start: "2026-10-14T04:30:00Z", end: "2026-10-14T08:30:00Z", cause: "materials", impact: "Six shutters missing from dispatch", responsibleFunction: "Logistics" });

  const entries: string[] = [];
  let catchUpRequest: string | null = null;
  for (const [i, emp] of crew.entries()) {
    const me = makeCtx(db, (await loadActor(db, emp))!, at("2026-10-14T16:00:00Z"));
    const mine: string[] = [];
    for (const date of ["2026-10-12", "2026-10-13", "2026-10-14"]) {
      const late = i === 0 && date === "2026-10-13";
      const r = await createTimeEntry(me, { employeeId: emp, projectId: await id("project", "PRJ-001"), visitId: vA.id, activity: "installation",
        start: { date, time: "10:00" }, end: { date, time: late ? "21:00" : "19:00" }, breaks: [{ start: { date, time: "13:00" }, end: { date, time: "14:00" } }] });
      mine.push(r.id);
      if (late) catchUpRequest = (await requestOvertime(me, { entryId: r.id, start: { date, time: "19:00" }, end: { date, time: "21:00" }, claimedReason: "Stayed back to finish carcasses" })).id;
    }
    await submitTimeEntries(me, { entryIds: mine });
    entries.push(...mine);
  }
  // All but the last entry are accepted; the last stays submitted so the approvals queue has real work.
  const reviewer = await as("EMP-005", at("2026-10-15T05:00:00Z"));
  for (const e of entries.slice(0, -1)) await reviewTimeEntry(reviewer, { entryId: e, decision: "accepted" });
  if (catchUpRequest) {
    await reviewEligibility(reviewer, { requestId: catchUpRequest, verifiedReason: "original_target_catch_up", note: "Daily target was 12 carcasses; the extra time completed the original target" });
  }

  const mgrLate = await as("EMP-001", at("2026-10-14T13:00:00Z"));
  await transferOutstandingScope(mgrLate, { visitTaskId: vtShutter, reason: "Six shutters short-shipped; carried to follow-up visit" });
  await transitionVisit(await as("EMP-005", at("2026-10-14T13:30:00Z")), { visitId: vA.id, to: "completed", version: await version("visit", vA.id) });
  await recordAcceptance(await as("EMP-005", at("2026-10-14T13:30:00Z")), { visitId: vA.id, signedOff: false, evidence: "Customer will sign off after shutters" });

  // Follow-up visit B for the remaining shutters, submitted and awaiting approval.
  const follow = await createFollowUpVisit(await as("EMP-005", at("2026-10-15T05:00:00Z")), {
    fromVisitId: vA.id, visitType: "follow_up", repeatReason: "material_shortage", repeatReasonNote: "Shutters short-shipped by logistics",
    plannedStart: "2026-10-27", plannedEnd: "2026-10-27", changeReason: "Follow-up for six remaining shutters",
  });
  await setSkillRequirements(await as("EMP-005", at("2026-10-15T05:00:00Z")), { visitId: follow.id, requirements: [{ skillId: await skill("assembly"), minLevel: 1, headcount: 3, mode: "collective" }] });
  await setVisitStaffing(await as("EMP-005", at("2026-10-15T05:00:00Z")), { visitId: follow.id, employeeIds: crew });
  await submitPlan(await as("EMP-005", at("2026-10-15T05:00:00Z")), { planId: planA.id });

  // Visit C: PRJ-003 Bengaluru outstation; accounts clearance pending, staff held.
  const now = at("2026-10-20T05:00:00Z");
  const sup2 = await as("EMP-006", now);
  const planC = await createPlan(sup2, { projectId: await id("project", "PRJ-003") });
  const vC = await createVisit(sup2, { planId: planC.id, visitType: "fresh", plannedStart: "2026-10-29", plannedEnd: "2026-10-31", outstation: true,
    departureAt: "2026-10-28T02:30:00Z", returnAt: "2026-11-01T14:30:00Z", requestedStart: "2026-10-28", requestedStartMeaning: "travel_start", orderIds: [await id("sales_order", "ORD-004")] });
  await setSkillRequirements(sup2, { visitId: vC.id, requirements: [
    { skillId: await skill("carpentry"), minLevel: 3, headcount: 1, mode: "collective" },
    { skillId: await skill("assembly"), minLevel: 1, headcount: 2, mode: "collective" },
  ] });
  const [cabinet] = await db.query<{ id: string }>(
    `select t.id from installation_task t join component c on c.id = t.component_id join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id
     where o.business_id = 'ORD-004' and c.quantity_kind = 'cabinet_surface_area'`);
  await commitScope(sup2, { visitId: vC.id, taskId: cabinet!.id, quantity: "320" });
  const { suggestTeamsForVisit } = await import("../services/booking");
  const opts = await suggestTeamsForVisit(sup2, { visitId: vC.id });
  if (opts.earliest && opts.earliest.start === "2026-10-28") {
    await setVisitStaffing(sup2, { visitId: vC.id, employeeIds: opts.earliest.memberIds });
    await submitPlan(sup2, { planId: planC.id });
    await approvePlan(await as("EMP-002", now), { planId: planC.id });
    await clear("EMP-002", vC.id, ["site", "installation"], now);
    await holdCapacity(await as("EMP-002", now), { visitId: vC.id });
  }

  // PRJ-002 Jaipur: draft plan with a visit but no staffing yet.
  const planJ = await createPlan(await as("EMP-008", now), { projectId: await id("project", "PRJ-002") });
  await createVisit(await as("EMP-008", now), { planId: planJ.id, visitType: "fresh", plannedStart: "2026-11-09", plannedEnd: "2026-11-11", orderIds: [await id("sales_order", "ORD-003")] });

  // Expenses and estimate for visit A.
  const est = await createEstimate(sup, { projectId: await id("project", "PRJ-001"), visitId: vA.id, lines: [
    { category: "meal", basis: "per_person_day", factors: { people: 3, days: 3 }, unitRateMinor: 30000, scope: "Illustrative meal rate" },
    { category: "local_transport", basis: "per_trip", factors: { trips: 6 }, unitRateMinor: 45000 },
    { category: "unloading", basis: "fixed", factors: {}, unitRateMinor: 250000 },
  ] });
  void est;
  const e1 = await submitExpense(await as("EMP-005", at("2026-10-14T15:00:00Z")), { projectId: await id("project", "PRJ-001"), visitId: vA.id, category: "unloading", vendor: "Demo Unloading Co.", loadRef: "LOAD-0412", amountMinor: 280000, incurredOn: "2026-10-12", receiptRef: "RCPT-DEMO-1" });
  await approveExpense(await as("EMP-001", at("2026-10-16T05:00:00Z")), { expenseId: e1.id, decision: "approved" });
  const e2 = await submitExpense(await as("EMP-005", at("2026-10-14T15:00:00Z")), { projectId: await id("project", "PRJ-001"), visitId: vA.id, category: "local_transport", amountMinor: 255000, incurredOn: "2026-10-14", receiptRef: "RCPT-DEMO-2" });
  void e2;
  await createSavingsClaim(await as("EMP-001", now), { projectId: await id("project", "PRJ-001"), loadRef: "LOAD-0412", scope: "Unloading for ORD-001 dispatch", period: "2026-10", proposedSavingMinor: 50000 });

  // Quality and cross-functional issue.
  const qc = await openQualityCase(await as("EMP-005", now), { projectId: await id("project", "PRJ-001"), orderId: await id("sales_order", "ORD-001"), visitId: vA.id, kind: "complaint", category: "Alignment", reportedOn: "2026-10-16", rootCause: "Hinge adjustment", responsibleFunction: "Installation", correctiveAction: "Re-align during follow-up" });
  await closeQualityCase(await as("EMP-005", now), { caseId: qc.id, closedOn: "2026-10-18", closureEvidence: "Supervisor re-aligned two doors (demo)" });
  await createIssue(await as("EMP-005", now), { projectId: await id("project", "PRJ-001"), orderId: await id("sales_order", "ORD-001"), raisedOn: "2026-10-14", function: "Logistics", category: "Short shipment",
    impact: "Follow-up visit required", delayDays: "13", description: "Six shutters missing from the dispatch for ORD-001.", ownerId: await id("employee", "EMP-002"), escalationOwnerId: await id("employee", "EMP-001"),
    nextAction: "Confirm shutter dispatch date", dueDate: "2026-10-23" });

  // Visit W: wardrobe installation in progress 21-23 Oct 2026, so the crew's "My day" has live work.
  const w0 = at("2026-10-19T05:00:00Z");
  const supW = await as("EMP-008", w0);
  const planW = await createPlan(supW, { projectId: await id("project", "PRJ-001") });
  const vW = await createVisit(supW, { planId: planW.id, visitType: "fresh", plannedStart: "2026-10-21", plannedEnd: "2026-10-23", orderIds: [await id("sales_order", "ORD-002")] });
  await setSkillRequirements(supW, { visitId: vW.id, requirements: [{ skillId: await skill("assembly"), minLevel: 1, headcount: 3, mode: "collective" }] });
  const wTasks = await db.query<{ id: string; quantity: string }>(
    `select t.id, t.required_quantity::text quantity from installation_task t join component c on c.id = t.component_id join order_item oi on oi.id = c.order_item_id
     join sales_order o on o.id = oi.order_id where o.business_id = 'ORD-002' and t.activity in ('assemble','install') order by c.business_id, t.step_order`);
  for (const t of wTasks) await commitScope(supW, { visitId: vW.id, taskId: t.id, quantity: t.quantity });
  await setVisitStaffing(supW, { visitId: vW.id, employeeIds: crew });
  await submitPlan(supW, { planId: planW.id });
  await approvePlan(await as("EMP-001", w0), { planId: planW.id });
  await clear("EMP-001", vW.id, ["accounts", "site", "installation"], w0);
  await bookVisit(await as("EMP-001", w0), { visitId: vW.id });
  for (const check of ["site_access", "materials", "drawings", "tools", "customer_confirmation", "skill_coverage"]) {
    await setReadinessCheck(supW, { visitId: vW.id, checkCode: check, result: "pass", evidence: "Checked (demo)" });
  }
  const wDay = at("2026-10-21T03:45:00Z");
  const wVts = await db.query<{ id: string; quantity: string }>("select id, scoped_quantity::int::text quantity from visit_task where visit_id = $1 order by id", [vW.id]);
  for (const date of ["2026-10-21", "2026-10-22", "2026-10-23"]) {
    for (const vt of wVts) await setDailyTarget(await as("EMP-008", wDay), { visitTaskId: vt.id, planDate: date, targetQuantity: String(Math.max(1, Math.ceil(Number(vt.quantity) / 3))) });
  }
  await freezeDailyTargets(await as("EMP-008", wDay), { visitId: vW.id, planDate: "2026-10-21" });
  await transitionVisit(await as("EMP-008", wDay), { visitId: vW.id, to: "in_progress", version: await version("visit", vW.id) });
  await recordProgress(await as("EMP-008", at("2026-10-21T12:30:00Z")), { visitTaskId: wVts[0]!.id, quantityDelta: "2", evidence: "Day one (demo)" });

  // Visit K: PRJ-004 kitchen on the 13-day customer schedule from 14 Oct 2026, mid-countertop on 22 Oct.
  const k0 = at("2026-10-08T05:00:00Z");
  const supK = await as("EMP-008", k0);
  const teamK = (await db.query<{ id: string }>(
    `select e.id from employee e join employee_skill es on es.employee_id = e.id join skill s on s.id = es.skill_id
     where e.active and s.code = 'assembly' and es.verified and e.id <> all($1::uuid[])
       and not exists (select 1 from leave_record l where l.employee_id = e.id)
       and not exists (select 1 from reservation r where r.employee_id = e.id and r.state in ('held','confirmed') and r.span && tstzrange('2026-10-13','2026-10-30'))
     order by e.job_role = 'site_supervisor', e.business_id limit 3`, [crew])).map((r) => r.id);
  if (teamK.length < 3) return;
  const planK = await createPlan(supK, { projectId: await id("project", "PRJ-004") });
  const vK = await createVisit(supK, { planId: planK.id, visitType: "fresh", plannedStart: "2026-10-14", plannedEnd: "2026-10-28", orderIds: [await id("sales_order", "ORD-005")] });
  await setSkillRequirements(supK, { visitId: vK.id, requirements: [{ skillId: await skill("assembly"), minLevel: 1, headcount: 3, mode: "collective" }] });
  const kTasks = await db.query<{ id: string; quantity: string; kind: string; activity: string }>(
    `select t.id, t.required_quantity::text quantity, t.quantity_kind kind, t.activity from installation_task t join component c on c.id = t.component_id join order_item oi on oi.id = c.order_item_id
     join sales_order o on o.id = oi.order_id where o.business_id = 'ORD-005' and ((t.quantity_kind = 'carcass_count' and t.activity in ('assemble','install')) or t.quantity_kind = 'counter_surface_area')
     order by c.business_id, t.step_order`);
  for (const t of kTasks) await commitScope(supK, { visitId: vK.id, taskId: t.id, quantity: t.quantity });
  await setVisitStaffing(supK, { visitId: vK.id, employeeIds: teamK });
  await submitPlan(supK, { planId: planK.id });
  await approvePlan(await as("EMP-001", k0), { planId: planK.id });
  await clear("EMP-001", vK.id, ["accounts", "site", "installation"], k0);
  await bookVisit(await as("EMP-001", k0), { visitId: vK.id });
  for (const check of ["site_access", "materials", "drawings", "tools", "customer_confirmation", "skill_coverage"]) {
    await setReadinessCheck(supK, { visitId: vK.id, checkCode: check, result: "pass", evidence: "Checked (demo)" });
  }
  await applySchedule(supK, { visitId: vK.id, templateCode: "kitchen_standard", startDate: "2026-10-14" });
  const kDay = at("2026-10-14T03:45:00Z");
  const kVts = await db.query<{ id: string; quantity: string; kind: string; activity: string }>(
    `select vt.id, vt.scoped_quantity::int::text quantity, t.quantity_kind kind, t.activity from visit_task vt join installation_task t on t.id = vt.task_id where vt.visit_id = $1`, [vK.id]);
  for (const vt of kVts) await setDailyTarget(await as("EMP-008", kDay), { visitTaskId: vt.id, planDate: "2026-10-14", targetQuantity: vt.kind === "carcass_count" && vt.activity === "assemble" ? vt.quantity : "0" });
  await freezeDailyTargets(await as("EMP-008", kDay), { visitId: vK.id, planDate: "2026-10-14" });
  await transitionVisit(await as("EMP-008", kDay), { visitId: vK.id, to: "in_progress", version: await version("visit", vK.id) });
  const doneQty: Array<[string, string, string, string]> = [["carcass_count", "assemble", "24", "2026-10-14T12:30:00Z"], ["carcass_count", "install", "24", "2026-10-15T12:30:00Z"], ["counter_surface_area", "install", "20", "2026-10-21T12:30:00Z"]];
  for (const [kind, activity, qty, when] of doneQty) {
    const vt = kVts.find((x) => x.kind === kind && x.activity === activity);
    if (vt) await recordProgress(await as("EMP-008", at(when)), { visitTaskId: vt.id, quantityDelta: qty, evidence: "Site photos (demo)" });
  }
  const kDays = await db.query<{ id: string; day_date: string }>("select id, day_date::text from visit_schedule_day where visit_id = $1 and kind = 'work' and day_date < '2026-10-22' order by day_date", [vK.id]);
  for (const day of kDays) {
    const late = day.day_date === "2026-10-20";
    await setScheduleDay(await as("EMP-008", at(`${day.day_date}T13:00:00Z`)), { dayId: day.id, status: late ? "delayed" : "done", note: late ? "Granite slabs reached site at 4 pm; cutting moved to the next day" : undefined });
  }
}
