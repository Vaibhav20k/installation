'use client';
import { saveOperationsPolicy, activateOperations } from '@/app/actions/operations';
import { useAction } from '@/components/ui/useAction';
import { ResultNotice } from '@/components/ui/ResultNotice';
import type { OperationsPolicy as Policy } from '@/server/services/operations-policy';
export function OperationsPolicy({ policy }: {
    policy: Policy | null;
}) {
    const save = useAction(saveOperationsPolicy, { refresh: false }), activate = useAction(activateOperations);
    return <section className="plate stack"><h2>Operations policy</h2><p>Set approval limits and workforce budgets, then publish the new workflows. Existing records retain their original workflow. Assign the new department roles below before creating new work.</p>
 <form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const val = (k: string) => String(f.get(k)); save.run({ tier1Max: val('tier1Max'), tier2Max: val('tier2Max'), planApprover: val('planApprover'), regularizationApprover: val('regularizationApprover'), readinessReminderDays: Number(val('reminder')), installation: { dailyMinutes: Number(val('installationMinutes')), hourlyRate: val('installationRate') }, complaint: { dailyMinutes: Number(val('complaintMinutes')), hourlyRate: val('complaintRate') } }); }}>
 <div className="fields">{(['tier1Max', 'tier2Max'] as const).map((key, i) => <label className="field" key={key}>Tier {i + 1} maximum (₹, inclusive)<input name={key} type="number" min="0" step="0.01" required defaultValue={policy?.[key]}/></label>)}</div>
 <div className="fields">{(['planApprover', 'regularizationApprover'] as const).map(key => <label className="field" key={key}>{key === 'planApprover' ? 'Site plan approver' : 'Regularization approver'}<select name={key} defaultValue={policy?.[key] ?? 'installation_head'}><option value="installation_head">Installation Head</option><option value="founders_office">Founder’s Office</option><option value="owners">Owners</option></select></label>)}</div>
 {(['installation', 'complaint'] as const).map(key => <fieldset key={key}><legend>{key === 'installation' ? 'Main installation' : 'Complaint installation'}</legend><div className="fields"><label className="field">Planned minutes per person per day (maximum 900)<input name={`${key}Minutes`} type="number" min="1" max="900" required defaultValue={policy?.[key].dailyMinutes}/></label><label className="field">Budget labour rate (₹ per hour)<input name={`${key}Rate`} type="number" min="0" step="0.01" required defaultValue={policy?.[key].hourlyRate}/></label></div></fieldset>)}
 <label className="field">Readiness reminder: days before expected date<input name="reminder" type="number" min="0" max="14" required defaultValue={policy?.readinessReminderDays ?? 1}/></label>
 <button className="primary" disabled={save.pending}>Save policy</button><ResultNotice result={save.result} successText="Policy saved. Existing plan snapshots remain unchanged."/></form>
 <details><summary>Publish revised workflows</summary><p>New dispatches require a packing list, payment confirmation and site readiness. New complaints require cost-tier approval and final QA. Historical no-list dispatches remain readable.</p><button disabled={activate.pending} onClick={() => activate.run({})}>Publish for new records</button><ResultNotice result={activate.result} successText="Operations workflows published."/></details></section>;
}
