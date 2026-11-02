import { z } from 'zod';
import type { Queryable } from '../db/client';
import { requireAdmin } from '../auth/permissions';
import { validation } from '../errors';
import { audit } from '../audit';
import { parse, type Ctx } from './context';
import { Dec } from '@/domain/decimal';
import type { StageSpec } from '@/domain/flow';
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const workforce = z.object({ dailyMinutes: z.number().int().min(1).max(900, 'Daily planned minutes cannot exceed 900 (09:00 to midnight).'), hourlyRate: money });
export const policySchema = z.object({
    tier1Max: money, tier2Max: money,
    planApprover: z.enum(['installation_head', 'founders_office', 'owners']),
    regularizationApprover: z.enum(['installation_head', 'founders_office', 'owners']),
    readinessReminderDays: z.number().int().min(0).max(14),
    installation: workforce, complaint: workforce,
}).refine(p => Dec.of(p.tier2Max).cmp(p.tier1Max) > 0, 'Tier 2 limit must exceed Tier 1.');
export type OperationsPolicy = z.infer<typeof policySchema>;
export async function operationsPolicy(q: Queryable): Promise<OperationsPolicy> {
    const [r] = await q.query<{
        value: unknown;
    }>("select value from app_setting where key='operations_policy'");
    const p = policySchema.safeParse(r?.value);
    if (!p.success)
        throw validation('Admin must configure Operations policy in Dispatch setup before this action.');
    return p.data;
}
export async function saveOperationsPolicy(ctx: Ctx, input: unknown) {
    requireAdmin(ctx.actor, 'operations policy');
    const d = parse(policySchema, input);
    return ctx.db.tx(async (q) => {
        await q.query("insert into app_setting(key,value) values('operations_policy',$1) on conflict(key) do update set value=excluded.value,updated_at=now()", [JSON.stringify(d)]);
        await audit(q, { actorId: ctx.actor.id, action: 'configure_operations', objectType: 'app_setting', objectId: 'operations_policy', after: d, correlationId: ctx.correlationId });
        return { saved: true };
    });
}
export const approvalRole = (cost: string, p: OperationsPolicy) => Dec.of(cost).cmp(p.tier1Max) <= 0 ? 'installation_manager' : Dec.of(cost).cmp(p.tier2Max) <= 0 ? 'founders_office' : 'owners';
export async function effectiveStage(q: Queryable, s: StageSpec | undefined, type: string, id: string) {
    if(s?.handler==='await_replacement'&&type==='complaint'){
 const [c]=await q.query<{received_at:number|null}>('select received_at from complaint where id=$1',[id]);
 if(c?.received_at)return {...s,label:'Received · awaiting installation'};
 }
 if (!s || type !== 'complaint' || s.handler !== 'approve_cost')
        return s;
    const [c] = await q.query<{
        approval_role: string | null;
    }>('select approval_role from complaint where id=$1', [id]);
    return c?.approval_role ? { ...s, owner: c.approval_role } : s;
}
export async function notifyPeople(q: Queryable, ids: string[], title: string, body: string, href: string, key: string) {
    for (const id of new Set(ids))
        await q.query("insert into notification(employee_id,kind,title,body,href,dedupe_key,effective_at) values($1,'operations',$2,$3,$4,$5,now()) on conflict(dedupe_key) do nothing", [id, title, body, href, `${key}:${id}`]);
}
export async function notifyRoles(q: Queryable, roles: string[], projectId: string, title: string, body: string, href: string, key: string) {
    const people = await q.query<{
        id: string;
    }>(`select distinct e.id from employee e join flow_role_member m on m.employee_id=e.id join project p on p.id=$2
 where e.active and m.role_code=any($1::text[]) and (m.role_code<>'installation_manager' or p.manager_id=e.id)`, [roles, projectId]);
    await notifyPeople(q, people.map(p => p.id), title, body, href, key);
}
