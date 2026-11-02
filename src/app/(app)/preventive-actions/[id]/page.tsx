import Link from 'next/link';
import { session } from '@/server/session';
import { requireFlowView, actorRoles } from '@/server/services/flow-core';
import { ProgressPreventive } from '@/components/dispatch/PreventiveForms';
import { Notice } from '@/components/ui/Notice';
export default async function PreventiveRecord({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = await params;
    const { db, actor } = await session();
    if (!/^[0-9a-f-]{36}$/i.test(id))
        return <Notice title="Not found"/>;
    const [r] = await db.query<{
        id: string;
        business_id: string;
        project_id: string;
        owner_id: string;
        owner: string;
        description: string;
        due_date: string;
        preventive_state: string;
        preventive_steps: {
            text: string;
            done: boolean;
        }[];
        version: number;
        complaint_id: string;
    }>(`select i.*,i.due_date::text,e.name owner from issue i left join employee e on e.id=i.owner_id where i.id=$1 and preventive_state is not null`, [id]);
    if (!r)
        return <Notice title="Not found"/>;
    if (r.owner_id !== actor.id) {
        try {
            await requireFlowView(db, actor, r.project_id);
        }
        catch {
            return <Notice title="Not permitted"/>;
        }
    }
    const qa = (await actorRoles(db, actor.id)).includes('qa');
    const canAct = r.preventive_state === 'done' ? qa && r.owner_id !== actor.id : r.owner_id === actor.id;
    const history = await db.query<{
        action: string;
        reason: string | null;
    }>('select action,reason from audit_event where object_type=\'issue\' and object_id=$1 order by id', [id]);
    return <div className="stack"><Link href={`/dispatch/complaints/${r.complaint_id}`}>Complaint journey</Link><h1>{r.business_id} · Preventive action</h1><p role="status">{r.preventive_state.replaceAll('_', ' ')}</p><ol className="row" aria-label="Action lifecycle">{['open', 'in_progress', 'done', 'verified'].map(s => <li key={s} aria-current={s === r.preventive_state ? 'step' : undefined}>{s.replaceAll('_', ' ')}</li>)}</ol><section className="plate"><p>{r.description}</p><p>Owner: {r.owner} · Deadline: {r.due_date}</p><ol>{r.preventive_steps.map((s, i) => <li key={i}>{s.done ? '✓ ' : ''}{s.text}</li>)}</ol>{canAct ? <ProgressPreventive id={id} version={r.version} state={r.preventive_state} steps={r.preventive_steps}/> : <p>{r.preventive_state === 'verified' ? 'Verified and closed.' : `Waiting for ${r.preventive_state === 'done' ? 'a separate QA reviewer' : r.owner}.`}</p>}</section><details><summary>History</summary><ul>{history.map((h, i) => <li key={i}>{h.action.replaceAll('_', ' ')} · {h.reason}</li>)}</ul></details></div>;
}
