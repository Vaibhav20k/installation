"use client";
import { useState } from "react";
import { reviewEligibility, reviewTimeEntry } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { hours } from "@/lib/format";

export function ReturnWithNote({ entryId }: { entryId: string }) {
  const [open, setOpen] = useState(false);
  const { run, pending, result } = useAction(reviewTimeEntry);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>Return…</button>
      {open && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); run({ entryId, decision: "returned", note: String(new FormData(e.currentTarget).get("n")) }); }}>
          <label className="sr-only" htmlFor={`rn-${entryId}`}>What needs correcting</label>
          <input id={`rn-${entryId}`} name="n" placeholder="What needs correcting?" required style={{ width: 200 }} />
          <button type="submit" disabled={pending}>Return</button>
        </form>
      )}
      <ResultNotice result={result} successText="Returned to the employee." />
    </div>
  );
}

export function EligibilityReview({ request, authorizations }: {
  request: { id: string; employee: string; own: boolean; from: string; to: string; minutes: number; claimed: string; entryState: string; activity: string };
  authorizations: Array<{ id: string; label: string }>;
}) {
  const [reason, setReason] = useState("original_target_catch_up");
  const { run, pending, result } = useAction(reviewEligibility);
  const decision = result?.ok ? (result.data as { status: string; explanation: string; note?: string }) : null;
  return (
    <form className="card form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run({ requestId: request.id, verifiedReason: reason, authorizationRef: String(f.get("auth") || "") || undefined, futureTaskAuthorization: String(f.get("fta") || "") || undefined, note: String(f.get("note") || "") || undefined }); }}>
      <div className="spread"><strong>{request.employee}</strong><span className="small">{request.from} → {request.to} ({hours(request.minutes)}) · {request.activity} · entry {request.entryState}</span></div>
      <p className="small">Claimed reason: “{request.claimed}”</p>
      {request.own ? <p className="small muted">This is your own request; another reviewer must decide.</p> : (
        <>
          <fieldset>
            <legend>Verified reason</legend>
            {([
              ["original_target_catch_up", "Finishing the original assigned target (catch-up)"],
              ["authorized_additional_scope", "Approved additional scope"],
              ["authorized_future_task", "Authorised work brought forward from a future day"],
              ["external_delay", "Delay caused by materials, site, equipment or another function"],
              ["other_documented", "Other documented cause"],
            ] as const).map(([v, l]) => <label key={v} className="check"><input type="radio" name={`reason-${request.id}`} value={v} checked={reason === v} onChange={() => setReason(v)} /> {l}</label>)}
          </fieldset>
          {reason === "authorized_additional_scope" && (
            <div className="field"><label htmlFor={`au-${request.id}`}>Approval record (dated before the work)</label>
              <select id={`au-${request.id}`} name="auth" required><option value="">Choose…</option>{authorizations.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
              {authorizations.length === 0 && <span className="error">No additional-scope approval on this visit predates the work, so it cannot be eligible as authorized scope.</span>}</div>
          )}
          {reason === "authorized_future_task" && (
            <div className="field"><label htmlFor={`fta-${request.id}`}>Who authorised bringing it forward, and when</label>
              <input id={`fta-${request.id}`} name="fta" required minLength={5} placeholder="For example: Harish D. on 21 Oct, before the work" /></div>
          )}
          <div className="field"><label htmlFor={`no-${request.id}`}>Review note</label><input id={`no-${request.id}`} name="note" /></div>
          <button type="submit" className="primary" disabled={pending}>Record verified reason</button>
        </>
      )}
      <ResultNotice result={result?.ok ? null : result} />
      {decision && <div className="notice" data-tone={decision.status === "eligible" ? "ok" : "warn"} role="status"><strong>Outcome: {decision.status.replace("_", " ")}.</strong> {decision.explanation} {decision.note ?? ""} Actual recorded time is unchanged.</div>}
    </form>
  );
}
