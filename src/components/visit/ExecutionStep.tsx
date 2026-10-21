"use client";
import Link from "next/link";
import { acceptProgress, createFollowUpVisit, freezeDailyTargets, recordAcceptance, recordDelay, recordProgress, setDailyTarget, transferOutstandingScope, transitionVisit } from "@/app/actions";
import { ActionButton } from "@/components/ui/ActionButton";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { qty, when } from "@/lib/format";

interface V { id: string; version: number; exec_status: string; planned_start: string | null; planned_end: string | null; timezone: string }
interface ScopeRow { id: string; task: string; component: string; activity: string; unit: string; scoped: string; kind: string; status: string; accepted: string }

export function ExecutionStep({ visit, scope, targets, progress, delays, acceptance, gate, readinessGate, role }: {
  visit: V; scope: ScopeRow[]; targets: Array<{ id: string; task: string; plan_date: string; target_quantity: string; frozen_at: number | null; is_current: boolean; change_reason: string | null }>;
  progress: Array<{ id: string; task: string; quantity_delta: string; accepted: boolean; actor: string | null; at: number; reverses_event_id: string | null; evidence: string | null }>;
  delays: Array<{ cause: string; start: number; end: number; responsible_function: string | null; employee_fault: string; impact: string | null }>;
  acceptance: Array<{ signed_off: boolean; signed_by_name: string | null; accepted_on: string | null; evidence: string | null }>;
  gate: { ok: boolean; blockers: string[] }; readinessGate: { ok: boolean; blockers: string[] }; role: string;
}) {
  const prog = useAction(recordProgress);
  const tgt = useAction(setDailyTarget);
  const dly = useAction(recordDelay);
  const acc = useAction(recordAcceptance);
  const fu = useAction(createFollowUpVisit);
  const manager = role === "manager" || role === "admin";
  const active = scope.filter((s) => s.status === "active");
  const transitions: Record<string, Array<{ to: string; label: string; confirm?: string; reason?: boolean }>> = {
    scheduled: [{ to: "in_progress", label: "Start (depart)" }, { to: "on_hold", label: "Put on hold", reason: true }],
    in_progress: [{ to: "completed", label: "Complete visit", confirm: "All scoped work must be accepted or transferred with a reason." }, { to: "on_hold", label: "Put on hold", reason: true }],
    on_hold: [{ to: "in_progress", label: "Resume" }, { to: "cancelled", label: "Cancel visit", confirm: "Future reservations are released; recorded actual time stays.", reason: true }],
    completed: [{ to: "closed", label: "Close visit" }],
  };
  return (
    <div className="stack">
      {visit.exec_status === "scheduled" && (!gate.ok || !readinessGate.ok) && <Notice tone="warn" title="Departure is blocked" items={[...gate.blockers, ...readinessGate.blockers]} />}
      <section className="card stack" aria-labelledby="h-status">
        <div className="spread"><h2 id="h-status">Visit status</h2><Badge state={visit.exec_status} /></div>
        <div className="row">
          {(transitions[visit.exec_status] ?? []).map((t) => (
            <ActionButton key={t.to} action={transitionVisit} input={{ visitId: visit.id, to: t.to, version: visit.version, reason: t.reason ? `${t.label} from visit page` : undefined }}
              label={t.label} confirm={t.confirm} tone={t.to === "cancelled" ? "danger" : t.to === "completed" || t.to === "in_progress" ? "primary" : undefined} successText={`Visit is now ${t.to.replace("_", " ")}.`} />
          ))}
          {(transitions[visit.exec_status] ?? []).length === 0 && <span className="muted small">No status changes available from {visit.exec_status.replace("_", " ")}. Unscheduled visits become scheduled through firm booking.</span>}
        </div>
      </section>

      <section className="card stack" aria-labelledby="h-prog">
        <h2 id="h-prog">Component progress</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Task</th><th className="num">Scoped</th><th className="num">Accepted</th><th className="num">Remaining</th><th>Record output</th>{manager && <th>Outstanding</th>}</tr></thead>
          <tbody>{scope.map((s) => {
            const remaining = Math.max(0, Number(s.scoped) - Number(s.accepted));
            return (
              <tr key={s.id}>
                <td>{s.task}<div className="small muted">{s.component} · {s.activity} · {s.kind}</div>{s.status !== "active" && <Badge state={s.status === "transferred" ? "released" : "cancelled"} label={s.status} />}</td>
                <td className="num">{qty(s.scoped)} {s.unit}</td><td className="num">{qty(s.accepted)}</td><td className="num"><strong>{qty(remaining)}</strong></td>
                <td>{s.status === "active" && ["in_progress", "completed"].includes(visit.exec_status) && (
                  <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); prog.run({ visitTaskId: s.id, quantityDelta: String(f.get("q")), evidence: String(f.get("ev") || "") || undefined }); e.currentTarget.reset(); }}>
                    <label className="sr-only" htmlFor={`q-${s.id}`}>Quantity completed for {s.task}</label>
                    <input id={`q-${s.id}`} name="q" inputMode="decimal" pattern="\d+(\.\d{1,6})?" required style={{ width: 90 }} />
                    <label className="sr-only" htmlFor={`ev-${s.id}`}>Evidence</label><input id={`ev-${s.id}`} name="ev" placeholder="Evidence" style={{ width: 140 }} />
                    <button type="submit" disabled={prog.pending}>Add</button>
                  </form>
                )}</td>
                {manager && <td>{s.status === "active" && remaining > 0 && <ActionButton action={transferOutstandingScope} input={{ visitTaskId: s.id, reason: "Transferred to a follow-up visit" }} label="Transfer remaining" confirm="Move this task's unaccepted quantity out of this visit so a follow-up can take it." />}</td>}
              </tr>
            );
          })}</tbody>
        </table></div>
        <ResultNotice result={prog.result} successText="Progress recorded." />
        <details><summary>Progress history ({progress.length})</summary>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Task</th><th className="num">Δ quantity</th><th>By</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{progress.map((p) => (
              <tr key={p.id}>
                <td>{when(p.at, visit.timezone)}</td><td>{p.task}</td><td className="num">{qty(p.quantity_delta)}{p.reverses_event_id && <div className="small muted">reversal</div>}</td>
                <td>{p.actor}</td><td><Badge state={p.accepted ? "accepted" : "pending"} /></td>
                <td className="row">
                  {!p.accepted && role !== "employee" && <ActionButton action={acceptProgress} input={{ progressEventId: p.id }} label="Accept" />}
                  {p.accepted && Number(p.quantity_delta) > 0 && role !== "employee" && (
                    <ActionButton action={recordProgress} input={{ visitTaskId: scope.find((s) => s.task === p.task)?.id, quantityDelta: `-${p.quantity_delta}`, reversesEventId: p.id, evidence: "Reversal of a recording error" }}
                      label="Reverse" tone="danger" confirm="Records a signed reversal that references this event. The original stays in history." />
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </details>
      </section>

      <div className="grid cols-2">
        <section className="card stack" aria-labelledby="h-tgt">
          <h2 id="h-tgt">Daily targets</h2>
          <p className="small muted">Freeze each day&apos;s target before work. Later edits keep the original in history and never convert unfinished original work into authorized additional scope.</p>
          <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); tgt.run({ visitTaskId: String(f.get("vt")), planDate: String(f.get("d")), targetQuantity: String(f.get("q")), changeReason: String(f.get("r") || "") || undefined }); }}>
            <div className="fields">
              <div className="field"><label htmlFor="t-vt">Task</label><select id="t-vt" name="vt">{active.map((s) => <option key={s.id} value={s.id}>{s.task} · {s.component} · {s.activity}</option>)}</select></div>
              <div className="field"><label htmlFor="t-d">Date</label><input id="t-d" type="date" name="d" defaultValue={visit.planned_start ?? ""} required /></div>
              <div className="field"><label htmlFor="t-q">Target quantity</label><input id="t-q" name="q" inputMode="decimal" required /></div>
              <div className="field"><label htmlFor="t-r">Reason (needed if frozen)</label><input id="t-r" name="r" /></div>
            </div>
            <button type="submit" disabled={tgt.pending || active.length === 0}>Set target</button>
            <ResultNotice result={tgt.result} successText="Target saved." />
          </form>
          {visit.planned_start && <ActionButton action={freezeDailyTargets} input={{ visitId: visit.id, planDate: visit.planned_start }} label={`Freeze targets for ${visit.planned_start}`} />}
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Task</th><th className="num">Target</th><th>State</th></tr></thead>
            <tbody>{targets.map((t) => (
              <tr key={t.id} style={{ opacity: t.is_current ? 1 : 0.7 }}><td>{t.plan_date}</td><td>{t.task}</td><td className="num">{qty(t.target_quantity)}</td>
                <td className="small">{t.is_current ? "Current" : "Superseded"}{t.frozen_at ? " · frozen" : ""}{t.change_reason ? ` · ${t.change_reason}` : ""}</td></tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="card stack" aria-labelledby="h-dly">
          <h2 id="h-dly">Delays and blockers</h2>
          <form className="form" onSubmit={(e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            dly.run({ visitId: visit.id, start: new Date(String(f.get("s"))).toISOString(), end: new Date(String(f.get("e"))).toISOString(), cause: String(f.get("c")),
              responsibleFunction: String(f.get("fn") || "") || undefined, employeeFault: String(f.get("ef")), impact: String(f.get("im") || "") || undefined, evidence: String(f.get("ev") || "") || undefined });
          }}>
            <div className="fields">
              <div className="field"><label htmlFor="dl-s">From</label><input id="dl-s" type="datetime-local" name="s" required /></div>
              <div className="field"><label htmlFor="dl-e">To</label><input id="dl-e" type="datetime-local" name="e" required /></div>
              <div className="field"><label htmlFor="dl-c">Cause</label><select id="dl-c" name="c">{["materials", "site_access", "equipment", "customer", "other_function", "weather", "employee", "unknown"].map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</select></div>
              <div className="field"><label htmlFor="dl-f">Responsible function</label><select id="dl-f" name="fn" defaultValue=""><option value="">Unknown / not assessed</option>{["Factory", "Purchase", "Logistics", "Services", "Site", "Installation", "Customer"].map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="field"><label htmlFor="dl-ef">Employee fault</label><select id="dl-ef" name="ef" defaultValue="not_assessed"><option value="not_assessed">Not assessed</option><option value="no">No</option><option value="yes">Yes (manager only)</option></select></div>
            </div>
            <div className="field"><label htmlFor="dl-i">Impact</label><input id="dl-i" name="im" /></div>
            <div className="field"><label htmlFor="dl-ev">Evidence</label><input id="dl-ev" name="ev" /></div>
            <button type="submit" disabled={dly.pending}>Record delay</button>
            <ResultNotice result={dly.result} successText="Delay recorded. Responsibility is not inferred from who reported it." />
          </form>
          <ul className="small">{delays.map((d, i) => <li key={i}>{d.cause.replace("_", " ")} · {when(d.start, visit.timezone)} → {when(d.end, visit.timezone)} · {d.responsible_function ?? "function unknown"} · fault: {d.employee_fault.replace("_", " ")}{d.impact ? ` · ${d.impact}` : ""}</li>)}</ul>
        </section>
      </div>

      <div className="grid cols-2">
        <section className="card stack" aria-labelledby="h-acc">
          <h2 id="h-acc">Customer acceptance</h2>
          <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); acc.run({ visitId: visit.id, signedOff: f.get("so") === "yes", signedByName: String(f.get("by") || "") || undefined, acceptedOn: String(f.get("on") || "") || undefined, evidence: String(f.get("ev") || "") || undefined }); }}>
            <div className="fields">
              <div className="field"><label htmlFor="ac-so">Signed off?</label><select id="ac-so" name="so"><option value="no">Not signed off</option><option value="yes">Signed off</option></select></div>
              <div className="field"><label htmlFor="ac-by">Signed by</label><input id="ac-by" name="by" /></div>
              <div className="field"><label htmlFor="ac-on">Accepted on</label><input id="ac-on" type="date" name="on" /></div>
            </div>
            <div className="field"><label htmlFor="ac-ev">Evidence</label><input id="ac-ev" name="ev" /></div>
            <button type="submit" disabled={acc.pending}>Record</button>
            <ResultNotice result={acc.result} />
          </form>
          <ul className="small">{acceptance.map((a, i) => <li key={i}>{a.signed_off ? `Signed off by ${a.signed_by_name ?? "customer"} on ${a.accepted_on}` : "Not signed off"}{a.evidence ? ` · ${a.evidence}` : ""}</li>)}</ul>
          <p className="small muted">Unknown sign-off is never counted as accepted in quality metrics.</p>
        </section>
        <section className="card stack" aria-labelledby="h-fu">
          <h2 id="h-fu">Follow-up or final visit</h2>
          <p className="small muted">Pre-fills uncommitted original scope and the previous team. Completed work returns only as explicit rework scope.</p>
          <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); fu.run({ fromVisitId: visit.id, visitType: String(f.get("t")), repeatReason: String(f.get("r")), plannedStart: String(f.get("s") || "") || undefined, plannedEnd: String(f.get("e") || "") || undefined, changeReason: String(f.get("why")) }); }}>
            <div className="fields">
              <div className="field"><label htmlFor="fu-t">Type</label><select id="fu-t" name="t"><option value="follow_up">Follow-up</option><option value="final">Final</option></select></div>
              <div className="field"><label htmlFor="fu-r">Reason</label><select id="fu-r" name="r">{["planned_phasing", "material_shortage", "customer_change", "failed_readiness", "rework", "other_documented"].map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></div>
              <div className="field"><label htmlFor="fu-s">Start</label><input id="fu-s" type="date" name="s" /></div>
              <div className="field"><label htmlFor="fu-e">End</label><input id="fu-e" type="date" name="e" /></div>
            </div>
            <div className="field"><label htmlFor="fu-w">Change reason (adds the visit to a new plan revision if needed)</label><input id="fu-w" name="why" required minLength={3} /></div>
            <button type="submit" disabled={fu.pending}>Create visit</button>
            <ResultNotice result={fu.result} successText="Follow-up created with remaining scope." />
          </form>
          {fu.result?.ok && <Link href={`/visits/${(fu.result.data as { id: string }).id}?step=scope`}>Open the new visit</Link>}
        </section>
      </div>
    </div>
  );
}
