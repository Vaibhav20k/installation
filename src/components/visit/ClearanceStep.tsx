"use client";
import { grantClearanceException, revokeClearanceException, setClearance, setReadinessCheck } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { when } from "@/lib/format";

interface Clr { id: string; gate: string; status: string; approver: string | null; decided_at: number | null; expected_date: string | null; valid_until: string | null; evidence: string | null; version: number }
interface Ex { id: string; gate: string; reason: string; conditions: string; approved_by: string; valid_until: string; revoked: boolean }
interface Ready { check_code: string; required: boolean; result: string; na_reason: string | null; evidence: string | null; verifier: string | null; valid_until: string | null }

export function ClearanceStep({ visitId, clearances, exceptions, readiness, gate, readinessGate }: {
  visitId: string; clearances: Clr[]; exceptions: Ex[]; readiness: Ready[]; gate: { ok: boolean; blockers: string[]; exceptions: string[] }; readinessGate: { ok: boolean; blockers: string[] };
}) {
  const clr = useAction(setClearance);
  const exc = useAction(grantClearanceException);
  const rdy = useAction(setReadinessCheck);
  return (
    <div className="stack">
      <Notice tone={gate.ok ? "ok" : "warn"} title={gate.ok ? "Firm booking is allowed by clearance" : "Firm booking and deployment are blocked"} items={[...gate.blockers, ...gate.exceptions]} />
      <p className="small muted">Accounts clearance, site readiness, installation approval, dispatch and skill coverage are separate. Drafts and holds can proceed before clearance; firm booking and departure re-check validity and exception conditions.</p>
      <div className="grid cols-2">
        <section className="card stack" aria-labelledby="h-gates">
          <h2 id="h-gates">Clearance gates</h2>
          {clearances.map((c) => (
            <form key={c.id} className="form" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12 }} onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              clr.run({ visitId, gate: c.gate, version: c.version, status: String(f.get("status")), evidence: String(f.get("evidence") || "") || undefined,
                validUntil: f.get("validUntil") ? String(f.get("validUntil")) : null, expectedDate: f.get("expectedDate") ? String(f.get("expectedDate")) : null });
            }}>
              <div className="spread"><h3 style={{ margin: 0, textTransform: "capitalize" }}>{c.gate}</h3><Badge state={c.status} /></div>
              <p className="small muted">{c.approver ? `Decided by ${c.approver}, ${when(c.decided_at)}` : "No decision yet"}{c.valid_until ? ` · valid until ${c.valid_until}` : ""}{c.evidence ? ` · ${c.evidence}` : ""}</p>
              <div className="fields">
                <div className="field"><label htmlFor={`st-${c.id}`}>Status</label><select id={`st-${c.id}`} name="status" defaultValue={c.status}>{["pending", "cleared", "rejected", "expired", "revoked"].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
                <div className="field"><label htmlFor={`ex-${c.id}`}>Expected date</label><input id={`ex-${c.id}`} type="date" name="expectedDate" defaultValue={c.expected_date ?? ""} /></div>
                <div className="field"><label htmlFor={`vu-${c.id}`}>Valid until</label><input id={`vu-${c.id}`} type="date" name="validUntil" defaultValue={c.valid_until ?? ""} /></div>
              </div>
              <div className="field"><label htmlFor={`ev-${c.id}`}>Evidence (required to clear)</label><input id={`ev-${c.id}`} name="evidence" defaultValue={c.evidence ?? ""} /></div>
              <div className="row"><button type="submit" disabled={clr.pending}>Save {c.gate}</button><span className="small muted">{c.gate === "accounts" ? "Needs the accounts-clearance capability." : "Needs manager permission."}</span></div>
            </form>
          ))}
          <ResultNotice result={clr.result} successText="Clearance saved. Existing bookings are flagged for review if it was revoked or expired." />
        </section>
        <section className="card stack" aria-labelledby="h-exc">
          <h2 id="h-exc">Audited exceptions</h2>
          <p className="small muted">Only configured gates (demo: accounts) accept exceptions. An exception cannot bypass authorization, invalid scope, overlapping capacity or missing verified skills, and the plan&apos;s creator cannot grant it.</p>
          {exceptions.map((x) => (
            <div key={x.id} className="notice" data-tone={x.revoked ? "info" : "warn"}>
              <strong>{x.gate}</strong> exception by {x.approved_by}, valid until {x.valid_until} {x.revoked && <Badge state="revoked" />}<br />{x.reason}. Conditions: {x.conditions}
              {!x.revoked && <div style={{ marginTop: 8 }}><ActionButton action={revokeClearanceException} input={{ exceptionId: x.id, reason: "Revoked from visit page" }} label="Revoke exception" tone="danger" confirm="Bookings that rely on this exception will be flagged for review." /></div>}
            </div>
          ))}
          <form className="form" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            exc.run({ visitId, gate: "accounts", reason: String(f.get("reason")), conditions: String(f.get("conditions")), validUntil: String(f.get("validUntil")) });
          }}>
            <div className="field"><label htmlFor="x-r">Reason (accounts gate)</label><input id="x-r" name="reason" required minLength={5} /></div>
            <div className="field"><label htmlFor="x-c">Conditions</label><input id="x-c" name="conditions" required minLength={3} /></div>
            <div className="field"><label htmlFor="x-v">Valid until</label><input id="x-v" type="date" name="validUntil" required /></div>
            <button type="submit" disabled={exc.pending}>Record exception</button>
            <ResultNotice result={exc.result} successText="Exception recorded." />
          </form>
        </section>
      </div>
      <section className="card stack" aria-labelledby="h-ready">
        <h2 id="h-ready">Readiness checklist</h2>
        <Notice tone={readinessGate.ok ? "ok" : "warn"} title={readinessGate.ok ? "All required checks pass" : "Deployment is blocked by readiness"} items={readinessGate.blockers} />
        <div className="table-wrap"><table>
          <thead><tr><th>Check</th><th>Required</th><th>Result</th><th>Verifier / evidence</th><th>Update</th></tr></thead>
          <tbody>{readiness.map((r) => (
            <tr key={r.check_code}>
              <td>{r.check_code.replace(/_/g, " ")}</td><td>{r.required ? "Required" : "Optional"}</td>
              <td><Badge state={r.result} />{r.na_reason && <div className="small muted">N/A: {r.na_reason}</div>}</td>
              <td className="small">{r.verifier ?? "—"}{r.evidence ? ` · ${r.evidence}` : ""}</td>
              <td>
                <form className="row" onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  rdy.run({ visitId, checkCode: r.check_code, result: String(f.get("result")), evidence: String(f.get("evidence") || "") || undefined, naReason: String(f.get("evidence") || "") || undefined });
                }}>
                  <label className="sr-only" htmlFor={`rr-${r.check_code}`}>Result for {r.check_code}</label>
                  <select id={`rr-${r.check_code}`} name="result" defaultValue={r.result} style={{ width: "auto" }}><option value="pending">Pending</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="na">Not applicable</option></select>
                  <label className="sr-only" htmlFor={`re-${r.check_code}`}>Evidence or N/A reason</label>
                  <input id={`re-${r.check_code}`} name="evidence" placeholder="Evidence / N/A reason" style={{ width: 180 }} />
                  <button type="submit" disabled={rdy.pending}>Save</button>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        <ResultNotice result={rdy.result} successText="Check saved." />
        <p className="small muted">Skill coverage passes only when current staffing actually meets the requirements; it cannot be declared.</p>
      </section>
    </div>
  );
}
