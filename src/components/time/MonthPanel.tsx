"use client";
import { finalizeMonth, markReviewedMissingDay, reconcileMonth, reopenMonth } from "@/app/actions";
import { ActionButton } from "@/components/ui/ActionButton";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { hours, when } from "@/lib/format";

interface Recon {
  N: number | null; Q: number; X: number | null; B: number | null; E: number; cap: number | null; approvedOT: number; nExplanation: string; policyId: string | null; illustrative: boolean;
  qIfCatchUpIncluded: number; qIfCatchUpExcluded: number; catchUpMinutes: number; excludedActualMinutes: number; acceptedWorkMinutes: number; nonOTApprovedWorkMinutes: number;
  requestedMinutes: number; eligibleMinutes: number; ineligibleMinutes: number; pendingMinutes: number; blockers: string[]; canFinalize: boolean; settlementTimezone: string; calcVersion: string;
  allocations: Array<{ requestId: string; projectId: string | null; start: number; end: number; minutes: number }>; byProject: Record<string, number>;
}

export function MonthPanel({ employeeId, month, recon, missingDates, stored, role, own }: { employeeId: string; month: string; recon: Recon; missingDates: string[]; stored: { state: string; revision: number } | null; role: string; own: boolean }) {
  const missing = useAction(markReviewedMissingDay);
  const reopen = useAction(reopenMonth);
  const manager = role === "manager" || role === "admin";
  const rows: Array<[string, string, string]> = [
    ["N: normal requirement", hours(recon.N), recon.nExplanation || "No policy"],
    ["Q: qualifying accepted minutes", hours(recon.Q), "Accepted, current entries in credited activities, split at settlement-timezone month boundaries."],
    ["X: monthly excess", hours(recon.X), "max(0, Q − N)"],
    ["B: shortfall", hours(recon.B), "max(0, N − Q); shown separately, never netted against other months."],
    ["E: eligible candidate minutes", hours(recon.E), "Reviewed-eligible requested intervals that are also qualifying minutes."],
    ["Cap", hours(recon.cap), "min(X, E): approved overtime can never exceed either."],
    ["Allocated / approved overtime", hours(recon.approvedOT), "Deterministic allocation under the policy's selected method."],
  ];
  return (
    <div className="stack">
      <Notice tone={recon.canFinalize ? "ok" : "warn"} title={recon.canFinalize ? "Ready to finalize" : `Provisional: finalization blocked (${recon.blockers.length})`} items={recon.blockers} />
      <p className="small muted">Policy {recon.policyId ?? "none"}{recon.illustrative ? " (illustrative)" : ""} · settlement timezone {recon.settlementTimezone} · calculation {recon.calcVersion}. Internal approval tracking only: no wage, multiplier or payroll entitlement is calculated.{stored ? ` Last stored: revision ${stored.revision} (${stored.state}).` : ""}</p>
      <div className="grid cols-2">
        <section className="card" aria-labelledby="h-calc">
          <h2 id="h-calc">Monthly calculation</h2>
          <div className="table-wrap"><table>
            <tbody>{rows.map(([k, v, why]) => <tr key={k}><th scope="row">{k}</th><td className="num">{v}</td><td className="small muted">{why}</td></tr>)}</tbody>
          </table></div>
        </section>
        <section className="card stack" aria-labelledby="h-sep">
          <h2 id="h-sep">Kept separate</h2>
          <dl className="facts">
            <dt>Accepted work</dt><dd>{hours(recon.acceptedWorkMinutes)} (actual, unchanged by decisions)</dd>
            <dt>Work not approved as overtime</dt><dd>{hours(recon.nonOTApprovedWorkMinutes)}</dd>
            <dt>Verified catch-up</dt><dd>{hours(recon.catchUpMinutes)} (always ineligible for overtime)</dd>
            <dt>Q if catch-up counted / not counted</dt><dd>{hours(recon.qIfCatchUpIncluded)} / {hours(recon.qIfCatchUpExcluded)}</dd>
            <dt>Requested · eligible · ineligible · pending</dt><dd>{hours(recon.requestedMinutes)} · {hours(recon.eligibleMinutes)} · {hours(recon.ineligibleMinutes)} · {hours(recon.pendingMinutes)}</dd>
            <dt>Accepted time not counted in Q</dt><dd>{hours(recon.excludedActualMinutes)}</dd>
          </dl>
          {recon.allocations.length > 0 && (
            <div className="table-wrap"><table>
              <thead><tr><th>Allocated interval</th><th>Project</th><th className="num">Minutes</th></tr></thead>
              <tbody>{recon.allocations.map((a, i) => <tr key={i}><td>{when(a.start)} → {when(a.end)}</td><td className="small">{a.projectId ?? "overhead"}</td><td className="num">{a.minutes}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
      </div>
      <section className="card stack" aria-labelledby="h-act">
        <h2 id="h-act">Actions</h2>
        <div className="row">
          <ActionButton action={reconcileMonth} input={{ employeeId, month }} label="Store provisional revision" successText="Provisional revision stored." />
          {manager && !own && <ActionButton action={finalizeMonth} input={{ employeeId, month }} label="Finalize month" tone="primary" confirm="Finalizing records allocations that cannot be double-counted. Later corrections invalidate it for review." successText="Month finalized." />}
        </div>
        {manager && !own && stored?.state === "final" && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); reopen.run({ employeeId, month, reason: String(new FormData(e.currentTarget).get("why")) }); }}>
            <div className="field"><label htmlFor="ro-why">Reopen with reason</label><input id="ro-why" name="why" required minLength={5} /></div>
            <button type="submit" className="danger" disabled={reopen.pending}>Reopen final month</button>
            <ResultNotice result={reopen.result} successText="Reopened; the final revision is kept as invalidated history." />
          </form>
        )}
        {missingDates.length > 0 && (
          <div className="stack">
            <h3>Missing timesheet days ({missingDates.length})</h3>
            <p className="small muted">Assigned working days without an accepted entry. A supervisor can mark a day as reviewed; this never creates attendance.</p>
            {role !== "employee" && !own ? (
              <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); missing.run({ employeeId, date: String(f.get("d")), reason: String(f.get("r")), note: String(f.get("n") || "") || undefined }); }}>
                <div className="field"><label htmlFor="md-d">Date</label><select id="md-d" name="d">{missingDates.map((d) => <option key={d}>{d}</option>)}</select></div>
                <div className="field"><label htmlFor="md-r">Reason</label><select id="md-r" name="r"><option value="no_work">No work that day</option><option value="leave">Leave</option><option value="reviewed_missing">Reviewed: missing</option></select></div>
                <div className="field"><label htmlFor="md-n">Note</label><input id="md-n" name="n" /></div>
                <button type="submit" style={{ alignSelf: "flex-end" }} disabled={missing.pending}>Mark reviewed</button>
              </form>
            ) : <p className="small">{missingDates.join(", ")}</p>}
            <ResultNotice result={missing.result} />
          </div>
        )}
        {!recon.canFinalize && <p className="small muted"><Badge state="provisional" /> Unresolved policy fields are configured under Settings → Time policies.</p>}
      </section>
    </div>
  );
}
