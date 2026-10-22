import Link from "next/link";
import { session } from "@/server/session";
import { approvalQueues } from "@/server/queries/time";
import { formatMoney, hours, when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, Notice, PageHeader } from "@/components/ui/Notice";
import { ActionButton } from "@/components/ui/ActionButton";
import { approveExpense, reviewTimeEntry } from "../../actions";
import { EligibilityReview, ReturnWithNote } from "@/components/approvals/ReviewForms";
import { attendanceExceptions } from "@/server/queries/attendance";
import { evidenceFor } from "@/server/services/evidence";
import { EvidenceGallery } from "@/components/evidence/EvidenceGallery";
import { decideAttendanceCorrection, decideLeave } from "../../actions";
import { shortDate } from "@/domain/install-schedule";
import { pendingAdditionalWork } from "@/server/services/commercial";
import { DecideAdditionalWork } from "@/components/project/CommercialForms";
import { hours as hrs } from "@/lib/format";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const { db, actor } = await session();
  if (actor.role === "employee") return <Notice tone="warn" title="Not permitted">Approvals are for supervisors, managers and administrators.</Notice>;
  const q = await approvalQueues(db, actor);
  const planVisits = q.plans.length ? await db.query<{ plan_id: string; id: string }>("select distinct on (plan_id) plan_id, id from visit where plan_id = any($1::uuid[]) order by plan_id, sequence desc", [q.plans.map((p) => p.plan_id)]) : [];
  const visitIds = [...new Set(q.overtime.map((o) => o.visit_id).filter((v): v is string => !!v))];
  const approvedWork = visitIds.length ? await db.query<{ id: string; visit_id: string; label: string; created_at: number }>(
    `select aw.id, v.id visit_id, aw.business_id || ' · ' || aw.description label, aw.decided_at created_at from additional_work aw join visit v on v.project_id = aw.project_id
     where v.id = any($1::uuid[]) and aw.status = 'approved' and (aw.visit_id is null or aw.visit_id = v.id)`, [visitIds]) : [];
  const additional = visitIds.length ? await db.query<{ id: string; visit_id: string; label: string; created_at: number }>(
    `select vt.id, vt.visit_id, t.business_id || ' · ' || c.name || ' · ' || vt.scoped_quantity::float || ' ' || t.unit label, vt.created_at
     from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id where vt.kind = 'additional' and vt.visit_id = any($1::uuid[])`, [visitIds]) : [];
  const isManager = actor.role === "manager" || actor.role === "admin";
  const att = await attendanceExceptions(db, actor, Date.now());
  const extra = await pendingAdditionalWork(db, actor);
  const extraEvidence = await Promise.all(extra.map((w) => evidenceFor(db, actor, "additional_work", w.id).catch(() => [])));
  const corrEvidence = await Promise.all(att.corrections.map((c) => evidenceFor(db, actor, "attendance_correction", c.id).catch(() => [])));
  const leaveEvidence = await Promise.all(att.leave.map((l) => evidenceFor(db, actor, "leave_request", l.id).catch(() => [])));
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
            authorizations={[...additional, ...approvedWork].filter((a) => a.visit_id === o.visit_id && a.created_at <= o.start).map((a) => ({ id: a.id, label: `${a.label} (approved ${when(a.created_at)})` }))} />
        ))}
      </section>

      <section className="card stack" id="attendance" aria-labelledby="h-at">
        <h2 id="h-at">Attendance ({att.corrections.length + att.missed.length + att.leave.length})</h2>
        <p className="small muted" style={{ margin: 0 }}>Corrections change the shift anchor or end only after approval; the original punches stay in history. A missing clock-out is never filled in automatically.</p>
        {att.corrections.length + att.missed.length + att.leave.length === 0 ? <Empty>No attendance items waiting.</Empty> : (
          <ul className="req-list">
            {att.corrections.map((c, i) => (
              <li key={c.id}><span className="code-tag">CORRECTION</span>
                <span><strong>{c.employee}: {c.field === "clock_in" ? "clock-in" : "clock-out"} on {shortDate(c.work_date)} should be {when(c.requested_at)}</strong>
                  <span className="small muted" style={{ display: "block" }}>Recorded clock-in {when(c.t0)} · {c.reason}</span>
                  <EvidenceGallery items={corrEvidence[i] ?? []} title="Worker's evidence" /></span>
                <span className="row"><ActionButton action={decideAttendanceCorrection} input={{ correctionId: c.id, decision: "approved" }} label="Approve" tone="primary" successText="Approved; the shift was recalculated." />
                  <ActionButton action={decideAttendanceCorrection} input={{ correctionId: c.id, decision: "rejected", note: "Not supported by the record" }} label="Reject" tone="danger" confirm="Reject this correction? The recorded punches stay." /></span></li>
            ))}
            {att.missed.map((m) => (
              <li key={m.id}><span className="code-tag">NO CLOCK-OUT</span><span><strong>{m.employee} · {shortDate(m.work_date)}</strong><span className="small muted" style={{ display: "block" }}>Clocked in {when(m.t0)}. Provisional until the worker requests the real clock-out time and you approve it.</span></span><Badge state="fail" tone="bad" label="Exception" /></li>
            ))}
            {att.leave.map((l, i) => (
              <li key={l.id}><span className="code-tag">{l.kind === "leave" ? "LEAVE" : "UNAVAILABLE"}</span>
                <span><strong>{l.employee}: {shortDate(l.start_date)}{l.end_date !== l.start_date ? ` to ${shortDate(l.end_date)}` : ""}</strong><span className="small muted" style={{ display: "block" }}>{l.reason}</span>
                  <EvidenceGallery items={leaveEvidence[i] ?? []} title="Private attachments" /></span>
                <span className="row"><ActionButton action={decideLeave} input={{ requestId: l.id, decision: "approved" }} label="Approve" tone="primary" successText="Approved; planning now sees the unavailability." />
                  <ActionButton action={decideLeave} input={{ requestId: l.id, decision: "rejected", note: "Not approved" }} label="Reject" tone="danger" confirm="Reject this request?" /></span></li>
            ))}
          </ul>
        )}
      </section>

      {isManager && (
        <section className="card stack" id="additional" aria-labelledby="h-aw">
          <h2 id="h-aw">Additional work ({extra.length})</h2>
          {extra.length === 0 ? <Empty>No additional work waiting.</Empty> : (
            <ul className="req-list">
              {extra.map((w, i) => (
                <li key={w.id}><span className="code-tag">{w.business_id}</span>
                  <span><strong>{w.description}</strong><span className="small muted" style={{ display: "block" }}>{w.project} · {w.order} · asked by {w.requested_by.replace("_", " ")} · {w.reason}{w.estimated_minutes ? ` · est. ${hrs(w.estimated_minutes)}` : ""} · recorded by {w.by ?? "unknown"}</span>
                    <EvidenceGallery items={extraEvidence[i] ?? []} title="Site evidence" />
                    <details><summary className="small">Decide</summary><DecideAdditionalWork id={w.id} /></details></span>
                  <Badge state="pending" label="Requested" /></li>
              ))}
            </ul>
          )}
        </section>
      )}

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
