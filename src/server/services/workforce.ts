import { buildSnapshot } from './plan-support';
import { z } from 'zod';
import type { Queryable } from '../db/client';
import type { Actor } from '../auth/permissions';
import { requireProjectScope, requireRole, forbidSelfApproval, projectScopeSql } from '../auth/permissions';
import { conflict, forbidden, validation } from '../errors';
import { audit } from '../audit';
import { parse, one, zId, zDate, type Ctx } from './context';
import { insertVisit } from './planning';
import { operationsPolicy, notifyRoles, notifyPeople, type OperationsPolicy } from './operations-policy';
import { datesBetween, dayDiff, zonedToUtc, localDateOf } from '@/lib/dates';
import { Dec } from '@/domain/decimal';
interface Plan {
    id: string;
    business_id: string;
    project_id: string;
    created_by: string;
    operations_state: string;
    operations_policy: OperationsPolicy;
    budget_minutes: number;
    purpose: 'installation' | 'complaint';
    complaint_id: string | null;
    confirmed_minutes: number | null;
    batch_id: string;
}
export const PLAN_LABELS: Record<string, string> = { draft: 'Draft', pending_approval: 'Pending Approval', active: 'Active', completed: 'Completed', hours_confirmed: 'Man-hours Confirmed' };
async function role(q: Queryable, actor: Actor, code: string) { const [r] = await q.query('select 1 from flow_role_member where employee_id=$1 and role_code=$2', [actor.id, code]); if (!r)
    throw forbidden(`This action requires ${code.replaceAll('_', ' ')}.`); }
async function planFor(q: Queryable, id: string, lock = false) { return one<Plan>(q, `select * from plan where id=$1 and operations_state is not null ${lock ? 'for update' : ''}`, [id], 'Site plan'); }
async function auditPlan(q: Queryable, ctx: Ctx, id: string, action: string, after: unknown, reason?: string) { await audit(q, { actorId: ctx.actor.id, action, objectType: 'plan', objectId: id, after, reason, correlationId: ctx.correlationId }); }
async function staff(q: Queryable, id: string) { return q.query<{
    employee_id: string;
    name: string;
}>(`select distinct r.employee_id,e.name from reservation r join visit v on v.id=r.visit_id join employee e on e.id=r.employee_id where v.plan_id=$1 and r.state in ('proposed','confirmed','held','released')`, [id]); }
export async function createSitePlans(ctx: Ctx, input: unknown) {
    const d = parse(z.object({ sites: z.array(z.object({ projectId: zId, orderIds: z.array(zId).min(1), start: zDate, end: zDate, employeeIds: z.array(zId).min(1).max(12), budgetMinutes: z.number().int().positive().max(10000000), complaintId: zId.optional() })).min(1).max(20) }), input);
    requireRole(ctx.actor, 'manager', 'creating site plans');
    return ctx.db.tx(async (q) => {
        const policy = await operationsPolicy(q);
        const batch = crypto.randomUUID();
        const result = [];
        await q.query('lock table plan, visit in share row exclusive mode');
        for (const s of d.sites) {
            await requireProjectScope(q, ctx.actor, s.projectId);
            if (s.end < s.start || dayDiff(s.start, s.end) > 61)
                throw validation('Select a date range of at most 62 days.');
            const people = [...new Set(s.employeeIds)];
            const employees = await q.query<{
                id: string;
                job_role: string;
            }>('select id,job_role from employee where active and id=any($1::uuid[])', [people]);
            if (employees.length !== people.length)
                throw validation('Every assigned person must be active.');
            if (s.complaintId) {
                const c = await one<{
                    project_id: string;
                    status: string;
                    received_at: number | null;
                    installation_visit_id: string | null;
                }>(q, 'select project_id,status,received_at,installation_visit_id from complaint where id=$1 for update', [s.complaintId], 'Complaint');
                if (c.project_id !== s.projectId || c.status !== 'open' || !c.received_at)
                    throw validation('Create complaint installation plans after receipt, for the same site.');
                if (c.installation_visit_id)
                    throw conflict('This complaint already has an installation Site Plan.');
            }
            const [n] = await q.query<{
                n: number;
            }>("select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from plan");
            const bid = `PLN-${String(n!.n).padStart(3, '0')}`;
            const [p] = await q.query<{
                id: string;
            }>(`insert into plan(business_id,project_id,created_by,batch_id,operations_state,operations_policy,budget_minutes,purpose,complaint_id)
 values($1,$2,$3,$4,'draft',$5,$6,$7,$8) returning id`, [bid, s.projectId, ctx.actor.id, batch, JSON.stringify(policy), s.budgetMinutes, s.complaintId ? 'complaint' : 'installation', s.complaintId ?? null]);
            await q.query("insert into plan_revision(plan_id,revision_no,snapshot,created_by,change_reason) values($1,1,'{\"visits\":[]}',$2,'Site plan')", [p!.id, ctx.actor.id]);
            const v = await insertVisit(q, ctx, { planId: p!.id, visitType: s.complaintId ? 'follow_up' : 'fresh', repeatReason: s.complaintId ? 'rework' : undefined, plannedStart: s.start, plannedEnd: s.end, teamSize: people.length, orderIds: s.orderIds });
            const site = await one<{
                timezone: string;
            }>(q, 'select timezone from project where id=$1', [s.projectId], 'Site');
            const minutes = policy[s.complaintId ? 'complaint' : 'installation'].dailyMinutes;
            // One reservation per day makes exclusions and multi-site dates explicit and keeps the existing overlap constraint.
            for (const day of datesBetween(s.start, s.end))
                for (const e of employees) {
                    const start = zonedToUtc(day, '09:00', site.timezone);
                    const end = start + minutes * 60000;
                    if (localDateOf(end - 1, site.timezone) !== day)
                        throw validation('Daily planned minutes must fit between 09:00 and midnight.');
                    await q.query("insert into reservation(visit_id,employee_id,role,span,state,created_by) values($1,$2,$3,tstzrange($4,$5),'proposed',$6)", [v.id, e.id, e.job_role, new Date(start).toISOString(), new Date(end).toISOString(), ctx.actor.id]);
                }
            if (s.complaintId)
                await q.query('update complaint set installation_visit_id=$2 where id=$1', [s.complaintId, v.id]);
            await auditPlan(q, ctx, p!.id, 'site_plan_created', s);
            result.push({ id: p!.id, businessId: bid, visitId: v.id });
        }
        return { plans: result, batchId: batch };
    });
}
export async function workforceSummary(q: Queryable, p: Plan) {
    const rows = await q.query<{
        employee_id: string;
        lo: number;
        hi: number;
        timezone: string;
    }>(`select r.employee_id,lower(r.span) lo,upper(r.span) hi,pr.timezone from reservation r join visit v on v.id=r.visit_id join project pr on pr.id=v.project_id where v.plan_id=$1 and r.state in ('proposed','confirmed','held','released')`, [p.id]);
    const exclusions = await q.query<{
        employee_id: string | null;
        day: string;
    }>("select employee_id,day::text from plan_regularization where plan_id=$1 and state='approved'", [p.id]);
    let baseline = 0, planned = 0;
    for (const r of rows) {
        const minutes = (Number(r.hi) - Number(r.lo)) / 60000;
        baseline += minutes;
        if (!exclusions.some(x => x.day === localDateOf(Number(r.lo), r.timezone) && (!x.employee_id || x.employee_id === r.employee_id)))
            planned += minutes;
    }
    const [actual] = await q.query<{
        minutes: number;
        open: number;
    }>(`select coalesce(sum(extract(epoch from(s.check_out_at-s.check_in_at))/60) filter(where s.check_out_at is not null and not s.missed_checkout),0)::float8 minutes,count(*) filter(where s.check_out_at is null or s.missed_checkout)::int open from site_presence s join visit v on v.id=s.visit_id where v.plan_id=$1 and not s.voided`, [p.id]);
    const actualMinutes = Math.round(Number(actual!.minutes));
    const rate = p.operations_policy[p.purpose].hourlyRate;
    return { baselineMinutes: Math.round(baseline), plannedMinutes: Math.round(planned), actualMinutes, varianceMinutes: actualMinutes - Math.round(planned), budgetMinutes: p.budget_minutes, budgetVarianceMinutes: actualMinutes - p.budget_minutes, openPunches: actual!.open,
        plannedCost: Dec.of(rate).mul(planned).div(60).toString(), actualCost: Dec.of(rate).mul(actualMinutes).div(60).toString(), budgetCost: Dec.of(rate).mul(p.budget_minutes).div(60).toString() };
}
export async function transitionSitePlan(ctx: Ctx, input: unknown) {
    const d = parse(z.object({ planId: zId, action: z.enum(['submit', 'approve', 'reject', 'complete', 'confirm_hours']), comment: z.string().trim().min(3).max(500) }), input);
    return ctx.db.tx(async (q) => {
        const p = await planFor(q, d.planId, true);
        const href = `/site-plans/${p.id}`;
        const policy = p.operations_policy;
        if (['approve', 'reject'].includes(d.action))
            await role(q, ctx.actor, policy.planApprover);
        else {
            requireRole(ctx.actor, 'manager');
            await requireProjectScope(q, ctx.actor, p.project_id);
        }
        const expected = { submit: 'draft', approve: 'pending_approval', reject: 'pending_approval', complete: 'active', confirm_hours: 'completed' }[d.action];
        if (p.operations_state !== expected)
            throw conflict(`This plan is ${PLAN_LABELS[p.operations_state]}. Refresh before acting.`);
        const summary = await workforceSummary(q, p);
        const people = await staff(q, p.id);
        const next = { submit: 'pending_approval', approve: 'active', reject: 'draft', complete: 'completed', confirm_hours: 'hours_confirmed' }[d.action];
        if (d.action === 'submit' || d.action === 'approve') {
            if (!people.length || summary.plannedMinutes <= 0)
                throw conflict('Assign staff with planned working hours before submitting or approving this Site Plan.');
            if (summary.plannedMinutes > p.budget_minutes)
                throw conflict(`Planned hours exceed the approved budget by ${(summary.plannedMinutes - p.budget_minutes) / 60} hours. Revise the draft budget or dates first.`);
        }
        const [rev] = await q.query<{
            id: string;
            revision_no: number;
        }>('select id,revision_no from plan_revision where plan_id=$1 order by revision_no desc limit 1', [p.id]);
        if (d.action === 'submit') {
            await q.query("update plan_revision set approval_state='submitted',submitted_by=$2,submitted_at=$3,snapshot=$4 where id=$1", [rev!.id, ctx.actor.id, new Date(ctx.now).toISOString(), JSON.stringify({ ...await buildSnapshot(q, p.id), operations: { summary, people, policy } })]);
            await notifyRoles(q, [policy.planApprover], p.project_id, `${p.business_id}: approval needed`, d.comment, href, `submit:${p.id}:${rev!.revision_no}`);
        }
        if (d.action === 'approve' || d.action === 'reject') {
            forbidSelfApproval(ctx.actor, p.created_by, 'site plan');
            if (d.action === 'approve') {
                // Database exclusion constraint remains the last line of defence against concurrent double booking.
                const clashes = await q.query(`select 1 from reservation r join visit v on v.id=r.visit_id where v.plan_id=$1 and r.state='proposed' and (exists(select 1 from reservation other where other.employee_id=r.employee_id and other.state in ('held','confirmed') and other.span && r.span) or exists(select 1 from leave_record l where l.employee_id=r.employee_id and l.status='approved' and l.span && r.span)) limit 1`, [p.id]);
                if (clashes.length)
                    throw conflict('A staff member has another booking or leave in this date range.');
                const reservations = await q.query<{
                    id: string;
                }>("update reservation set state='confirmed' where visit_id in(select id from visit where plan_id=$1) and state='proposed' returning id", [p.id]);
                for (const r of reservations)
                    await audit(q, { actorId: ctx.actor.id, action: 'reservation_confirmed', objectType: 'reservation', objectId: r.id, before: { state: 'proposed' }, after: { state: 'confirmed', planId: p.id }, correlationId: ctx.correlationId });
                const visits = await q.query<{
                    id: string;
                }>("update visit set exec_status='scheduled',version=version+1 where plan_id=$1 returning id", [p.id]);
                for (const v of visits)
                    await audit(q, { actorId: ctx.actor.id, action: 'visit_scheduled', objectType: 'visit', objectId: v.id, after: { state: 'scheduled', planId: p.id }, correlationId: ctx.correlationId });
            }
            await q.query('update plan_revision set approval_state=$2,decided_by=$3,decided_at=$4,decision_note=$5 where id=$1', [rev!.id, d.action === 'approve' ? 'approved' : 'returned', ctx.actor.id, new Date(ctx.now).toISOString(), d.comment]);
            if (d.action === 'approve')
                await q.query('update plan set current_revision_id=$2,baseline_revision_id=coalesce(baseline_revision_id,$2) where id=$1', [p.id, rev!.id]);
            else
                await q.query("insert into plan_revision(plan_id,revision_no,snapshot,created_by,change_reason) values($1,$2,'{\"visits\":[]}',$3,$4)", [p.id, rev!.revision_no + 1, p.created_by, d.comment]);
            await notifyPeople(q, [p.created_by, ...(d.action === 'approve' ? people.map(e => e.employee_id) : [])], `${p.business_id}: ${d.action === 'approve' ? 'assigned' : 'returned'}`, d.comment, href, `${d.action}:${p.id}:${rev!.revision_no}`);
        }
        if (d.action === 'complete') {
            const pending = await q.query("select 1 from plan_regularization where plan_id=$1 and state='pending'", [p.id]);
            if (pending.length)
                throw conflict('Decide pending regularizations before completing the plan.');
            if (summary.openPunches)
                throw conflict('Resolve open or missed site punches before completing the plan.');
            const visits = await q.query<{
                id: string;
            }>("update visit set exec_status='completed',version=version+1 where plan_id=$1 returning id", [p.id]);
            for (const v of visits)
                await audit(q, { actorId: ctx.actor.id, action: 'visit_completed', objectType: 'visit', objectId: v.id, after: { state: 'completed', planId: p.id }, correlationId: ctx.correlationId });
        }
        if (d.action === 'confirm_hours' && summary.openPunches)
            throw conflict('Resolve open or missed site punches before confirming man-hours.');
        if (d.action === 'confirm_hours')
            await q.query('update plan set confirmed_minutes=$2,confirmed_by=$3,confirmed_at=$4 where id=$1', [p.id, summary.actualMinutes, ctx.actor.id, new Date(ctx.now).toISOString()]);
        await q.query('update plan set operations_state=$2 where id=$1', [p.id, next]);
        await auditPlan(q, ctx, p.id, `site_plan_${d.action}`, { from: p.operations_state, to: next, summary }, d.comment);
        return { state: next };
    });
}
export async function revisePlanBudget(ctx: Ctx, input: unknown) { const d = parse(z.object({ planId: zId, budgetMinutes: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }), input); requireRole(ctx.actor, 'manager'); return ctx.db.tx(async (q) => { const p = await planFor(q, d.planId, true); await requireProjectScope(q, ctx.actor, p.project_id); if (p.operations_state !== 'draft')
    throw conflict('Only draft budgets can be revised.'); await q.query('update plan set budget_minutes=$2 where id=$1', [p.id, d.budgetMinutes]); await auditPlan(q, ctx, p.id, 'revise_plan_budget', { before: p.budget_minutes, after: d.budgetMinutes }, d.reason); return { saved: true }; }); }
export async function requestRegularization(ctx: Ctx, input: unknown) {
    const d = parse(z.object({ planId: zId, employeeId: zId.optional(), day: zDate, reason: z.string().trim().min(3).max(500) }), input);
    requireRole(ctx.actor, 'manager');
    return ctx.db.tx(async (q) => {
        const p = await planFor(q, d.planId, true);
        await requireProjectScope(q, ctx.actor, p.project_id);
        if (p.operations_state !== 'active')
            throw conflict('Regularize an active plan before completion.');
        const people = await staff(q, p.id);
        if (d.employeeId && !people.some(e => e.employee_id === d.employeeId))
            throw validation('This person is not assigned to the plan.');
        const [v] = await q.query<{
            planned_start: string;
            planned_end: string;
        }>('select planned_start::text,planned_end::text from visit where plan_id=$1', [p.id]);
        if (!v || d.day < v.planned_start || d.day > v.planned_end)
            throw validation('Choose a date inside the plan.');
        const [duplicate] = await q.query("select 1 from plan_regularization where plan_id=$1 and day=$2 and employee_id is not distinct from $3::uuid and state in ('pending','approved')", [p.id, d.day, d.employeeId ?? null]);
        if (duplicate)
            throw conflict('This day already has a pending or approved exclusion.');
        const [r] = await q.query<{
            id: string;
        }>('insert into plan_regularization(plan_id,employee_id,day,reason,requested_by) values($1,$2,$3,$4,$5) returning id', [p.id, d.employeeId ?? null, d.day, d.reason, ctx.actor.id]);
        await notifyRoles(q, [p.operations_policy.regularizationApprover], p.project_id, `${p.business_id}: regularization approval`, d.reason, `/site-plans/${p.id}`, `regularization:${r!.id}`);
        await auditPlan(q, ctx, p.id, 'request_regularization', { id: r!.id, ...d }, d.reason);
        return { id: r!.id };
    });
}
export async function decideRegularization(ctx: Ctx, input: unknown) {
    const d = parse(z.object({ id: zId, approve: z.boolean(), comment: z.string().trim().min(3).max(500) }), input);
    return ctx.db.tx(async (q) => {
        const r = await one<{
            id: string;
            plan_id: string;
            employee_id: string | null;
            day: string;
            state: string;
            requested_by: string;
        }>(q, 'select *,day::text from plan_regularization where id=$1 for update', [d.id], 'Regularization');
        const p = await planFor(q, r.plan_id, true);
        await role(q, ctx.actor, p.operations_policy.regularizationApprover);
        forbidSelfApproval(ctx.actor, r.requested_by, 'regularization');
        if (r.state !== 'pending' || p.operations_state !== 'active')
            throw conflict('This regularization is no longer pending on an active plan.');
        await q.query('update plan_regularization set state=$2,decided_by=$3,decision_note=$4,decided_at=$5 where id=$1', [r.id, d.approve ? 'approved' : 'rejected', ctx.actor.id, d.comment, new Date(ctx.now).toISOString()]);
        if (d.approve)
            await q.query(`update reservation r set state='released',version=r.version+1 from visit v, project pr where r.visit_id=v.id and pr.id=v.project_id and v.plan_id=$1 and ($2::uuid is null or r.employee_id=$2) and (lower(r.span) at time zone pr.timezone)::date=$3::date and r.state='confirmed'`, [p.id, r.employee_id, r.day]);
        await notifyPeople(q, [p.created_by, ...(await staff(q, p.id)).map(e => e.employee_id)], `${p.business_id}: day ${d.approve ? 'excluded' : 'unchanged'}`, `${r.day}: ${d.comment}`, `/site-plans/${p.id}`, `regularization-decision:${r.id}`);
        await auditPlan(q, ctx, p.id, 'decide_regularization', { id: r.id, approve: d.approve }, d.comment);
        return { saved: true };
    });
}
export async function sitePlanDetail(q: Queryable, actor: Actor, id: string) {
    const p = await planFor(q, id);
    const roles = (await q.query<{
        role_code: string;
    }>('select role_code from flow_role_member where employee_id=$1', [actor.id])).map(r => r.role_code);
    const people = await staff(q, p.id);
    const reviewer = roles.includes(p.operations_policy.planApprover) || roles.includes(p.operations_policy.regularizationApprover);
    const head = roles.includes('installation_head');
    if (!head && !reviewer && actor.role === 'employee' && !people.some(e => e.employee_id === actor.id))
        throw forbidden('This site plan is not assigned to you.');
    if (!head && !reviewer && !people.some(e => e.employee_id === actor.id))
        await requireProjectScope(q, actor, p.project_id);
    const summary = await workforceSummary(q, p);
    const project = await one<{name:string;site_address:string}>(q,'select name,site_address from project where id=$1',[p.project_id],'Site');
    const visits = await q.query<{id:string;business_id:string;planned_start:string;planned_end:string}>('select id,business_id,planned_start::text,planned_end::text from visit where plan_id=$1 order by sequence',[p.id]);
    const regularizations = await q.query<{
        id: string;
        day: string;
        reason: string;
        state: string;
        employee_id: string | null;
        requested_by: string;
        decision_note: string | null;
    }>('select *,day::text from plan_regularization where plan_id=$1 order by created_at', [id]);
    const history = await q.query<{
        action: string;
        reason: string | null;
        at: number;
    }>('select action,reason,at from audit_event where object_type=\'plan\' and object_id=$1 order by at', [id]);
    return { ...p, project, visits, people, summary, regularizations, history, canReview: roles.includes(p.operations_policy.planApprover) && actor.id !== p.created_by, canRegularizeReview: roles.includes(p.operations_policy.regularizationApprover), canManage: actor.role === 'admin' || actor.id === p.created_by };
}
export async function sitePlans(q: Queryable, actor: Actor) {
    const scope = projectScopeSql(actor, 'pr', '$1');
    const params = scope.all ? [] : [actor.id];
    const assigned = actor.role === 'employee' ? `exists(select 1 from reservation r join visit v on v.id=r.visit_id where v.plan_id=p.id and r.employee_id=$1)` : scope.sql;
    const extra = scope.all ? 'true' : `(${assigned} or exists(select 1 from flow_role_member fm where fm.employee_id=$1 and fm.role_code in('installation_head',p.operations_policy->>'planApprover',p.operations_policy->>'regularizationApprover')))`;
    return q.query<Plan & {
        project: string;
    }>(`select p.*,pr.name project from plan p join project pr on pr.id=p.project_id where p.operations_state is not null and ${extra} order by p.created_at desc`, params);
}
