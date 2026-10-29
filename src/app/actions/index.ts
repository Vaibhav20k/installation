"use server";
/**
 * Server actions. Each is a thin wrapper: the service validates schema, permission, state,
 * related-record scope and version; this layer only revalidates affected pages.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { DEMO_COOKIE, demoAuthEnabled, loadActor } from "@/server/auth/actor";
import { run } from "./run";
import * as planning from "@/server/services/planning";
import * as booking from "@/server/services/booking";
import * as clearance from "@/server/services/clearance";
import * as execution from "@/server/services/execution";
import * as time from "@/server/services/time";
import * as recon from "@/server/services/reconciliation";
import * as settings from "@/server/services/settings";
import * as expenses from "@/server/services/expenses";
import * as quality from "@/server/services/quality";
import * as master from "@/server/services/master";
import * as imports from "@/server/services/imports";
import * as travel from "@/server/services/travel";
import * as schedule from "@/server/services/schedule";
import * as attendance from "@/server/services/attendance";
import * as evidence from "@/server/services/evidence";
import * as site from "@/server/services/site";
import * as commercial from "@/server/services/commercial";
import * as customer from "@/server/services/customer";
import * as packages from "@/server/services/packages";
import * as skillCards from "@/server/services/skill-cards";
import * as skillCardQueries from "@/server/queries/skill-cards";
import * as sitePresence from "@/server/services/site-presence";
import * as siteWork from "@/server/services/site-work";
import * as dispatchFlow from "@/server/services/dispatch";
import * as complaintFlow from "@/server/services/complaint";
import * as flowAdmin from "@/server/services/flow-admin";
import * as siteMnd from "@/server/services/site-mnd";

export async function signInAs(employeeId: string) {
  if (!demoAuthEnabled()) throw new Error("Demo sign-in is disabled in production.");
  const actor = await loadActor(await getDb(), employeeId);
  if (!actor) throw new Error("Unknown or inactive employee");
  (await cookies()).set(DEMO_COOKIE, actor.id, { httpOnly: true, sameSite: "lax", path: "/" });
  // Department staff start on their dispatch steps; managers and administrators on the installation plans; workers on My day.
  if (actor.jobRole === "department_staff") redirect("/dispatch");
  redirect(actor.role === "employee" ? "/my-day" : actor.role === "admin" || actor.role === "manager" ? "/installations" : "/");
}

export async function signOut() {
  (await cookies()).delete(DEMO_COOKIE);
  redirect("/sign-in");
}

const P = ["/planning", "/projects", "/visits", "/approvals", "/"];
const T = ["/timesheets", "/my-day", "/approvals", "/"];
const I = ["/installations", "/projects", "/"];

// Planning and booking
export async function createPlanAndVisit(input: { projectId: string; visit: Record<string, unknown> }) {
  return run(async (ctx) => {
    const plan = await planning.createPlan(ctx, { projectId: input.projectId });
    const visit = await planning.createVisit(ctx, { ...input.visit, planId: plan.id });
    return { planId: plan.id, visitId: visit.id };
  }, input, P);
}
export async function createVisit(input: unknown) { return run(planning.createVisit, input, P); }
export async function updateVisitDates(input: unknown) { return run(planning.updateVisitDates, input, P); }
export async function commitScope(input: unknown) { return run(planning.commitScope, input, P); }
export async function setSkillRequirements(input: unknown) { return run(planning.setSkillRequirements, input, P); }
export async function submitPlan(input: unknown) { return run(planning.submitPlan, input, P); }
export async function approvePlan(input: unknown) { return run(planning.approvePlan, input, P); }
export async function returnPlan(input: unknown) { return run(planning.returnPlan, input, P); }
export async function createPlanRevision(input: unknown) { return run(planning.createPlanRevision, input, P); }
export async function cancelPlan(input: unknown) { return run(planning.cancelPlan, input, P); }
export async function suggestTeams(input: unknown) { return run(booking.suggestTeamsForVisit, input, []); }
export async function setVisitStaffing(input: unknown) { return run(booking.setVisitStaffing, input, P); }
export async function holdCapacity(input: unknown) { return run(booking.holdCapacity, input, P); }
export async function bookVisit(input: unknown) { return run(booking.bookVisit, input, P); }
export async function releaseReservation(input: unknown) { return run(booking.releaseReservation, input, P); }

// Clearance and execution
export async function setClearance(input: unknown) { return run(clearance.setClearance, input, P); }
export async function grantClearanceException(input: unknown) { return run(clearance.grantClearanceException, input, P); }
export async function revokeClearanceException(input: unknown) { return run(clearance.revokeClearanceException, input, P); }
export async function setReadinessCheck(input: unknown) { return run(clearance.setReadinessCheck, input, P); }
export async function transitionVisit(input: unknown) { return run(execution.transitionVisit, input, P); }
export async function setDailyTarget(input: unknown) { return run(execution.setDailyTarget, input, P); }
export async function freezeDailyTargets(input: unknown) { return run(execution.freezeDailyTargets, input, P); }
export async function recordProgress(input: unknown) { return run(execution.recordProgress, input, [...P, "/my-day"]); }
export async function acceptProgress(input: unknown) { return run(execution.acceptProgress, input, P); }
export async function recordDelay(input: unknown) { return run(execution.recordDelay, input, [...P, "/my-day"]); }
export async function recordAcceptance(input: unknown) { return run(execution.recordAcceptance, input, P); }
export async function transferOutstandingScope(input: unknown) { return run(execution.transferOutstandingScope, input, P); }
export async function createFollowUpVisit(input: unknown) { return run(execution.createFollowUpVisit, input, P); }
export async function proposeScheduleRevision(input: unknown) { return run(execution.proposeScheduleRevision, input, []); }
export async function applyScheduleRevision(input: unknown) { return run(execution.applyScheduleRevision, input, P); }

// Time
export async function createTimeEntry(input: unknown) { return run(time.createTimeEntry, input, T); }
export async function updateDraftEntry(input: unknown) { return run(time.updateDraftEntry, input, T); }
export async function submitTimeEntries(input: unknown) { return run(time.submitTimeEntries, input, T); }
export async function reviewTimeEntry(input: unknown) { return run(time.reviewTimeEntry, input, T); }
export async function amendTimeEntry(input: unknown) { return run(time.amendTimeEntry, input, T); }
export async function requestOvertime(input: unknown) { return run(time.requestOvertime, input, T); }
export async function reviewEligibility(input: unknown) { return run(time.reviewEligibility, input, T); }
export async function markReviewedMissingDay(input: unknown) { return run(time.markReviewedMissingDay, input, T); }
export async function reconcileMonth(input: unknown) { return run(recon.reconcileMonth, input, T); }
export async function finalizeMonth(input: unknown) { return run(recon.finalizeMonth, input, T); }
export async function reopenMonth(input: unknown) { return run(recon.reopenMonth, input, T); }

// Settings
export async function updateDraftPolicy(input: unknown) { return run(settings.updateDraftPolicy, input, ["/settings", "/timesheets"]); }
export async function createPolicyVersion(input: unknown) { return run(settings.createPolicyVersion, input, ["/settings"]); }
export async function approvePolicy(input: unknown) { return run(settings.approvePolicy, input, ["/settings", "/timesheets"]); }
export async function previewPolicy(input: unknown) { return run(settings.previewPolicy, input, []); }
export async function approveRateVersion(input: unknown) { return run(settings.approveRateVersion, input, ["/settings", "/visits"]); }
export async function approveKpiTarget(input: unknown) { return run(settings.approveKpiTarget, input, ["/settings", "/reports"]); }
export async function approveMetricDefinition(input: unknown) { return run(settings.approveMetricDefinition, input, ["/settings", "/reports"]); }

// Money, quality, master data
export async function createEstimate(input: unknown) { return run(expenses.createEstimate, input, ["/expenses", "/visits", "/planning"]); }
export async function approveBudget(input: unknown) { return run(expenses.approveBudget, input, ["/expenses", "/planning"]); }
export async function submitExpense(input: unknown) { return run(expenses.submitExpense, input, ["/expenses", "/approvals"]); }
export async function approveExpense(input: unknown) { return run(expenses.approveExpense, input, ["/expenses", "/approvals"]); }
export async function recordExpenseCredit(input: unknown) { return run(expenses.recordExpenseCredit, input, ["/expenses"]); }
export async function allocateExpense(input: unknown) { return run(expenses.allocateExpense, input, ["/expenses", "/reports"]); }
export async function openQualityCase(input: unknown) { return run(quality.openQualityCase, input, ["/projects", "/reports"]); }
export async function closeQualityCase(input: unknown) { return run(quality.closeQualityCase, input, ["/projects", "/reports"]); }
export async function reopenQualityCase(input: unknown) { return run(quality.reopenQualityCase, input, ["/projects", "/reports"]); }
export async function createIssue(input: unknown) { return run(quality.createIssue, input, ["/projects", "/reports"]); }
export async function closeAction(input: unknown) { return run(quality.closeAction, input, ["/projects", "/reports"]); }
export async function createSavingsClaim(input: unknown) { return run(quality.createSavingsClaim, input, ["/reports"]); }
export async function verifySavings(input: unknown) { return run(quality.verifySavings, input, ["/reports"]); }
export async function verifySkill(input: unknown) { return run(master.verifySkill, input, ["/people"]); }
export async function addEmployeeSkill(input: unknown) { return run(master.addEmployeeSkill, input, ["/people"]); }
export async function updateEmployee(input: unknown) { return run(master.updateEmployee, input, ["/people"]); }
export async function recordLeave(input: unknown) { return run(master.recordLeave, input, ["/people", "/planning"]); }
export async function createCustomer(input: unknown) { return run(master.createCustomer, input, ["/projects"]); }
export async function createProject(input: unknown) { return run(master.createProject, input, ["/projects"]); }
export async function createOrder(input: unknown) { return run(master.createOrder, input, ["/projects"]); }
export async function addComponentWithTasks(input: unknown) { return run(master.addComponentWithTasks, input, ["/projects"]); }
export async function addOrderItem(input: unknown) { return run(master.addOrderItem, input, ["/projects"]); }

// Source import and travel
export async function previewImport(input: unknown) { return run(imports.previewImport, input, []); }
export async function applyImport(input: unknown) { return run(imports.applyImport, input, ["/projects", "/reports", "/planning"]); }
export async function addTravelLeg(input: unknown) { return run(travel.addTravelLeg, input, P); }
export async function recordTravelActual(input: unknown) { return run(travel.recordTravelActual, input, P); }

// Installation schedules shared with customers
export async function applyInstallSchedule(input: unknown) { return run(schedule.applySchedule, input, I); }
export async function setScheduleDayStatus(input: unknown) { return run(schedule.setScheduleDay, input, I); }

// Attendance: fixed 8-hour session, corrections, leave and notifications
const A = ["/my-day", "/attendance", "/requests", "/approvals", "/timesheets"];
export async function clockIn(input: unknown) { return run(attendance.clockIn, input, A); }
export async function clockOut(input: unknown) { return run(attendance.clockOut, input, A); }
export async function setAttendanceActivity(input: unknown) { return run(attendance.setActivity, input, ["/my-day", "/attendance"]); }
export async function addAttendanceNote(input: unknown) { return run(attendance.addAttendanceNote, input, ["/my-day", "/attendance"]); }
export async function setOvertimeReason(input: unknown) { return run(attendance.setOvertimeReason, input, ["/my-day", "/attendance", "/requests"]); }
export async function requestAttendanceCorrection(input: unknown) { return run(attendance.requestCorrection, input, A); }
export async function decideAttendanceCorrection(input: unknown) { return run(attendance.decideCorrection, input, A); }
export async function requestLeave(input: unknown) { return run(attendance.requestLeave, input, ["/requests", "/approvals"]); }
export async function decideLeave(input: unknown) { return run(attendance.decideLeave, input, ["/requests", "/approvals", "/planning", "/people"]); }
export async function markNotificationsRead(input: unknown) { return run(attendance.markNotificationsRead, input, []); }

// Evidence (optional photos and videos on worker input)
export async function createEvidenceUpload(input: unknown) { return run(evidence.createEvidenceUpload, input, []); }
export async function completeEvidenceUpload(input: unknown) { return run(evidence.completeEvidenceUpload, input, []); }
export async function linkEvidence(input: unknown) { return run(evidence.linkEvidence, input, []); }
export async function removeDraftEvidence(input: unknown) { return run(evidence.removeDraftEvidence, input, []); }

// Site, contacts, quantities, appliances and substitution
const S = ["/projects", "/visits", "/planning", "/installations"];
export async function addContact(input: unknown) { return run(site.addContact, input, S); }
export async function setQuantitySnapshot(input: unknown) { return run(site.setQuantitySnapshot, input, S); }
export async function addEffortDriver(input: unknown) { return run(site.addEffortDriver, input, S); }
export async function setSiteRestriction(input: unknown) { return run(site.setSiteRestriction, input, S); }
export async function saveAppliance(input: unknown) { return run(site.saveAppliance, input, S); }
export async function exceptAppliance(input: unknown) { return run(site.exceptAppliance, input, S); }
export async function addCrewMember(input: unknown) { return run(site.addCrewMember, input, [...S, "/my-day", "/my-tasks"]); }
export async function substitute(input: unknown) { return run(site.substitute, input, [...S, "/my-day", "/my-tasks"]); }

// Additional work and installation charges
export async function requestAdditionalWork(input: unknown) { return run(commercial.requestAdditionalWork, input, ["/projects", "/my-day", "/approvals"]); }
export async function decideAdditionalWork(input: unknown) { return run(commercial.decideAdditionalWork, input, ["/projects", "/approvals"]); }
export async function setInstallationCharge(input: unknown) { return run(commercial.setInstallationCharge, input, ["/projects"]); }

// Customer coordination, design requests and packages
const C = ["/projects", "/my-day"];
export async function setJourney(input: unknown) { return run(customer.setJourney, input, C); }
export async function addObligation(input: unknown) { return run(customer.addObligation, input, C); }
export async function completeObligation(input: unknown) { return run(customer.completeObligation, input, C); }
export async function logCommunication(input: unknown) { return run(customer.logCommunication, input, C); }
export async function createDesignRequest(input: unknown) { return run(customer.createDesignRequest, input, [...C, "/approvals"]); }
export async function addDesignRevision(input: unknown) { return run(customer.addDesignRevision, input, C); }
export async function decideDesignRequest(input: unknown) { return run(customer.decideDesignRequest, input, [...C, "/approvals"]); }
export async function addPackage(input: unknown) { return run(packages.addPackage, input, C); }
export async function recordScan(input: unknown) { return run(packages.recordScan, input, C); }
export async function raisePackageException(input: unknown) { return run(packages.raisePackageException, input, C); }
export async function decidePackageException(input: unknown) { return run(packages.decidePackageException, input, C); }

// Admin-only employee skill cards: every read and write checks the Admin permission in the query or service.
const K = ["/skill-cards", "/people", "/planning", "/installations", "/visits"];
export async function cardDetail(employeeId: string) { return run((ctx) => skillCardQueries.cardDetail(ctx.db, ctx.actor, String(employeeId), ctx.now), null, []); }
export async function cardAssignOptions() { return run((ctx) => skillCardQueries.assignOptions(ctx.db, ctx.actor), null, []); }
export async function cardAssignContext(input: { employeeId: string; visitId: string }) { return run((ctx) => skillCardQueries.assignContext(ctx.db, ctx.actor, String(input.employeeId), String(input.visitId), ctx.now), input, []); }
export async function addCardSkill(input: unknown) { return run(skillCards.addCardSkill, input, K); }
export async function updateCardSkill(input: unknown) { return run(skillCards.updateCardSkill, input, K); }
export async function verifyCardSkill(input: unknown) { return run(skillCards.verifyCardSkill, input, K); }
export async function assignFromCard(input: unknown) { return run(skillCards.assignFromCard, input, K); }

// Site check-in/out, the site work plan and the daily checklist (recording of 27 Oct 2026).
const SP = ["/my-day", "/installations"];
export async function siteCheckIn(input: unknown) { return run(sitePresence.siteCheckIn, input, SP); }
export async function siteCheckOut(input: unknown) { return run(sitePresence.siteCheckOut, input, SP); }
export async function correctSitePresence(input: unknown) { return run(sitePresence.correctPresence, input, ["/installations"]); }
export async function addSitePresence(input: unknown) { return run(sitePresence.addPresence, input, ["/installations"]); }
export async function createWorkTask(input: unknown) { return run(siteWork.createWorkTask, input, SP); }
export async function updateWorkTask(input: unknown) { return run(siteWork.updateWorkTask, input, SP); }
export async function addWorkItems(input: unknown) { return run(siteWork.addWorkItems, input, SP); }
export async function setWorkItemDone(input: unknown) { return run(siteWork.setWorkItemDone, input, SP); }
export async function rescheduleWorkItem(input: unknown) { return run(siteWork.rescheduleWorkItem, input, SP); }
export async function updateEmployeeSkill(input: unknown) { return run(master.updateEmployeeSkill, input, ["/people", "/skill-cards", "/installations"]); }
export async function setSiteLocation(input: unknown) { return run(site.setSiteLocation, input, ["/installations", "/projects"]); }

// Dispatch to installation and the MND complaint loop; Dispatch setup is for administrators.
const DP = ["/dispatch", "/"];
export async function createDispatch(input: unknown) { return run(dispatchFlow.createDispatch, input, DP); }
export async function advanceDispatch(input: unknown) { return run(dispatchFlow.advanceDispatch, input, DP); }
export async function receiveDispatch(input: unknown) { return run(dispatchFlow.receiveDispatch, input, DP); }
export async function moveDispatchBack(input: unknown) { return run(dispatchFlow.moveDispatchBack, input, DP); }
export async function advanceComplaint(input: unknown) { return run(complaintFlow.advanceComplaint, input, DP); }
export async function moveComplaintBack(input: unknown) { return run(complaintFlow.moveComplaintBack, input, DP); }
export async function setFlowRoleMember(input: unknown) { return run(flowAdmin.setRoleMember, input, DP); }
export async function saveFlowDefinition(input: unknown) { return run(flowAdmin.saveFlowDefinition, input, DP); }
// Missing or damaged items found on site by the crew, confirmed or rejected by the site's Installation Manager.
export async function reportMnd(input: unknown) { return run(siteMnd.reportMnd, input, ["/my-day", ...DP]); }
export async function confirmMndReport(input: unknown) { return run(siteMnd.confirmMndReport, input, ["/my-day", ...DP]); }
export async function rejectMndReport(input: unknown) { return run(siteMnd.rejectMndReport, input, ["/my-day", ...DP]); }
