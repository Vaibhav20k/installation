"use client";
import { createSavingsClaim, verifySavings } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { Badge } from "@/components/ui/Badge";
import { formatMoney, rupeesToMinor } from "@/lib/format";

export function SavingsForms({ claims, canVerify, canPropose, projects }: {
  claims: Array<{ id: string; scope: string; period: string; load_ref: string | null; proposed_saving_minor: number | null; baseline_minor: number | null; actual_minor: number | null; finance_verified: boolean; evidence: string | null }>;
  canVerify: boolean; canPropose: boolean; projects: Array<{ id: string; label: string }>;
}) {
  const verify = useAction(verifySavings);
  const propose = useAction(createSavingsClaim);
  return (
    <section className="card stack" aria-labelledby="h-sav">
      <h2 id="h-sav">Unloading savings claims</h2>
      <p className="small muted">Savings = Finance-approved comparable baseline − verified actual for the same load, volume, location and period. Unspent budget or a proposed avoidance action is not a verified saving.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Scope</th><th>Period</th><th>Load</th><th className="num">Proposed</th><th className="num">Baseline</th><th className="num">Actual</th><th>Status</th>{canVerify && <th>Finance verification</th>}</tr></thead>
        <tbody>{claims.map((c) => (
          <tr key={c.id}><td>{c.scope}</td><td>{c.period}</td><td>{c.load_ref ?? "—"}</td><td className="num">{formatMoney(c.proposed_saving_minor)}</td><td className="num">{formatMoney(c.baseline_minor)}</td><td className="num">{formatMoney(c.actual_minor)}</td>
            <td><Badge state={c.finance_verified ? "approved" : "pending"} label={c.finance_verified ? "Verified" : "Unverified"} />{c.evidence && <div className="small muted">{c.evidence}</div>}</td>
            {canVerify && <td>{!c.finance_verified && (
              <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); verify.run({ claimId: c.id, baselineMinor: rupeesToMinor(String(f.get("b"))), actualMinor: rupeesToMinor(String(f.get("a"))), evidence: String(f.get("ev")), scopeMatched: f.get("m") === "on" ? true : false }); }}>
                <label className="sr-only" htmlFor={`sb-${c.id}`}>Baseline ₹</label><input id={`sb-${c.id}`} name="b" placeholder="Baseline ₹" required style={{ width: 110 }} />
                <label className="sr-only" htmlFor={`sa-${c.id}`}>Actual ₹</label><input id={`sa-${c.id}`} name="a" placeholder="Actual ₹" required style={{ width: 110 }} />
                <label className="sr-only" htmlFor={`se-${c.id}`}>Evidence</label><input id={`se-${c.id}`} name="ev" placeholder="Evidence" required style={{ width: 140 }} />
                <label className="check small"><input type="checkbox" name="m" required /> Scope matches baseline</label>
                <button type="submit" disabled={verify.pending}>Verify</button>
              </form>
            )}</td>}
          </tr>
        ))}{claims.length === 0 && <tr><td colSpan={8} className="muted">No claims.</td></tr>}</tbody>
      </table></div>
      <ResultNotice result={verify.result} successText="Saving verified by Finance." />
      {canPropose && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); propose.run({ projectId: String(f.get("p") || "") || undefined, loadRef: String(f.get("l") || "") || undefined, scope: String(f.get("s")), period: String(f.get("per")), proposedSavingMinor: f.get("amt") ? rupeesToMinor(String(f.get("amt"))) : undefined }); }}>
          <h3>Propose a saving (unverified)</h3>
          <div className="fields">
            <div className="field"><label htmlFor="sp-p">Project</label><select id="sp-p" name="p"><option value="">Not project-specific</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            <div className="field"><label htmlFor="sp-l">Load ID</label><input id="sp-l" name="l" /></div>
            <div className="field"><label htmlFor="sp-per">Period</label><input id="sp-per" name="per" placeholder="2026-10" required /></div>
            <div className="field"><label htmlFor="sp-a">Proposed saving (₹)</label><input id="sp-a" name="amt" inputMode="decimal" /></div>
          </div>
          <div className="field"><label htmlFor="sp-s">Scope</label><input id="sp-s" name="s" required minLength={3} /></div>
          <button type="submit" disabled={propose.pending}>Propose</button>
          <ResultNotice result={propose.result} successText="Proposal recorded; it stays unverified until Finance confirms." />
        </form>
      )}
    </section>
  );
}
