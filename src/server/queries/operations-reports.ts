import type { Queryable } from '../db/client';
import type { Actor } from '../auth/permissions';
import { flowFilter } from '../services/flow-core';
import { sitePlans, sitePlanDetail } from '../services/workforce';
import { allDefinitions, stageFor } from './dispatch';
import { effectiveStage } from '../services/operations-policy';
export async function operationsReports(q: Queryable, actor: Actor) {
    const f = await flowFilter(q, actor, 'p', 1);
    const defs = await allDefinitions(q);
    const complaints = await q.query<{
        id: string;
        business_id: string;
        kind: string;
        reason: string;
        suspected_cause: string | null;
        qa_root_cause: string | null;
        preventive_action: string | null;
        item: string;
        component_id: string;
        stage: string;
        status: string;
        config_version: number;
        created_at: number;
        stage_entered_at: number;
        project: string;
    }>(`select c.id,c.business_id,c.kind,c.reason,c.suspected_cause,c.qa_root_cause,c.preventive_action,cm.name item,c.component_id,c.stage,c.status,c.config_version,c.created_at,c.stage_entered_at,p.name project from complaint c join component cm on cm.id=c.component_id join project p on p.id=c.project_id where ${f.sql} order by c.created_at desc`, f.params);
    const current = await Promise.all(complaints.map(async (c) => { const s = await effectiveStage(q, stageFor(defs, 'complaint', c.config_version, c.stage), 'complaint', c.id); return { ...c, label: s?.label ?? c.stage, owner: s?.owner ?? 'system', mismatch: c.suspected_cause && c.qa_root_cause ? c.suspected_cause !== c.qa_root_cause : null }; }));
    const durations = await q.query<{
        subject_id: string;
        stage: string;
        hours: number;
        entered: number;
    }>(`select subject_id,to_stage stage,at entered,greatest(0,extract(epoch from(coalesce(lead(at) over(partition by subject_id order by seq),case when to_stage='closed' then at else now() end)-at))/3600)::float8 hours from stage_history where subject_type='complaint' and subject_id=any($1::uuid[]) order by subject_id,seq`, [complaints.map(c => c.id)]);
    const recurrence = new Map<string, {
        item: string;
        category: string;
        month: string;
        count: number;
    }>();
    for (const c of complaints) {
        const month = new Date(c.created_at).toISOString().slice(0, 7);
        const category = c.qa_root_cause ?? c.kind;
        const key = `${c.item.trim().toLowerCase()}|${category}|${month}`;
        const r = recurrence.get(key) ?? { item: c.item, category, month, count: 0 };
        r.count++;
        recurrence.set(key, r);
    }
    const preventive = await q.query<{
        id: string;
        business_id: string;
        description: string;
        owner: string;
        due_date: string;
        preventive_state: string;
    }>(`select i.id,i.business_id,i.description,e.name owner,i.due_date::text,i.preventive_state from issue i join project p on p.id=i.project_id left join employee e on e.id=i.owner_id where i.preventive_state is not null and i.preventive_state<>'verified' and ${f.sql} order by i.due_date`, f.params);
    const plans = await sitePlans(q, actor);
    const workforce = await Promise.all(plans.map(async (p) => ({ id: p.id, business_id: p.business_id, project: p.project, ...(await sitePlanDetail(q, actor, p.id)).summary })));
    return { complaints: current, durations, recurrence: [...recurrence.values()].sort((a, b) => b.count - a.count), preventive, workforce };
}
