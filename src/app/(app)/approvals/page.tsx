import Link from "next/link";
import { session } from "@/server/session";
import { approvalQueues } from "@/server/queries/time";
import { formatMoney, hours, when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, Notice, PageHeader } from "@/components/ui/Notice";
import { ActionButton } from "@/components/ui/ActionButton";
import { approveExpense, reviewTimeEntry } from "../../actions";
import { EligibilityReview, ReturnWithNote } from "@/components/approvals/ReviewForms";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const { db, actor } = await session();
  if (actor.role === "employee") return <Notice tone="warn" title="Not permitted">Approvals are for supervisors, managers and administrators.</Notice>;
  const q = await approvalQueues(db, actor);
  const planVisits = q.plans.length ? await db.query<{ plan_id: string; id: string }>("select distinct on (plan_id) plan_id, id from visit where plan_id = any($1::uuid[]) order by plan_id, sequence desc", [q.plans.map((p) => p.plan_id)]) : [];
  const visitIds = [...new Set(q.overtime.map((o) => o.visit_id).filter((v): v is string => !!v))];
  const additional = visitIds.length ? await db.query<{ id: string; visit_id: string; label: string; created_at: number }>(
    `select vt.id, vt.visit_id, t.business_id || ' · ' || c.name || ' · ' || vt.scoped_quantity::float || ' ' || t.unit label, vt.created_at
     from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id where vt.kind = 'additional' and vt.visit_id = any($1::uuid[])`, [visitIds]) : [];
  const isManager = actor.role === "manager" || actor.role === "admin";
  return (
    <>
      <PageHeader title="Approvals" subtitle="Inspect the record, its reasons and evidence before deciding. Nobody approves their own submission; success is shown only after the server confirms." />
      <section className="card stack" id="plans" aria-labelledby="h-pl">
        <h2 id="h-pl">Plan revisions ({q.plans.length})</h2>
        {q.plans.length === 0 ? <Empty>No plans awaiting review.</Empty> : (
          <div className="table-wrap"><table className="rows-mobile">
            <thead><tr><th>Plan</th><th>Project</th><th>Revision</th><th>Submitted</th><th>Change reason</th><th>Review</th></tr></thead>
            <tbody>{q.plans.map((p) => {
              const v = planVisits.find((x) => x.plan_id === p.plan_id);
              return (
                <tr key={p.plan_id}><td data-label="Plan">{p.plan}</td><td data-label="Project"><Link href={`/projects/${p.project_id}`}>{p.project}</Link></td><td data-label="Revision">r{p.revision_no}</td><td data-label="Submitted">{p.submitted_by}<div className="small muted">{when(p.submitted_at)}</div></td>
                  <td data-label="Change reason" className="small">{p.change_reason ?? "None given"}</td>
                  <td data-label="Review">{p.submitted_by_id === actor.id ? <span className="small muted">Your submission; another manager reviews it</span> : isManager ? <Link className="button" href={`/visits/${v?.id}?step=review`}>Open plan, compare revisions</Link> : <span className="small muted">Manager review</span>}</td></tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>

      <section className="card stack" id="time" aria-labelledby="h-tm">
        <h2 id="h-tm">Time entries ({q.time.length})</h2>
        {q.time.length === 0 ? <Empty>No submitted time awaiting review.</Empty> : (
          <div className="table-wrap"><table className="rows-mobile">
            <thead><tr><th>Employee</th><th>Activity</th><th>From</th><th>To</th><th className="num">Gross</th><th>Notes</th><th>Decision</th></tr></thead>
            <tbody>{q.time.map((t) => (
              <tr key={t.id}>
                <td data-label="Employee"><Link href={`/timesheets?employee=${t.employee_id}`}>{t.employee}</Link></td><td data-label="Activity">{t.activity}<div className="small muted">{t.project ?? ""}</div></td>
                <td data-label="From">{when(t.start)}</td><td data-label="To">{when(t.end)}</td><td data-label="Gross" className="num">{hours((t.end - t.start) / 60000)}</td>
                <td data-label="Notes" className="small">{t.is_exception && <Badge state="pending" label="No booking: exception" />} {t.exception_note ?? t.note ?? ""}</td>
                <td data-label="Decision">{t.employee_id === actor.id ? <span className="small muted">Your own entry</span> : (
                  <div className="row"><ActionButton action={reviewTimeEntry} input={{ entryId: t.id, decision: "accepted" }} label="Accept" tone="primary" successText="Accepted." /><ReturnWithNote entryId={t.id} /></div>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="small muted">Accepting an unbooked exception also resolves it. Returned entries keep their history; the employee corrects them with a new revision.</p>
      </section>

      <section className="card stack" id="overtime" aria-labelledby="h-ot">
        <h2 id="h-ot">Overtime eligibility ({q.overtime.length})</h2>
        <Notice>Verify the facts; the rule is applied by the system. Extra time verified as finishing the original assigned target is ineligible for internal overtime, and no button bypasses that. Authorized additional scope needs a dated approval recorded before the work.</Notice>
        {q.overtime.length === 0 ? <Empty>No overtime requests awaiting review.</Empty> : q.overtime.map((o) => (
          <EligibilityReview key={o.id} request={{ id: o.id, employee: o.employee, own: o.employee_id === actor.id, from: when(o.start), to: when(o.end), minutes: Math.round((o.end - o.start) / 60000), claimed: o.claimed_reason, entryState: o.entry_state, activity: o.activity }}
            authorizations={additional.filter((a) => a.visit_id === o.visit_id && a.created_at <= o.start).map((a) => ({ id: a.id, label: `${a.label} (approved ${when(a.created_at)})` }))} />
        ))}
      </section>

      <section className="card stack" id="expenses" aria-labelledby="h-ex">
        <h2 id="h-ex">Expenses ({q.expenses.length})</h2>
        {q.expenses.length === 0 ? <Empty>No expenses awaiting approval.</Empty> : (
          <div className="table-wrap"><table className="rows-mobile">
            <thead><tr><th>Expense</th><th>Claimant</th><th>Project</th><th>Category</th><th>Date</th><th className="num">Amount</th><th>Decision</th></tr></thead>
            <tbody>{q.expenses.map((x) => (
              <tr key={x.id}><td data-label="Expense">{x.business_id}{x.is_credit && <div className="small">Credit</div>}{x.receipt_ref && <div className="small muted">{x.receipt_ref}</div>}</td><td data-label="Claimant">{x.claimant}</td><td data-label="Project">{x.project}</td><td data-label="Category">{x.category.replace(/_/g, " ")}</td><td data-label="Date">{x.incurred_on}</td>
                <td data-label="Amount" className="num">{formatMoney(x.amount_minor, x.currency)}</td>
                <td data-label="Decision">{!isManager ? <span className="small muted">Manager approval</span> : x.claimant_id === actor.id ? <span className="small muted">Your own claim</span> : (
                  <div className="row"><ActionButton action={approveExpense} input={{ expenseId: x.id, decision: "approved" }} label="Approve" tone="primary" successText="Approved." />
                    <ActionButton action={approveExpense} input={{ expenseId: x.id, decision: "rejected", note: "Rejected from approvals queue: receipt or scope not verified" }} label="Reject" tone="danger" confirm="Reject this expense? The claimant sees the reason." /></div>
                )}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
