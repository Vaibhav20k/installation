'use server';
import { run } from './run';
import { saveOperationsPolicy as savePolicy } from '@/server/services/operations-policy';
import { activateOperations as activate } from '@/server/services/flow-admin';
import * as workforce from '@/server/services/workforce';
import * as preventive from '@/server/services/preventive';
export async function saveOperationsPolicy(input: unknown) { return run(savePolicy, input); }
export async function activateOperations(input: unknown) { return run(activate, input); }
export async function createSitePlans(input: unknown) { return run(workforce.createSitePlans, input); }
export async function transitionSitePlan(input: unknown) { return run(workforce.transitionSitePlan, input); }
export async function revisePlanBudget(input: unknown) { return run(workforce.revisePlanBudget, input); }
export async function requestRegularization(input: unknown) { return run(workforce.requestRegularization, input); }
export async function decideRegularization(input: unknown) { return run(workforce.decideRegularization, input); }
export async function createPreventiveProject(input: unknown) { return run(preventive.createPreventiveProject, input); }
export async function advancePreventiveProject(input: unknown) { return run(preventive.advancePreventiveProject, input); }
export async function saveDesignation(input: unknown) { return run(preventive.saveDesignation, input); }
export async function assignDesignation(input: unknown) { return run(preventive.assignDesignation, input); }
