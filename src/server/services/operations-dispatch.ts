import type { Queryable } from '../db/client';
import type { Ctx } from './context';
import { conflict, validation } from '../errors';
import { audit } from '../audit';
import { notifyRoles } from './operations-policy';
export async function dispatchGate(q: Queryable, id: string) {
    const [d] = await q.query<{
        site_ready: boolean;
        payment_state: string;
        replacement_for: string | null;
    }>('select site_ready,payment_state,replacement_for from dispatch where id=$1', [id]);
    if (!d?.site_ready)
        throw conflict('Waiting for Installation Manager: site readiness.');
    if (d.payment_state !== 'received')
        throw conflict('Waiting for Finance: payment confirmation.');
    if (d.replacement_for) {
        const [c] = await q.query<{
            qa_at: number | null;
            qa_root_cause: string | null;
            preventive_action: string | null;
        }>('select qa_at,qa_root_cause,preventive_action from complaint where id=$1', [d.replacement_for]);
        if (!c?.qa_at || !c.qa_root_cause?.trim() || !c.preventive_action?.trim())
            throw conflict('Waiting for QA: final root cause and preventive action.');
    }
}
export async function operationsDispatchStep(q: Queryable, ctx: Ctx, row: {
    id: string;
    project_id: string;
    business_id: string;
    replacement_for: string | null;
}, stage: string, data: Record<string, string>) {
    if (stage === 'site_readiness')
        await q.query('update dispatch set site_ready=$2 where id=$1', [row.id, data.status === 'ready']);
    if (stage === 'payment_request')
        await q.query("update dispatch set payment_state='requested' where id=$1", [row.id]);
    if (stage === 'payment_check') {
        if (!['received', 'not_received'].includes(data.decision ?? '') || !data.note?.trim())
            throw validation('Finance must record a decision and note.');
        await q.query('update dispatch set payment_state=$2,payment_note=$3,payment_decided_by=$4 where id=$1', [row.id, data.decision, data.note, ctx.actor.id]);
    }
    if (stage === 'cleared' || stage === 'dispatched')
        await dispatchGate(q, row.id);
    if (stage === 'received')
        await q.query('update dispatch set received_at=$2 where id=$1', [row.id, new Date(ctx.now).toISOString()]);
    if (stage === 'installation_done') {
        await q.query('update dispatch set installed_at=$2 where id=$1', [row.id, new Date(ctx.now).toISOString()]);
        if (row.replacement_for) {
            const [c] = await q.query<{
                id: string;
                stage: string;
                status: string;
                installation_visit_id: string | null;
                superseded_by: string | null;
            }>('select id,stage,status,installation_visit_id,superseded_by from complaint where id=$1 for update', [row.replacement_for]);
            if (c?.status === 'open') {
                if (c.superseded_by) throw conflict('Waiting for the follow-up replacement to be installed.');
                const [plan] = await q.query<{
                    operations_state: string;
                }>(`select p.operations_state from visit v join plan p on p.id=v.plan_id where v.id=$1 and p.complaint_id=$2`, [c.installation_visit_id, c.id]);
                if (!plan || !['completed', 'hours_confirmed'].includes(plan.operations_state))
                    throw conflict('Complete the complaint Site Plan before confirming installation done.');
                await q.query("update complaint set installed_at=$2,stage='closed',status='closed',outcome='replaced',closed_at=$2,stage_entered_at=$2,version=version+1 where id=$1", [c.id, new Date(ctx.now).toISOString()]);
                await q.query("insert into stage_history(subject_type,subject_id,from_stage,to_stage,kind,data,actor_id,at) values('complaint',$1,$2,'closed','close',$3,$4,$5)", [c.id, c.stage, JSON.stringify({ milestones: ['Installed', 'Closed'], replacement: row.business_id }), ctx.actor.id, new Date(ctx.now).toISOString()]);
                await audit(q, { actorId: ctx.actor.id, action: 'complaint_installed_closed', objectType: 'complaint', objectId: c.id, after: { dispatch: row.id }, correlationId: ctx.correlationId });
                let resolvedId = c.id;
                while (true) {
                    const [prior] = await q.query<{ id: string; stage: string }>("select id,stage from complaint where superseded_by=$1 and status='open' for update", [resolvedId]);
                    if (!prior) break;
                    await q.query("update complaint set installed_at=$2,stage='closed',status='closed',outcome='superseded',closed_at=$2,stage_entered_at=$2,version=version+1 where id=$1", [prior.id, new Date(ctx.now).toISOString()]);
                    await q.query("insert into stage_history(subject_type,subject_id,from_stage,to_stage,kind,data,actor_id,at) values('complaint',$1,$2,'closed','close',$3,$4,$5)", [prior.id, prior.stage, JSON.stringify({ milestones: ['Installed', 'Closed'], resolved_by: c.id, replacement: row.business_id }), ctx.actor.id, new Date(ctx.now).toISOString()]);
                    await audit(q, { actorId: ctx.actor.id, action: 'complaint_installed_closed', objectType: 'complaint', objectId: prior.id, after: { resolvedBy: c.id, dispatch: row.id }, correlationId: ctx.correlationId });
                    resolvedId = prior.id;
                }
            }
        }
        const [order] = await q.query<{
            order_id: string;
        }>('select order_id from dispatch where id=$1', [row.id]);
        await notifyRoles(q, ['factory', 'factory_dispatch'], row.project_id, `${row.business_id}: Installation Done`, 'Begin packaging the next dispatch for this order.', `/dispatch/new?order=${order!.order_id}`, `installation-done:${row.id}`);
    }
    if (['site_readiness', 'payment_check'].includes(stage))
        await notifyRoles(q, ['dispatch_department'], row.project_id, `${row.business_id}: ${stage.replaceAll('_', ' ')}`, data.status ?? data.decision ?? 'Updated', `/dispatch/${row.id}`, `${row.id}:${stage}:${ctx.correlationId}`);
}
