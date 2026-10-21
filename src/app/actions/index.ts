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

export async function signInAs(employeeId: string) {
  if (!demoAuthEnabled()) throw new Error("Demo sign-in is disabled in production.");
  const actor = await loadActor(await getDb(), employeeId);
  if (!actor) throw new Error("Unknown or inactive employee");
  (await cookies()).set(DEMO_COOKIE, actor.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(actor.role === "employee" ? "/my-day" : actor.role === "admin" ? "/installations" : "/");
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
