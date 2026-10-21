"use client";
import { approvePolicy, createPolicyVersion, previewPolicy, updateDraftPolicy } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { ActionButton } from "@/components/ui/ActionButton";
import { hours } from "@/lib/format";

interface Policy {
  id: string; status: string; normalBasis: string; fixedMonthlyMinutes: number | null; creditedActivities: string[]; catchUpThresholdCredit: string; candidateRule: string;
  externalDelayEligibility: string; otherDocumentedEligibility: string; allocationMethod: string; leaveAdjustment: string; settlementTimezone: string;
}
const ACTIVITIES = ["installation", "additional", "rework", "travel", "waiting", "other"];

export function PolicyEditor({ policy, canEdit, canApprove }: { policy: Policy; canEdit: boolean; canApprove: boolean }) {
  const save = useAction(updateDraftPolicy);
  const preview = useAction(previewPolicy, { refresh: false });
  const version = useAction(createPolicyVersion);
  const draft = policy.status === "draft";
  const disabled = !canEdit || !draft;
  const sel = (name: keyof Policy, label: string, options: Array<[string, string]>, hint?: string) => (
    <div className="field"><label htmlFor={`${policy.id}-${name}`}>{label}</label>
      <select id={`${policy.id}-${name}`} name={name} defaultValue={String(policy[name])} disabled={disabled}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {hint && <span className="hint">{hint}</span>}</div>
  );
  const p = preview.result?.ok ? (preview.result.data as { unresolved: string[]; cases: Array<{ name: string; N: number | null; Q: number; E: number; X: number | null; cap: number | null; approvedOT: number; blockers: string[] }> }) : null;
  return (
    <div className="stack">
      <form className="form" onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        save.run({ policyId: policy.id, normalBasis: f.get("normalBasis"), fixedMonthlyMinutes: f.get("fixedMonthlyMinutes") ? Number(f.get("fixedMonthlyMinutes")) : null,
          creditedActivities: f.getAll("creditedActivities").map(String), catchUpThresholdCredit: f.get("catchUpThresholdCredit"), candidateRule: f.get("candidateRule"),
          externalDelayEligibility: f.get("externalDelayEligibility"), otherDocumentedEligibility: f.get("otherDocumentedEligibility"), allocationMethod: f.get("allocationMethod"),
          leaveAdjustment: f.get("leaveAdjustment"), settlementTimezone: f.get("settlementTimezone") });
      }}>
        <div className="fields">
          {sel("normalBasis", "Normal requirement (N) basis", [["calendar", "Calendar-derived scheduled net minutes"], ["fixed", "Approved fixed monthly base"]])}
          <div className="field"><label htmlFor={`${policy.id}-fixed`}>Fixed monthly minutes</label><input id={`${policy.id}-fixed`} name="fixedMonthlyMinutes" type="number" min={1} defaultValue={policy.fixedMonthlyMinutes ?? ""} disabled={disabled} />
            <span className="hint">{policy.fixedMonthlyMinutes ? hours(policy.fixedMonthlyMinutes) : "Used only with the fixed basis"}</span></div>
          {sel("catchUpThresholdCredit", "Do catch-up hours earn threshold credit?", [["unset", "Unset (blocks finalization)"], ["include", "Include in Q"], ["exclude", "Exclude from Q"]], "Either way, catch-up stays ineligible for overtime.")}
          {sel("candidateRule", "Eligible candidate intervals", [["outside_schedule_only", "Outside the normal schedule only"], ["authorized_any", "Any explicitly authorized work"]])}
          {sel("externalDelayEligibility", "Extra time from external delays", [["unset", "Unset (pending policy)"], ["eligible", "Eligible"], ["ineligible", "Ineligible"]])}
          {sel("otherDocumentedEligibility", "Other documented causes", [["unset", "Unset (pending policy)"], ["eligible", "Eligible"], ["ineligible", "Ineligible"]])}
          {sel("allocationMethod", "Cap allocation method", [["unset", "Unset (blocks finalization)"], ["chronological", "Chronological"], ["manager_selected", "Manager-selected intervals"]])}
          {sel("leaveAdjustment", "Leave adjustment to N", [["unset", "Unset (blocks months with leave)"], ["subtract_scheduled_net", "Subtract scheduled net minutes once per leave date"]])}
          <div className="field"><label htmlFor={`${policy.id}-tz`}>Settlement timezone</label><input id={`${policy.id}-tz`} name="settlementTimezone" defaultValue={policy.settlementTimezone} disabled={disabled} /></div>
        </div>
        <fieldset disabled={disabled}>
          <legend>Activities credited toward Q</legend>
          <div className="row">{ACTIVITIES.map((a) => <label key={a} className="check"><input type="checkbox" name="creditedActivities" value={a} defaultChecked={policy.creditedActivities.includes(a)} /> {a}</label>)}</div>
        </fieldset>
        {!disabled && <button type="submit" disabled={save.pending}>Save draft</button>}
        {!draft && <p className="small muted">This version is {policy.status}; create a new version to change it.</p>}
        <ResultNotice result={save.result} successText="Draft saved." />
      </form>
      <div className="row">
        <button type="button" onClick={() => preview.run({ policyId: policy.id })} disabled={preview.pending}>Preview against sample cases</button>
        {draft && canApprove && <ActionButton action={approvePolicy} input={{ policyId: policy.id, acknowledgeIllustrative: true }} label="Approve for demo use" tone="primary" confirm="This policy contains illustrative values. Approving activates it for demo calculations only; it is not an approved payroll rule." successText="Policy approved for demo use." />}
        {canEdit && <form className="row" onSubmit={(e) => { e.preventDefault(); version.run({ fromPolicyId: policy.id, effectiveMonth: String(new FormData(e.currentTarget).get("m")) }); }}>
          <label className="sr-only" htmlFor={`${policy.id}-nv`}>Effective month for new version</label><input id={`${policy.id}-nv`} name="m" type="month" required style={{ width: 160 }} /><button type="submit" disabled={version.pending}>New draft version</button></form>}
      </div>
      <ResultNotice result={version.result} successText="New draft version created." />
      {p && (
        <div className="table-wrap"><table>
          <caption>Sample cases (master prompt illustrations)</caption>
          <thead><tr><th>Case</th><th className="num">N</th><th className="num">Q</th><th className="num">E</th><th className="num">X</th><th className="num">Cap</th><th className="num">Allocated</th><th>Blockers</th></tr></thead>
          <tbody>{p.cases.map((c) => <tr key={c.name}><td>{c.name}</td><td className="num">{c.N ?? "—"}</td><td className="num">{c.Q}</td><td className="num">{c.E}</td><td className="num">{c.X ?? "—"}</td><td className="num">{c.cap ?? "—"}</td><td className="num">{c.approvedOT}</td><td className="small">{c.blockers.join("; ") || "None"}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
