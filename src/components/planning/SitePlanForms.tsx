'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSitePlans, transitionSitePlan, requestRegularization, decideRegularization, revisePlanBudget } from '@/app/actions/operations';
import { useAction } from '@/components/ui/useAction';
import { ResultNotice } from '@/components/ui/ResultNotice';
interface Site {
    id: string;
    name: string;
    orders: {
        id: string;
        business_id: string;
    }[];
}
interface Person {
    id: string;
    name: string;
    designation_code: string | null;
}
export function NewSitePlans({ sites, people, designations, complaintId, initialProject }: {
    sites: Site[];
    people: Person[];
    designations: {
        code: string;
        name: string;
    }[];
    complaintId?: string;
    initialProject?: string;
}) {
    const [selected, setSelected] = useState<string[]>(initialProject ? [initialProject] : []);
    const [designation, setDesignation] = useState('');
    const router = useRouter();
    const act = useAction(createSitePlans, { refresh: false, onSuccess: data => router.push(`/site-plans/${(data as {
            plans: {
                id: string;
            }[];
        }).plans[0]!.id}`) });
    return <details open={!!complaintId}><summary>Create {complaintId ? 'complaint installation' : 'site'} plan</summary><form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); act.run({ sites: selected.map(id => ({ projectId: id, orderIds: f.getAll(`${id}-orders`), start: f.get(`${id}-start`), end: f.get(`${id}-end`), employeeIds: f.getAll(`${id}-people`), budgetMinutes: Math.round(Number(f.get(`${id}-budget`)) * 60), complaintId })) }); }}>
 <fieldset><legend>Sites</legend>{sites.map(s => <label className="check" key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(x => e.target.checked ? [...x, s.id] : x.filter(id => id !== s.id))}/>{s.name}</label>)}</fieldset>
 <label className="field">Filter staff by designation<select value={designation} onChange={e => setDesignation(e.target.value)}><option value="">All designations</option>{designations.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
 {sites.filter(s => selected.includes(s.id)).map(s => <fieldset key={s.id}><legend>{s.name}</legend><div className="fields"><label className="field">From<input type="date" name={`${s.id}-start`} required/></label><label className="field">Through<input type="date" name={`${s.id}-end`} required/></label><label className="field">Requested labour budget (hours)<input type="number" name={`${s.id}-budget`} min="0.1" step="0.1" required/></label></div>
 <fieldset><legend>Orders</legend>{s.orders.map(o => <label className="check" key={o.id}><input name={`${s.id}-orders`} type="checkbox" value={o.id} defaultChecked/>{o.business_id}</label>)}</fieldset>
 <fieldset><legend>Staff for this site</legend>{people.map(p => <label className="check" key={p.id} hidden={!!designation && designation !== p.designation_code}><input type="checkbox" name={`${s.id}-people`} value={p.id}/>{p.name}</label>)}</fieldset>
 </fieldset>)}<p className="small muted">Select separate dates or staff for sites whose working hours overlap. The approver checks the requested budget before activation.</p><button className="primary" disabled={act.pending || !selected.length}>Create draft plans</button><ResultNotice result={act.result}/></form></details>;
}
export function PlanTransition({ id, action, label }: {
    id: string;
    action: string;
    label: string;
}) { const a = useAction(transitionSitePlan); return <form className="form" onSubmit={e => { e.preventDefault(); a.run({ planId: id, action, comment: String(new FormData(e.currentTarget).get('comment')) }); }}><label className="field">Comment<input name="comment" minLength={3} maxLength={500} required/></label><button className="primary" disabled={a.pending}>{label}</button><ResultNotice result={a.result} successText="Plan updated."/></form>; }
export function PlanBudget({ id }: {
    id: string;
}) { const a = useAction(revisePlanBudget); return <details><summary>Revise draft budget</summary><form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ planId: id, budgetMinutes: Math.round(Number(f.get('hours')) * 60), reason: String(f.get('reason')) }); }}><label className="field">Budget hours<input name="hours" type="number" min="0.1" step="0.1" required/></label><label className="field">Reason<input name="reason" minLength={3} required/></label><button disabled={a.pending}>Save budget</button><ResultNotice result={a.result}/></form></details>; }
export function Regularize({ id, people }: {
    id: string;
    people: {
        employee_id: string;
        name: string;
    }[];
}) { const a = useAction(requestRegularization); return <details><summary>Exclude a planned day</summary><form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ planId: id, day: String(f.get('day')), employeeId: f.get('person') || undefined, reason: String(f.get('reason')) }); }}><label className="field">Date<input type="date" name="day" required/></label><label className="field">Applies to<select name="person"><option value="">Whole team</option>{people.map(p => <option key={p.employee_id} value={p.employee_id}>{p.name}</option>)}</select></label><label className="field">Reason<input name="reason" minLength={3} required/></label><button disabled={a.pending}>Request approval</button><ResultNotice result={a.result} successText="Day exclusion sent for approval. Attendance evidence is retained."/></form></details>; }
export function RegularizationDecision({ id }: {
    id: string;
}) { const a = useAction(decideRegularization); return <form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ id, approve: f.get('decision') === 'approve', comment: String(f.get('comment')) }); }}><label className="field">Decision<select name="decision"><option value="approve">Approve</option><option value="reject">Reject</option></select></label><label className="field">Comment<input name="comment" minLength={3} required/></label><button disabled={a.pending}>Record decision</button><ResultNotice result={a.result}/></form>; }
