import { z } from 'zod';
import { parse, one, zId, zDate, type Ctx } from './context';
import { requireAdmin } from '../auth/permissions';
import { requireFlowView, actorRoles } from './flow-core';
import { conflict, forbidden, validation } from '../errors';
import { audit } from '../audit';
import { notifyPeople } from './operations-policy';
export async function createPreventiveProject(ctx: Ctx, input: unknown) {
    const d = parse(z.object({ complaintId: zId, ownerId: zId, deadline: zDate, steps: z.array(z.string().trim().min(3).max(300)).min(1).max(30), description: z.string().trim().min(3).max(2000) }), input);
    return ctx.db.tx(async (q) => {
        const c = await one<{
            project_id: string;
            order_id: string;
            qa_root_cause: string | null;
        }>(q, 'select project_id,order_id,qa_root_cause from complaint where id=$1', [d.complaintId], 'Complaint');
        await requireFlowView(q, ctx.actor, c.project_id);
        if (!(await actorRoles(q, ctx.actor.id)).includes('qa'))
            throw forbidden('QA creates preventive action projects.');
        const [owner] = await q.query('select 1 from employee where id=$1 and active', [d.ownerId]);
        if (!owner)
            throw validation('Select an active owner.');
        await q.query('lock table issue in share row exclusive mode');
        const [r] = await q.query<{
            id: string;
        }>(`insert into issue(business_id,raised_on,project_id,order_id,function,category,description,owner_id,due_date,complaint_id,preventive_state,preventive_steps)
 values('ISS-'||lpad((select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 from issue)::text,4,'0'),$1,$2,$3,'qa',$4,$5,$6,$7,$8,'open',$9) returning id`, [new Date(ctx.now).toISOString().slice(0, 10), c.project_id, c.order_id, c.qa_root_cause ?? 'other', d.description, d.ownerId, d.deadline, d.complaintId, JSON.stringify(d.steps.map(text => ({ text, done: false })))]);
        await audit(q, { actorId: ctx.actor.id, action: 'preventive_project_created', objectType: 'issue', objectId: r!.id, after: d, correlationId: ctx.correlationId });
        await notifyPeople(q, [d.ownerId], 'Preventive action assigned', d.description, `/preventive-actions/${r!.id}`, `preventive:${r!.id}`);
        return { id: r!.id };
    });
}
export async function advancePreventiveProject(ctx: Ctx, input: unknown) {
    const d = parse(z.object({ id: zId, version: z.number().int(), state: z.enum(['in_progress', 'done', 'verified']), comment: z.string().trim().min(3).max(500), completedSteps: z.array(z.number().int().nonnegative()).optional() }), input);
    return ctx.db.tx(async (q) => {
        const r = await one<{
            id: string;
            version: number;
            owner_id: string;
            preventive_state: string;
            preventive_steps: {
                text: string;
                done: boolean;
            }[];
            project_id: string;
        }>(q, 'select * from issue where id=$1 and preventive_state is not null for update', [d.id], 'Preventive project');
        if (r.version !== d.version || ({ open: 'in_progress', in_progress: 'done', done: 'verified' } as Record<string, string>)[r.preventive_state] !== d.state)
            throw conflict('This preventive action changed or the transition skips a step.');
        if (d.state === 'verified') {
            if (!(await actorRoles(q, ctx.actor.id)).includes('qa') || ctx.actor.id === r.owner_id)
                throw forbidden('A different QA reviewer verifies the completed action.');
        }
        else if (ctx.actor.id !== r.owner_id)
            throw forbidden('Only the assigned owner progresses this action.');
        if (d.state === 'done' && r.preventive_steps.some((_, i) => !d.completedSteps?.includes(i)))
            throw validation('Confirm each preventive action step before marking done.');
        const steps = d.state === 'done' ? r.preventive_steps.map(s => ({ ...s, done: true })) : r.preventive_steps;
        await q.query(`update issue set preventive_state=$2,preventive_steps=$3,status=$4,version=version+1,closed_on=$5,closure_evidence=$6 where id=$1`, [r.id, d.state, JSON.stringify(steps), d.state === 'verified' ? 'closed' : 'in_progress', d.state === 'verified' ? new Date(ctx.now).toISOString().slice(0, 10) : null, d.state === 'verified' ? d.comment : null]);
        await audit(q, { actorId: ctx.actor.id, action: `preventive_${d.state}`, objectType: 'issue', objectId: r.id, before: { state: r.preventive_state }, after: { state: d.state }, reason: d.comment, correlationId: ctx.correlationId });
        return { state: d.state };
    });
}
export async function saveDesignation(ctx: Ctx, input: unknown) { requireAdmin(ctx.actor); const d = parse(z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), name: z.string().trim().min(2).max(80) }), input); return ctx.db.tx(async (q) => { await q.query('insert into designation(code,name) values($1,$2) on conflict(code) do update set name=excluded.name,active=true', [d.code, d.name]); await audit(q, { actorId: ctx.actor.id, action: 'save_designation', objectType: 'designation', objectId: d.code, after: d, correlationId: ctx.correlationId }); return { saved: true }; }); }
export async function assignDesignation(ctx: Ctx, input: unknown) { requireAdmin(ctx.actor); const d = parse(z.object({ employeeId: zId, code: z.string().max(40) }), input); return ctx.db.tx(async (q) => { await one(q, 'select code from designation where code=$1 and active', [d.code], 'Designation'); await one(q, 'select id from employee where id=$1', [d.employeeId], 'Employee'); await q.query('update employee set designation_code=$2 where id=$1', [d.employeeId, d.code]); await audit(q, { actorId: ctx.actor.id, action: 'assign_designation', objectType: 'employee', objectId: d.employeeId, after: d, correlationId: ctx.correlationId }); return { saved: true }; }); }
