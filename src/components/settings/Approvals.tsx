"use client";
import { approveKpiTarget, approveMetricDefinition, approveRateVersion } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";

export function RateApproval({ rates }: { rates: Array<{ id: string; label: string }> }) {
  const { run, pending, result } = useAction(approveRateVersion);
  return (
    <form className="card form" onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      run({ rateId: String(f.get("r")), value: String(f.get("v")), crewSize: f.get("c") ? Number(f.get("c")) : undefined, netDayMinutes: f.get("n") ? Number(f.get("n")) : undefined, effectiveFrom: String(f.get("d")), evidence: String(f.get("ev")) });
    }}>
      <h2>Approve a rate version</h2>
      <div className="fields">
        <div className="field"><label htmlFor="ra-r">Based on</label><select id="ra-r" name="r">{rates.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
        <div className="field"><label htmlFor="ra-v">Approved value</label><input id="ra-v" name="v" inputMode="decimal" pattern="\d+(\.\d{1,6})?" required /></div>
        <div className="field"><label htmlFor="ra-c">Crew size (team-day rates)</label><input id="ra-c" name="c" type="number" min={1} /></div>
        <div className="field"><label htmlFor="ra-n">Net minutes per rate-day</label><input id="ra-n" name="n" type="number" min={1} /></div>
        <div className="field"><label htmlFor="ra-d">Effective from</label><input id="ra-d" name="d" type="date" required /></div>
      </div>
      <div className="field"><label htmlFor="ra-ev">Evidence (time study, sample size, period)</label><input id="ra-ev" name="ev" required minLength={5} /></div>
      <button type="submit" className="primary" disabled={pending}>Approve as new version</button>
      <ResultNotice result={result} successText="Approved version created. New estimates use it; existing revisions keep their snapshot." />
    </form>
  );
}

export function TargetApproval({ targets, metrics, canApproveTarget, canApproveMetric }: { targets: Array<{ id: string; label: string }>; metrics: Array<{ code: string; label: string; formula: string }>; canApproveTarget: boolean; canApproveMetric: boolean }) {
  const t = useAction(approveKpiTarget);
  const m = useAction(approveMetricDefinition);
  return (
    <div className="grid cols-2">
      {canApproveMetric ? (
        <form className="card form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); m.run({ code: String(f.get("c")), formula: String(f.get("f")), grain: String(f.get("g")), windowText: String(f.get("w")), cohort: String(f.get("co")) }); }}>
          <h2>Approve a metric definition</h2>
          <div className="field"><label htmlFor="md-c">Metric</label><select id="md-c" name="c">{metrics.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></div>
          <div className="field"><label htmlFor="md-f">Formula, inclusions and exclusions</label><textarea id="md-f" name="f" required minLength={10} /></div>
          <div className="fields">
            <div className="field"><label htmlFor="md-g">Grain</label><input id="md-g" name="g" placeholder="e.g. kitchen order item" required /></div>
            <div className="field"><label htmlFor="md-w">Window</label><input id="md-w" name="w" placeholder="e.g. 30 days after handover" required /></div>
            <div className="field"><label htmlFor="md-co">Cohort</label><input id="md-co" name="co" placeholder="e.g. 500–700 sq ft kitchens" required /></div>
          </div>
          <button type="submit" disabled={m.pending}>Approve definition</button>
          <ResultNotice result={m.result} successText="Definition approved as a new version." />
        </form>
      ) : <p className="small muted">Approving metric definitions needs the KRA-review capability.</p>}
      {canApproveTarget ? (
        <form className="card form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); t.run({ targetId: String(f.get("t")), targetValue: String(f.get("v")), baselineValue: String(f.get("b") || "") || undefined, evidence: String(f.get("ev")) }); }}>
          <h2>Approve a numeric target</h2>
          <div className="field"><label htmlFor="ta-t">Target</label><select id="ta-t" name="t">{targets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
          <div className="fields">
            <div className="field"><label htmlFor="ta-v">Target value</label><input id="ta-v" name="v" inputMode="decimal" required /></div>
            <div className="field"><label htmlFor="ta-b">Baseline value (if validated)</label><input id="ta-b" name="b" inputMode="decimal" /></div>
          </div>
          <div className="field"><label htmlFor="ta-ev">Approved KRA document / period / population</label><input id="ta-ev" name="ev" required minLength={5} /></div>
          <button type="submit" disabled={t.pending}>Approve target</button>
          <ResultNotice result={t.result} successText="Target approved." />
        </form>
      ) : <p className="small muted">Approving targets needs the target-approve capability.</p>}
    </div>
  );
}
