import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { freshDb, idOf } from './helpers';
import type { Db } from '@/server/db/client';
import { flowKit, PEOPLE } from './flow-helpers';
import { activateOperations } from '@/server/services/flow-admin';
import { saveOperationsPolicy } from '@/server/services/operations-policy';
import { createDispatch } from '@/server/services/dispatch';
import { dispatchGate } from '@/server/services/operations-dispatch';
import { myPending } from '@/server/queries/dispatch';
import { checkDefinition } from '@/domain/flow';
import { OPERATIONS_DISPATCH, OPERATIONS_COMPLAINT } from '@/domain/operations-flow';
import { createSitePlans, transitionSitePlan } from '@/server/services/workforce';
import { createPreventiveProject, advancePreventiveProject } from '@/server/services/preventive';
import { siteCheckIn, siteCheckOut } from '@/server/services/site-presence';
import { operationsReports } from '@/server/queries/operations-reports';
export const testPolicy = { tier1Max: '1000', tier2Max: '5000', planApprover: 'installation_head', regularizationApprover: 'installation_head', readinessReminderDays: 1, installation: { dailyMinutes: 480, hourlyRate: '100' }, complaint: { dailyMinutes: 240, hourlyRate: '150' } };
describe('operations process', () => {
    let db: Db;
    const k = flowKit(() => db);
    let dispatchId: string, componentId: string, complaintId: string;
    beforeAll(async () => {
        db = await freshDb();
        for (const [role, bid] of [['factory', PEOPLE.factory_dispatch], ['dispatch_department', PEOPLE.factory_dispatch], ['finance', PEOPLE.accounts], ['qa', PEOPLE.qc], ['installation_head', PEOPLE.management], ['founders_office', PEOPLE.management], ['owners', PEOPLE.management]])
            await db.query('insert into flow_role_member(role_code,employee_id) select $1,id from employee where business_id=$2', [role, bid]);
        await saveOperationsPolicy(await k.as(PEOPLE.admin), testPolicy);
        await activateOperations(await k.as(PEOPLE.admin), {});
    });
    afterAll(async () => db.close());
    async function deliver(id: string) {
        await k.step(PEOPLE.factory_dispatch, id);
        await k.step(PEOPLE.installation_manager, id, { status: 'ready' });
        await k.step(PEOPLE.factory_dispatch, id);
        await k.step(PEOPLE.accounts, id, { decision: 'received', note: 'Receipt checked' });
        await k.step(PEOPLE.accounts, id, { invoice_no: 'INV-OPS' }, { invoice_file: await k.upload(PEOPLE.accounts, 'document') });
        await k.step(PEOPLE.accounts, id, { eway_no: 'EWAY-OPS' }, { eway_file: await k.upload(PEOPLE.accounts, 'document') });
        await k.step(PEOPLE.factory_dispatch, id);
        await k.step(PEOPLE.factory_dispatch, id, { vehicle_no: 'HR26 AB 1234', driver: 'Driver 12345', dispatch_date: '2026-10-27' });
        await k.step(PEOPLE.installation_manager, id);
    }
    it('validates both graphs and preserves legacy versions', async () => { const roles = (await db.query<{
        code: string;
    }>('select code from flow_role')).map(r => r.code); expect(checkDefinition(OPERATIONS_DISPATCH, roles)).toEqual([]); expect(checkDefinition(OPERATIONS_COMPLAINT, roles)).toEqual([]); expect((await db.query('select * from flow_config where not active')).length).toBe(2); });
    it('runs a dispatch through both gates, receipt and damaged MND', async () => {
        const [line] = await db.query<{
            id: string;
            order_id: string;
            manager_id: string;
        }>(`select c.id,oi.order_id,p.manager_id from component c join order_item oi on oi.id=c.order_item_id join sales_order o on o.id=oi.order_id join project p on p.id=o.project_id join employee e on e.id=p.manager_id where e.business_id=$1 and c.dispatch_group='carcass' limit 1`, [PEOPLE.installation_manager]);
        componentId = line!.id;
        dispatchId = (await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId: line!.order_id, installationManagerId: line!.manager_id, types: ['D1'], factory: 'Main factory', items: [{ componentId, quantity: '1' }] })).dispatchId;
        await expect(dispatchGate(db, dispatchId)).rejects.toThrow('site readiness');
        await k.step(PEOPLE.factory_dispatch, dispatchId);
        expect((await myPending(db, (await k.as(PEOPLE.installation_manager)).actor, Date.now())).items.some(i => i.id === dispatchId)).toBe(true);
        await k.step(PEOPLE.installation_manager, dispatchId, { status: 'ready' });
        await expect(dispatchGate(db, dispatchId)).rejects.toThrow('Finance');
        await k.step(PEOPLE.factory_dispatch, dispatchId);
        await k.step(PEOPLE.accounts, dispatchId, { decision: 'not_received', note: 'Awaiting bank credit' });
        expect((await k.state(dispatchId)).stage).toBe('payment_check');
        await k.step(PEOPLE.accounts, dispatchId, { decision: 'received', note: 'Bank receipt confirmed' });
        await k.step(PEOPLE.accounts, dispatchId, { invoice_no: 'INV-OPS' }, { invoice_file: await k.upload(PEOPLE.accounts, 'document') });
        await k.step(PEOPLE.accounts, dispatchId, { eway_no: 'EWAY-OPS' }, { eway_file: await k.upload(PEOPLE.accounts, 'document') });
        await k.step(PEOPLE.factory_dispatch, dispatchId);
        await k.step(PEOPLE.factory_dispatch, dispatchId, { vehicle_no: 'HR26 AB 1234', driver: 'Driver 12345', dispatch_date: '2026-10-27' });
        await k.step(PEOPLE.installation_manager, dispatchId);
        await expect(k.receive(dispatchId, { [componentId]: { kind: 'damaged', quantity: '1', photo: false } })).rejects.toThrow();
        complaintId = (await k.receive(dispatchId, { [componentId]: { kind: 'damaged', quantity: '1' } })).complaints[0]!.id;
    });
    it('routes cost approval to the configured tier and enforces QA', async () => {
        await k.cstep(PEOPLE.qc, complaintId, { review: 'Inspect replacement requirement' });
        await k.cstep(PEOPLE.planning, complaintId, { cost: '800' });
        expect((await myPending(db, (await k.as(PEOPLE.installation_manager)).actor, Date.now())).items.some(i => i.id === complaintId)).toBe(true);
        await expect(k.cstep(PEOPLE.management, complaintId, { decision: 'approve', reason: 'Reviewed' })).rejects.toThrow();
        await k.cstep(PEOPLE.installation_manager, complaintId, { decision: 'approve', reason: 'Cost checked' });
        await k.cstep(PEOPLE.qc, complaintId, { note: 'Approved for planning' });
        await k.cstep(PEOPLE.planning, complaintId, { plan: 'Replace from stock', target_date: '2026-10-30' });
        await k.cstep(PEOPLE.store, complaintId, { item_source: 'fg_in_stock' });
        expect((await k.cstate(complaintId)).stage).toBe('qa_review');
        await expect(k.cstep(PEOPLE.qc, complaintId, { root_cause: 'transport' })).rejects.toThrow();
        await k.cstep(PEOPLE.qc, complaintId, { root_cause: 'transport', preventive_action: 'Use corner protectors for all shipments' });
        await k.cstep(PEOPLE.factory_dispatch, complaintId);
        expect((await k.cstate(complaintId)).status).toBe('open');
    });
    it('installation completion notifies Factory', async () => {
        await k.step(PEOPLE.installation_manager, dispatchId, { start_date: '2026-10-27' });
        await k.step(PEOPLE.installation_manager, dispatchId, {}, { photos: await k.upload(PEOPLE.installation_manager) });
        expect((await db.query("select id from notification where dedupe_key like $1", [`installation-done:${dispatchId}:%`])).length).toBeGreaterThan(0);
    });
    it('keeps a received replacement open until its Site Plan and installation finish', async () => {
        const [c] = await db.query<{
            replacement_dispatch_id: string;
            project_id: string;
            order_id: string;
        }>('select replacement_dispatch_id,project_id,order_id from complaint where id=$1', [complaintId]);
        let replacement = c!.replacement_dispatch_id;
        const originalComplaint = complaintId;
        await deliver(replacement);
        const followup = (await k.receive(replacement, { [componentId]: { kind: 'damaged', quantity: '1' } })).complaints[0]!.id;
        expect((await k.cstate(originalComplaint)).status).toBe('open');
        await k.step(PEOPLE.installation_manager, replacement, { start_date: '2026-10-27' });
        await expect(k.step(PEOPLE.installation_manager, replacement, {}, { photos: await k.upload(PEOPLE.installation_manager) })).rejects.toThrow('follow-up replacement');
        await k.cstep(PEOPLE.qc, followup, { review: 'Replacement damaged again' });
        await k.cstep(PEOPLE.planning, followup, { cost: '800' });
        await k.cstep(PEOPLE.installation_manager, followup, { decision: 'approve', reason: 'Replace again' });
        await k.cstep(PEOPLE.qc, followup, { note: 'Proceed' });
        await k.cstep(PEOPLE.planning, followup, { plan: 'Stock replacement', target_date: '2026-10-30' });
        await k.cstep(PEOPLE.store, followup, { item_source: 'fg_in_stock' });
        await k.cstep(PEOPLE.qc, followup, { root_cause: 'transport', preventive_action: 'Reinforce packing' });
        await k.cstep(PEOPLE.factory_dispatch, followup);
        replacement = (await db.query<{ replacement_dispatch_id: string }>('select replacement_dispatch_id from complaint where id=$1', [followup]))[0]!.replacement_dispatch_id;
        complaintId = followup;
        await deliver(replacement);
        await k.receive(replacement);
        expect((await k.cstate(complaintId)).status).toBe('open');
        await k.step(PEOPLE.installation_manager, replacement, { start_date: '2026-10-27' });
        await expect(k.step(PEOPLE.installation_manager, replacement, {}, { photos: await k.upload(PEOPLE.installation_manager) })).rejects.toThrow('Site Plan');
        const employee = (await k.as(PEOPLE.installer)).actor.id;
        const plan = (await createSitePlans(await k.as(PEOPLE.installation_manager), { sites: [{ projectId: c!.project_id, orderIds: [c!.order_id], start: '2026-10-27', end: '2026-10-27', employeeIds: [employee], budgetMinutes: 240, complaintId }] })).plans[0]!;
        await transitionSitePlan(await k.as(PEOPLE.installation_manager), { planId: plan.id, action: 'submit', comment: 'Install replacement' });
        await transitionSitePlan(await k.as(PEOPLE.management), { planId: plan.id, action: 'approve', comment: 'Budget approved' });
        const now = (await k.as(PEOPLE.installer)).now;
        const location = (at: number) => ({ latitude: 28.6, longitude: 77.2, accuracy: 8, capturedAt: new Date(at).toISOString() });
        const punch = await siteCheckIn(await k.as(PEOPLE.installer), { visitId: plan.visitId, location: location(now) });
        await siteCheckOut(await k.as(PEOPLE.installer, now + 3600000), { presenceId: punch.presenceId, location: location(now + 3600000) });
        await transitionSitePlan(await k.as(PEOPLE.installation_manager, now + 3600000), { planId: plan.id, action: 'complete', comment: 'Replacement installed' });
        await transitionSitePlan(await k.as(PEOPLE.installation_manager, now + 3600000), { planId: plan.id, action: 'confirm_hours', comment: 'Actual hour confirmed' });
        await k.step(PEOPLE.installation_manager, replacement, {}, { photos: await k.upload(PEOPLE.installation_manager) });
        expect((await k.cstate(complaintId)).status).toBe('closed');
        expect((await k.cstate(originalComplaint)).status).toBe('closed');
    });
    it.each(['to_purchase', 'manufacture'])('runs the %s branch through QA', async (source) => {
        const [o] = await db.query<{
            order_id: string;
            installation_manager_id: string;
        }>('select order_id,installation_manager_id from dispatch where id=$1', [dispatchId]);
        const d = (await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId: o!.order_id, installationManagerId: o!.installation_manager_id, types: ['D1'], factory: 'Main factory', items: [{ componentId, quantity: '1' }] })).dispatchId;
        await deliver(d);
        const c = (await k.receive(d, { [componentId]: { kind: 'missing', quantity: '1', photo: false } })).complaints[0]!.id;
        await k.cstep(PEOPLE.qc, c, { review: 'Confirm shortage' });
        await k.cstep(PEOPLE.planning, c, { cost: source === 'to_purchase' ? '3000' : '6000' });
        const [approval] = await db.query<{
            approval_role: string;
        }>('select approval_role from complaint where id=$1', [c]);
        expect(approval!.approval_role).toBe(source === 'to_purchase' ? 'founders_office' : 'owners');
        await k.cstep(PEOPLE.management, c, { decision: 'approve', reason: 'Cost approved' });
        await k.cstep(PEOPLE.qc, c, { note: 'Send to Planning' });
        await k.cstep(PEOPLE.planning, c, { plan: 'Source replacement', target_date: '2026-10-30' });
        await k.cstep(PEOPLE.store, c, { item_source: source });
        if (source === 'to_purchase') {
            expect((await k.cstate(c)).stage).toBe('purchase');
            await k.cstep(PEOPLE.purchase, c, { po_ref: 'PO-OPS', expected_date: '2026-10-29' });
            await k.cstep(PEOPLE.store, c, { receipt_ref: 'GRN-OPS', received_date: '2026-10-29' });
        }
        else {
            expect((await k.cstate(c)).stage).toBe('production');
            await k.cstep(PEOPLE.production, c, { job_ref: 'JOB-OPS' });
            await k.cstep(PEOPLE.packaging, c, { note: 'Packed and checked' });
        }
        expect((await k.cstate(c)).stage).toBe('qa_review');
        await k.cstep(PEOPLE.qc, c, { root_cause: 'packing', preventive_action: 'Count and photograph every packed item' });
        await k.cstep(PEOPLE.factory_dispatch, c);
    });
    it('tracks preventive projects separately, requiring independent verification', async () => {
        const owner = (await k.as(PEOPLE.installer)).actor.id;
        const p = await createPreventiveProject(await k.as(PEOPLE.qc), { complaintId, ownerId: owner, deadline: '2026-11-10', description: 'Prevent transport damage', steps: ['Introduce corner protectors', 'Train packaging staff'] });
        await expect(advancePreventiveProject(await k.as(PEOPLE.installer), { id: p.id, version: 1, state: 'done', comment: 'Skipped start', completedSteps: [0, 1] })).rejects.toThrow();
        await advancePreventiveProject(await k.as(PEOPLE.installer), { id: p.id, version: 1, state: 'in_progress', comment: 'Work started' });
        await expect(advancePreventiveProject(await k.as(PEOPLE.installer), { id: p.id, version: 2, state: 'done', comment: 'Only one step done', completedSteps: [0] })).rejects.toThrow();
        await advancePreventiveProject(await k.as(PEOPLE.installer), { id: p.id, version: 2, state: 'done', comment: 'Both steps complete', completedSteps: [0, 1] });
        await advancePreventiveProject(await k.as(PEOPLE.qc), { id: p.id, version: 3, state: 'verified', comment: 'Verified on packing line' });
        const r = await operationsReports(db, (await k.as(PEOPLE.installation_manager)).actor);
        expect(r.complaints.length).toBeGreaterThanOrEqual(3);
        expect(r.workforce[0]!.actualMinutes).toBe(60);
        expect(r.preventive.some(x => x.id === p.id)).toBe(false);
    });
});
