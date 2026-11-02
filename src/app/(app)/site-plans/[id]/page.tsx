import Link from 'next/link';
import { session } from '@/server/session';
import { sitePlanDetail, PLAN_LABELS } from '@/server/services/workforce';
import { PlanTransition, PlanBudget, Regularize, RegularizationDecision } from '@/components/planning/SitePlanForms';
import { Notice } from '@/components/ui/Notice';
import { when } from '@/lib/format';
export default async function PlanRecord({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = await params;
    const { db, actor } = await session();
    if (!/^[0-9a-f-]{36}$/i.test(id))
        return <Notice title="Not found"/>;
    let p;
    try {
        p = await sitePlanDetail(db, actor, id);
    }
    catch {
        return <Notice title="This plan is unavailable in your scope."/>;
    }
    const s = p.summary;
    const hours = (n: number) => (n / 60).toFixed(1);
    return <div className="stack"><Link href="/site-plans">Site Plans</Link><header><h1>{p.business_id} · {p.project.name}</h1><p>{p.project.site_address}</p>{p.visits.map(v=><p key={v.id}>{v.planned_start} – {v.planned_end} · <Link href={`/installations/${v.id}`}>Team and punch records</Link></p>)}<p role="status">{PLAN_LABELS[p.operations_state]}</p></header>
 <ol className="plan-lifecycle" aria-label="Plan lifecycle">{Object.entries(PLAN_LABELS).map(([key, label]) => <li key={key} aria-current={key === p.operations_state ? 'step' : undefined}>{label}</li>)}</ol>
 <section className="plate"><h2>Next action</h2>
 {p.operations_state === 'draft' && p.canManage ? <PlanTransition id={id} action="submit" label="Submit for approval"/> : p.operations_state === 'pending_approval' && p.canReview ? <><PlanTransition id={id} action="approve" label="Approve team and budget"/><details><summary>More</summary><PlanTransition id={id} action="reject" label="Return to manager"/></details></> : p.operations_state === 'active' && p.canManage ? <PlanTransition id={id} action="complete" label="Mark installation work complete"/> : p.operations_state === 'completed' && p.canManage ? <PlanTransition id={id} action="confirm_hours" label="Confirm punch-derived man-hours"/> : <p>{p.operations_state === 'hours_confirmed' ? 'Hours confirmed.' : p.operations_state === 'pending_approval' ? `Waiting for ${p.operations_policy.planApprover.replaceAll('_', ' ')}.` : 'Your manager owns the next action.'}</p>}
 </section>
 <section className="plate"><h2>Man-hours and budget</h2><div className="table-wrap"><table><thead><tr><th>Measure</th><th>Hours</th><th>Labour cost (₹)</th></tr></thead><tbody><tr><td>Original plan</td><td>{hours(s.baselineMinutes)}</td><td>—</td></tr><tr><td>Plan after approved exclusions</td><td>{hours(s.plannedMinutes)}</td><td>{s.plannedCost}</td></tr><tr><td>Actual site punches</td><td>{hours(s.actualMinutes)}</td><td>{s.actualCost}</td></tr><tr><td>Budget</td><td>{hours(s.budgetMinutes)}</td><td>{s.budgetCost}</td></tr><tr><td>Actual − planned</td><td>{hours(s.varianceMinutes)}</td><td>—</td></tr><tr><td>Actual − budget</td><td>{hours(s.budgetVarianceMinutes)}</td><td>—</td></tr></tbody></table></div><p>Unresolved punches: {s.openPunches}. Correct missing or incorrect punches in Team & Attendance before confirming hours.</p>{p.operations_state === 'draft' && p.canManage && <PlanBudget id={id}/>}</section>
 <section className="plate"><h2>Assigned staff</h2><ul>{p.people.map(e => <li key={e.employee_id}>{e.name}</li>)}</ul><Link href="/my-day">Open today’s site check-in</Link></section>
 {p.complaint_id && <Link href={`/dispatch/complaints/${p.complaint_id}`}>Complaint journey</Link>}
 <section className="plate"><h2>Regularization</h2>{p.operations_state === 'active' && p.canManage && <Regularize id={id} people={p.people}/>}<ul>{p.regularizations.map(r => <li key={r.id}><strong>{r.day} · {r.employee_id ? p.people.find(e => e.employee_id === r.employee_id)?.name : 'Whole team'} · {r.state}</strong><p>{r.reason}{r.decision_note ? ` · ${r.decision_note}` : ''}</p>{r.state === 'pending' && p.canRegularizeReview && r.requested_by !== actor.id && <RegularizationDecision id={r.id}/>}</li>)}</ul></section>
 <details><summary>History</summary><ol>{p.history.map((h, i) => <li key={i}>{when(h.at)} · {h.action.replaceAll('_', ' ')}{h.reason ? ` · ${h.reason}` : ''}</li>)}</ol></details></div>;
}
