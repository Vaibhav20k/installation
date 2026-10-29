import Link from "next/link";
import type { ReactNode } from "react";
import { session } from "@/server/session";
import { formatMoney, hours, when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Notice, PageHeader } from "@/components/ui/Notice";
import { ActionButton } from "@/components/ui/ActionButton";
import { approveExpense, decideAttendanceCorrection, decideLeave, reviewTimeEntry } from "../../actions";
import { EligibilityReview, ReturnWithNote } from "@/components/approvals/ReviewForms";
import { evidenceFor } from "@/server/services/evidence";
import { EvidenceGallery } from "@/components/evidence/EvidenceGallery";
import { shortDate } from "@/domain/install-schedule";
import { DecideAdditionalWork } from "@/components/project/CommercialForms";
import { loadApprovals } from "@/components/approvals/waiting";
import { Queue, QuietQueues, WaitingStrip, sortQueues } from "@/components/approvals/Queue";

export const metadata = { title: "Approvals" };

/** Stable partition: rows the viewer can decide first, keeping the oldest-first order inside each group. */
const decidableFirst = <T,>(rows: T[], mine: (r: T) => boolean) => [...rows.filter(mine), ...rows.filter((r) => !mine(r))];

export default async function ApprovalsPage() {
  const { db, actor } = await session();
  if (actor.role === "employee") return <Notice tone="warn" title="Not permitted">Approvals are for supervisors, managers and administrators.</Notice>;
  const { q, att, extra, isManager, queues } = await loadApprovals(db, actor, Date.now());
  const planVisits = q.plans.length ? await db.query<{ plan_id: string; id: string }>("select distinct on (plan_id) plan_id, id from visit where plan_id = any($1::uuid[]) order by plan_id, sequence desc", [q.plans.map((p) => p.plan_id)]) : [];
  const visitIds = [...new Set(q.overtime.map((o) => o.visit_id).filter((v): v is string => !!v))];
  const approvedWork = visitIds.length ? await db.query<{ id: string; visit_id: string; label: string; created_at: number }>(
    `select aw.id, v.id visit_id, aw.business_id || ' · ' || aw.description label, aw.decided_at created_at from additional_work aw join visit v on v.project_id = aw.project_id
     where v.id = any($1::uuid[]) and aw.status = 'approved' and (aw.visit_id is null or aw.visit_id = v.id)`, [visitIds]) : [];
  const additional = visitIds.length ? await db.query<{ id: string; visit_id: string; label: string; created_at: number }>(
    `select vt.id, vt.visit_id, t.business_id || ' · ' || c.name || ' · ' || vt.scoped_quantity::float || ' ' || t.unit label, vt.created_at
     from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id where vt.kind = 'additional' and vt.visit_id = any($1::uuid[])`, [visitIds]) : [];
  const extraEvidence = await Promise.all(extra.map((w) => evidenceFor(db, actor, "additional_work", w.id).catch(() => [])));
  const corrEvidence = await Promise.all(att.corrections.map((c) => evidenceFor(db, actor, "attendance_correction", c.id).catch(() => [])));
  const leaveEvidence = await Promise.all(att.leave.map((l) => evidenceFor(db, actor, "leave_request", l.id).catch(() => [])));

  const plans = decidableFirst(q.plans, (p) => isManager && p.submitted_by_id !== actor.id);
  const time = decidableFirst(q.time, (t) => t.employee_id !== actor.id);
  const overtime = decidableFirst(q.overtime, (o) => o.employee_id !== actor.id);
  const expenses = decidableFirst(q.expenses, (x) => isManager && x.claimant_id !== actor.id);
  const leave = decidableFirst(att.leave.map((l, i) => ({ l, ev: leaveEvidence[i] ?? [] })), ({ l }) => l.employee_id !== actor.id);

  const body: Record<string, ReactNode> = {
    plans: (
      <div className="table-wrap"><table className="rows-mobile">
        <thead><tr><th>Plan</th><th>Project</th><th>Revision</th><th>Sent by</th><th>Why it changed</th><th>Review</th></tr></thead>
        <tbody>{plans.map((p) => {
          const v = planVisits.find((x) => x.plan_id === p.plan_id);
          return (
            <tr key={p.plan_id}><td data-label="Plan">{p.plan}</td><td data-label="Project"><Link href={`/projects/${p.project_id}`}>{p.project}</Link></td><td data-label="Revision">r{p.revision_no}</td><td data-label="Sent by">{p.submitted_by}<div className="small muted">{when(p.submitted_at)}</div></td>
              <td data-label="Why it changed" className="small">{p.change_reason ?? "None given"}</td>
              <td data-label="Review">{p.submitted_by_id === actor.id ? <span className="small muted">Your plan; another manager reviews it</span> : isManager ? <Link className="button" href={`/visits/${v?.id}?step=review`}>Open and compare</Link> : <span className="small muted">Manager review</span>}</td></tr>
          );
        })}</tbody>
      </table></div>
    ),
    time: (
      <>
        {(q.time[0]?.waiting ?? 0) > q.time.length && <p className="small muted" role="status" style={{ margin: 0 }}>Showing the oldest {q.time.length} of {q.time[0]!.waiting}. Decide these and the rest appear here.</p>}
        <div className="table-wrap"><table className="rows-mobile">
          <thead><tr><th>Employee</th><th>Work</th><th>From</th><th>To</th><th className="num">Hours</th><th>Notes</th><th>Decision</th></tr></thead>
          <tbody>{time.map((t) => (
            <tr key={t.id}>
              <td data-label="Employee"><Link href={`/timesheets?employee=${t.employee_id}`}>{t.employee}</Link></td><td data-label="Work">{t.activity}<div className="small muted">{t.project ?? ""}</div></td>
              <td data-label="From">{when(t.start)}</td><td data-label="To">{when(t.end)}</td><td data-label="Hours" className="num">{hours((t.end - t.start) / 60000)}</td>
              <td data-label="Notes" className="small">{t.is_exception && <Badge state="pending" label="Not booked" />} {t.exception_note ?? t.note ?? ""}</td>
              <td data-label="Decision">{t.employee_id === actor.id ? <span className="small muted">Your own entry</span> : (
                <div className="row"><ActionButton action={reviewTimeEntry} input={{ entryId: t.id, decision: "accepted" }} label="Accept" tone="primary" successText="Accepted." /><ReturnWithNote entryId={t.id} /></div>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="small muted" style={{ margin: 0 }}>Accepting a not-booked entry also clears the exception. Sent-back entries keep their history; the worker fixes them with a new revision.</p>
      </>
    ),
    overtime: overtime.map((o) => (
      <EligibilityReview key={o.id} request={{ id: o.id, employee: o.employee, own: o.employee_id === actor.id, from: when(o.start), to: when(o.end), minutes: Math.round((o.end - o.start) / 60000), claimed: o.claimed_reason, entryState: o.entry_state, activity: o.activity }}
        authorizations={[...additional, ...approvedWork].filter((a) => a.visit_id === o.visit_id && a.created_at <= o.start).map((a) => ({ id: a.id, label: `${a.label} (approved ${when(a.created_at)})` }))} />
    )),
    attendance: (
      <ul className="req-list">
        {att.corrections.map((c, i) => (
          <li key={c.id}><span className="code-tag">CORRECTION</span>
            <span><strong>{c.employee}: {c.field === "clock_in" ? "clock-in" : "clock-out"} on {shortDate(c.work_date)} should be {when(c.requested_at)}</strong>
              <span className="small muted" style={{ display: "block" }}>Recorded clock-in {when(c.t0)} · {c.reason}</span>
              <EvidenceGallery items={corrEvidence[i] ?? []} title="Worker's evidence" /></span>
            <span className="row"><ActionButton action={decideAttendanceCorrection} input={{ correctionId: c.id, decision: "approved" }} label="Approve" tone="primary" successText="Approved; the shift was recalculated." />
              <ActionButton action={decideAttendanceCorrection} input={{ correctionId: c.id, decision: "rejected", note: "Not supported by the record" }} label="Reject" tone="danger" confirm="Reject this correction? The recorded punches stay." /></span></li>
        ))}
        {leave.map(({ l, ev }) => (
          <li key={l.id}><span className="code-tag">{l.kind === "leave" ? "LEAVE" : "UNAVAILABLE"}</span>
            <span><strong>{l.employee}: {shortDate(l.start_date)}{l.end_date !== l.start_date ? ` to ${shortDate(l.end_date)}` : ""}</strong><span className="small muted" style={{ display: "block" }}>{l.reason}</span>
              <EvidenceGallery items={ev} title="Private attachments" /></span>
            {l.employee_id === actor.id ? <span className="small muted">Your own request</span> : (
              <span className="row"><ActionButton action={decideLeave} input={{ requestId: l.id, decision: "approved" }} label="Approve" tone="primary" successText="Approved; planning now sees the unavailability." />
                <ActionButton action={decideLeave} input={{ requestId: l.id, decision: "rejected", note: "Not approved" }} label="Reject" tone="danger" confirm="Reject this request?" /></span>
            )}</li>
        ))}
        {att.missed.map((m) => (
          <li key={m.id}><span className="code-tag">NO CLOCK-OUT</span><span><strong>{m.employee} · {shortDate(m.work_date)}</strong><span className="small muted" style={{ display: "block" }}>{m.auto_closed
            ? <>Clocked in {when(m.t0)}{m.auto_closed_at ? `; closed by the system ${when(m.auto_closed_at)}` : ""}. Not clocked out — ask the worker for the real time.</>
            : <>Clocked in {when(m.t0)}. Stays provisional until the worker asks for the real clock-out time and you approve it.</>}</span></span>
            {m.auto_closed ? <Badge state="pending" tone="warn" label="Closed after 24 h" /> : <Badge state="fail" tone="bad" label="Exception" />}</li>
        ))}
      </ul>
    ),
    additional: (
      <ul className="req-list">
        {extra.map((w, i) => (
          <li key={w.id}><span className="code-tag">{w.business_id}</span>
            <span><strong>{w.description}</strong><span className="small muted" style={{ display: "block" }}>{w.project} · {w.order} · asked by {w.requested_by.replace("_", " ")} · {w.reason}{w.estimated_minutes ? ` · est. ${hours(w.estimated_minutes)}` : ""} · recorded by {w.by ?? "unknown"}</span>
              <EvidenceGallery items={extraEvidence[i] ?? []} title="Site evidence" />
              <details><summary className="small">Decide</summary><DecideAdditionalWork id={w.id} /></details></span>
            <Badge state="pending" label="Requested" /></li>
        ))}
      </ul>
    ),
    expenses: (
      <div className="table-wrap"><table className="rows-mobile">
        <thead><tr><th>Expense</th><th>Claimed by</th><th>Project</th><th>Type</th><th>Date</th><th className="num">Amount</th><th>Decision</th></tr></thead>
        <tbody>{expenses.map((x) => (
          <tr key={x.id}><td data-label="Expense">{x.business_id}{x.is_credit && <div className="small">Credit</div>}{x.receipt_ref && <div className="small muted">{x.receipt_ref}</div>}</td><td data-label="Claimed by">{x.claimant}</td><td data-label="Project">{x.project}</td><td data-label="Type">{x.category.replace(/_/g, " ")}</td><td data-label="Date">{x.incurred_on}</td>
            <td data-label="Amount" className="num">{formatMoney(x.amount_minor, x.currency)}</td>
            <td data-label="Decision">{!isManager ? <span className="small muted">Manager approval</span> : x.claimant_id === actor.id ? <span className="small muted">Your own claim</span> : (
              <div className="row"><ActionButton action={approveExpense} input={{ expenseId: x.id, decision: "approved" }} label="Approve" tone="primary" successText="Approved." />
                <ActionButton action={approveExpense} input={{ expenseId: x.id, decision: "rejected", note: "Rejected from approvals queue: receipt or scope not verified" }} label="Reject" tone="danger" confirm="Reject this expense? The claimant sees the reason." /></div>
            )}</td></tr>
        ))}</tbody>
      </table></div>
    ),
  };
  const notes: Record<string, ReactNode> = {
    overtime: <Notice>Check the facts; the system applies the rule. Extra time spent finishing the original job does not count as overtime, and no button changes that. Extra scope needs a dated approval recorded before the work.</Notice>,
    attendance: <p className="small muted" style={{ margin: 0 }}>A correction changes the shift only after you approve it; the original punches stay in history. A missing clock-out is never filled in automatically.</p>,
  };
  const ordered = sortQueues(queues);
  return (
    <div className="inbox-page">
      <PageHeader title="To approve" subtitle="Check the details and photos, then decide. Nobody approves their own items, and a decision shows as done only after the server confirms it." />
      <WaitingStrip queues={queues} />
      {ordered.filter((x) => x.items > 0).map((x) => <Queue key={x.id} q={x} note={notes[x.id]}>{body[x.id]}</Queue>)}
      <QuietQueues queues={ordered.filter((x) => x.items === 0)} />
    </div>
  );
}
