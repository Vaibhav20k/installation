"use client";
import { approvePlan, cancelPlan, createPlanRevision, returnPlan, submitPlan } from "@/app/actions";
import { ActionButton } from "@/components/ui/ActionButton";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { hours, when } from "@/lib/format";

interface Rev { id: string; revision_no: number; approval_state: string; change_reason: string | null; created_at: number; created_by: string | null; decided_by: string | null; decision_note: string | null; is_baseline: boolean; is_current: boolean }

export function ReviewStep({ planId, revisions, scopeCount, staffCount, hasDates, estimate, coverage, gate, role }: {
  planId: string; revisions: Rev[]; scopeCount: number; staffCount: number; hasDates: boolean; estimate: { totalPersonMinutes: string; provisional: boolean; complete: boolean };
  coverage: { met: boolean; problems: string[] }; gate: { ok: boolean; blockers: string[] }; role: string;
}) {
  const latest = revisions[0]!;
  const ret = useAction(returnPlan);
  const rev = useAction(createPlanRevision);
  const checks = [
    { ok: scopeCount > 0, text: `Scope: ${scopeCount} task line(s)` },
    { ok: hasDates, text: hasDates ? "Planned dates set" : "Planned dates missing" },
    { ok: estimate.complete, text: `Effort: ${hours(Number(estimate.totalPersonMinutes))}${estimate.provisional ? " (provisional rates)" : ""}` },
    { ok: coverage.met, text: coverage.met ? `Team of ${staffCount} meets requirements` : `Staffing: ${coverage.problems.join("; ") || "not selected"}` },
    { ok: gate.ok, text: gate.ok ? "Clearances complete" : `Clearance: ${gate.blockers.join("; ")} (needed for firm booking, not for submission)` },
  ];
  return (
    <div className="grid cols-2">
      <section className="card stack" aria-labelledby="h-rev">
        <h2 id="h-rev">Review revision {latest.revision_no}</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="stack">{checks.map((c) => <li key={c.text}><Badge state={c.ok ? "pass" : "pending"} label={c.ok ? "OK" : "Check"} /> {c.text}</li>)}</ul>
        {latest.approval_state === "draft" && <ActionButton action={submitPlan} input={{ planId }} label="Submit for approval" tone="primary" successText="Submitted. A manager other than you must review it." />}
        {latest.approval_state === "submitted" && role !== "employee" && role !== "supervisor" && (
          <div className="stack">
            <ActionButton action={approvePlan} input={{ planId }} label="Approve revision" tone="primary" confirm="Approving makes this revision immutable. If it is the first approval it becomes the baseline." successText="Approved." />
            <form className="form" onSubmit={(e) => { e.preventDefault(); ret.run({ planId, note: String(new FormData(e.currentTarget).get("note")) }); }}>
              <div className="field"><label htmlFor="rv-note">Return with comments</label><textarea id="rv-note" name="note" required /></div>
              <button type="submit" disabled={ret.pending}>Return for changes</button>
              <ResultNotice result={ret.result} successText="Returned. The submitter starts a new draft revision." />
            </form>
          </div>
        )}
        {latest.approval_state === "submitted" && role === "supervisor" && <Notice>Awaiting a manager&apos;s decision.</Notice>}
        {["approved", "returned"].includes(latest.approval_state) && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); rev.run({ planId, changeReason: String(new FormData(e.currentTarget).get("reason")) }); }}>
            <div className="field"><label htmlFor="rv-r">Start revision {latest.revision_no + 1}: change reason</label><input id="rv-r" name="reason" required minLength={3} /></div>
            <button type="submit" disabled={rev.pending}>Start new revision</button>
            <ResultNotice result={rev.result} successText="New draft revision started; the approved baseline is unchanged." />
          </form>
        )}
        {role !== "employee" && role !== "supervisor" && (
          <ActionButton action={cancelPlan} input={{ planId, reason: "Cancelled from review step" }} label="Cancel plan" tone="danger" confirm="Cancelling releases all future reservations of this plan in one transaction. Started visits block cancellation." successText="Plan cancelled; future capacity released." />
        )}
      </section>
      <section className="card" aria-labelledby="h-hist">
        <h2 id="h-hist">Revision history</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Rev.</th><th>State</th><th>Reason</th><th>Created</th><th>Decision</th></tr></thead>
          <tbody>{revisions.map((r) => (
            <tr key={r.id}>
              <td>{r.revision_no}{r.is_baseline && <div><Badge state="final" label="Baseline" /></div>}{r.is_current && <div><Badge state="approved" label="Current" /></div>}</td>
              <td><Badge state={r.approval_state} /></td><td className="small">{r.change_reason ?? "—"}</td>
              <td className="small">{r.created_by ?? "—"}<br />{when(r.created_at)}</td>
              <td className="small">{r.decided_by ? `${r.decided_by}${r.decision_note ? `: ${r.decision_note}` : ""}` : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="small muted">Approved revisions never change. Actuals are compared with both the baseline and the current approved revision.</p>
      </section>
    </div>
  );
}
