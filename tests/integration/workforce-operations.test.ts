import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { freshDb, actor } from './helpers';
import type { Db } from '@/server/db/client';
import { makeCtx } from '@/server/services/context';
import { saveOperationsPolicy } from '@/server/services/operations-policy';
import { createSitePlans, transitionSitePlan, requestRegularization, decideRegularization, sitePlanDetail } from '@/server/services/workforce';
import { siteCheckIn, siteCheckOut } from '@/server/services/site-presence';
describe('site plan operations', () => {
    let db: Db, planId: string, visitId: string, employeeId: string;
    const time = Date.parse('2026-11-02T04:00:00Z');
    const ctx = async (bid: string, now = time) => makeCtx(db, await actor(db, bid), now);
    const loc = (now: number) => ({ latitude: 28.6, longitude: 77.2, accuracy: 10, capturedAt: new Date(now).toISOString() });
    beforeAll(async () => { db = await freshDb(); await db.query("insert into flow_role_member(role_code,employee_id) select 'installation_head',id from employee where business_id='HUB-005'"); await saveOperationsPolicy(await ctx('EMP-004'), { tier1Max: '1000', tier2Max: '5000', planApprover: 'installation_head', regularizationApprover: 'installation_head', readinessReminderDays: 1, installation: { dailyMinutes: 480, hourlyRate: '100' }, complaint: { dailyMinutes: 240, hourlyRate: '150' } }); });
    afterAll(async () => db.close());
    it('creates and approves an existing plan/visit with dated reservations', async () => {
        const [o] = await db.query<{
            id: string;
            project_id: string;
        }>("select o.id,o.project_id from sales_order o join project p on p.id=o.project_id join employee e on e.id=p.manager_id where e.business_id='EMP-001' limit 1");
        employeeId = (await actor(db, 'EMP-020')).id;
        const r = await createSitePlans(await ctx('EMP-001'), { sites: [{ projectId: o!.project_id, orderIds: [o!.id], start: '2026-11-02', end: '2026-11-03', employeeIds: [employeeId], budgetMinutes: 960 }] });
        planId = r.plans[0]!.id;
        visitId = r.plans[0]!.visitId;
        await transitionSitePlan(await ctx('EMP-001'), { planId, action: 'submit', comment: 'Ready for approval' });
        await expect(transitionSitePlan(await ctx('EMP-001'), { planId, action: 'approve', comment: 'Approve own plan' })).rejects.toThrow();
        await transitionSitePlan(await ctx('HUB-005'), { planId, action: 'approve', comment: 'Team and budget checked' });
        expect((await db.query("select id from reservation where visit_id=$1 and state='confirmed'", [visitId])).length).toBe(2);
    });
    it('requires fresh location at both punches and derives actual hours', async () => {
        await expect(siteCheckIn(await ctx('EMP-020'), { visitId })).rejects.toThrow('Location');
        const session = await siteCheckIn(await ctx('EMP-020'), { visitId, location: loc(time) });
        await expect(siteCheckOut(await ctx('EMP-020', time + 3600000), { presenceId: session.presenceId })).rejects.toThrow('Location');
        await siteCheckOut(await ctx('EMP-020', time + 3600000), { presenceId: session.presenceId, location: loc(time + 3600000) });
        const p = await sitePlanDetail(db, (await ctx('EMP-001')).actor, planId);
        expect(p.summary.actualMinutes).toBe(60);
        expect(p.summary.actualCost).toBe('100');
    });
    it('regularization needs approval and preserves actual time', async () => {
        const r = await requestRegularization(await ctx('EMP-001'), { planId, day: '2026-11-03', reason: 'Site unavailable' });
        await expect(transitionSitePlan(await ctx('EMP-001'), { planId, action: 'complete', comment: 'Finish plan' })).rejects.toThrow('pending regularizations');
        await expect(decideRegularization(await ctx('EMP-001'), { id: r.id, approve: true, comment: 'Self approve' })).rejects.toThrow();
        await decideRegularization(await ctx('HUB-005'), { id: r.id, approve: true, comment: 'Site closure confirmed' });
        const p = await sitePlanDetail(db, (await ctx('EMP-001')).actor, planId);
        expect(p.summary.plannedMinutes).toBe(480);
        expect(p.summary.baselineMinutes).toBe(960);
        expect(p.summary.actualMinutes).toBe(60);
        expect(p.summary.budgetVarianceMinutes).toBe(-900);
        await expect(siteCheckIn(await ctx('EMP-020', time + 86400000), { visitId, location: loc(time + 86400000) })).rejects.toThrow();
        await transitionSitePlan(await ctx('EMP-001'), { planId, action: 'complete', comment: 'Installation work complete' });
        await transitionSitePlan(await ctx('EMP-001'), { planId, action: 'confirm_hours', comment: 'Punches checked' });
        expect((await sitePlanDetail(db, (await ctx('EMP-001')).actor, planId)).confirmed_minutes).toBe(60);
    });
});
