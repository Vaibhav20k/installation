"use client";
/**
 * Reports from the site on a dispatch, for its Installation Manager: each waiting report shows what, how many,
 * why, who and the photo, with Confirm (opens a complaint) and Reject (needs a reason). Decided reports stay listed.
 */
import { useState } from "react";
import { confirmMndReport, rejectMndReport } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import type { SiteReport } from "@/server/services/site-mnd";

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function Decide({ id }: { id: string }) {
  const confirm = useAction(confirmMndReport);
  const reject = useAction(rejectMndReport);
  const [rejecting, setRejecting] = useState(false);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!rejecting ? (
        <div className="mnd-decide">
          <button type="button" className="primary" disabled={confirm.pending} onClick={() => confirm.run({ reportId: id })}>{confirm.pending ? "Confirming…" : "Confirm: raise complaint"}</button>
          <button type="button" onClick={() => setRejecting(true)}>Reject</button>
        </div>
      ) : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); reject.run({ reportId: id, reason: String(new FormData(e.currentTarget).get("why")) }); }}>
          <div className="field"><label htmlFor={`rj-${id}`}>Why reject? (the reporter sees this)</label><textarea id={`rj-${id}`} name="why" rows={2} required minLength={3} maxLength={500} /></div>
          <div className="mnd-decide"><button type="submit" disabled={reject.pending}>{reject.pending ? "Rejecting…" : "Reject report"}</button><button type="button" className="link" onClick={() => setRejecting(false)}>Cancel</button></div>
        </form>
      )}
      <ResultNotice result={confirm.result ?? reject.result} successText="Done. The reporter has been told." />
    </div>
  );
}

export function SiteReports({ reports, canDecide }: { reports: SiteReport[]; canDecide: boolean }) {
  return (
    <ul className="mnd-reports">
      {reports.map((r) => (
        <li key={r.id} data-status={r.status}>
          <div className="spread"><strong>{r.kind === "missing" ? "Missing" : "Damaged"}: {r.quantity} × {r.item}</strong>
            <span className="flow-stage">{r.status === "pending" ? "Waiting" : r.status === "confirmed" ? `Confirmed · ${r.complaint}` : "Rejected"}</span></div>
          <p className="small" style={{ margin: "2px 0" }}>{r.reason}</p>
          <p className="small muted" style={{ margin: 0 }}>{r.reporter} · {fmt.format(Number(r.reported_at))}{r.decision_reason ? ` · Rejected: ${r.decision_reason}` : ""}</p>
          {r.photo_ids.length > 0 && <div className="timeline-files">{r.photo_ids.map((p) => <a key={p} href={`/api/evidence/file/${p}`} target="_blank" rel="noreferrer"><img src={`/api/evidence/file/${p}`} alt={`Photo of ${r.item}`} loading="lazy" decoding="async" /></a>)}</div>}
          {r.status === "pending" && (canDecide ? <Decide id={r.id} /> : <p className="small muted" style={{ margin: 0 }}>Waiting for the site&apos;s Installation Manager.</p>)}
        </li>
      ))}
    </ul>
  );
}
