"use client";
/**
 * Today's tasks as catalogue rows with hardware steppers. A recorded quantity stamps onto its row
 * once the server confirms; nothing is shown as done before that.
 */
import { useState } from "react";
import { Minus, Plus, Warning } from "@phosphor-icons/react";
import { recordDelay, recordProgress } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";

interface Task { id: string; task: string; component: string; activity: string; unit: string; scoped: string; accepted: string; pending: string; target: string | null; kind: string }

function TaskRow({ t, canRecord, isEmployee }: { t: Task; canRecord: boolean; isEmployee: boolean }) {
  const remaining = Math.max(0, Number(t.scoped) - Number(t.accepted) - Number(t.pending));
  const [n, setN] = useState(0);
  const [stamped, setStamped] = useState<number | null>(null);
  const prog = useAction(recordProgress, { onSuccess: () => { setStamped(n); setN(0); } });
  const step = (d: number) => { setN((v) => Math.min(remaining, Math.max(0, v + d))); setStamped(null); };
  const done = Number(t.accepted) + Number(t.pending);
  const pct = Number(t.scoped) > 0 ? Math.min(100, (done / Number(t.scoped)) * 100) : 0;
  return (
    <li className="task-row">
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <span className="code-tag">{t.task}{t.kind !== "original" ? ` · ${t.kind}` : ""}</span>
          <div className="callout-title" style={{ marginTop: 4 }}>{t.component} · {t.activity}</div>
          <div className="callout-meta">Target today <b>{t.target ?? "not set"}</b> · remaining <b>{remaining}</b> {t.unit}</div>
        </div>
        {stamped !== null && <span className="badge stamp-hero stamp-press" data-tone="ok">{isEmployee ? `Sent ${stamped}` : `Recorded ${stamped}`}</span>}
      </div>
      <div className="meter" role="img" aria-label={`${done} of ${t.scoped} ${t.unit} done`}><span style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <div className="small muted" style={{ marginTop: 6 }}>{t.accepted} accepted{Number(t.pending) > 0 ? ` · ${t.pending} awaiting acceptance` : ""} · of {t.scoped} {t.unit}</div>
      {canRecord && remaining > 0 && (
        <div className="row" style={{ marginTop: 12 }}>
          <div className="stepper" aria-label={`Quantity completed for ${t.component} ${t.activity}`}>
            <button type="button" onClick={() => step(-1)} aria-label="One less" disabled={n === 0}><Minus size={20} aria-hidden /></button>
            <output key={n} className="bump" aria-live="polite">{n}</output>
            <button type="button" onClick={() => step(1)} aria-label="One more" disabled={n >= remaining}><Plus size={20} aria-hidden /></button>
          </div>
          <button type="button" className="primary" style={{ flex: 1 }} disabled={n === 0 || prog.pending} onClick={() => prog.run({ visitTaskId: t.id, quantityDelta: String(n) })}>
            {prog.pending ? "Saving…" : n === 0 ? "Choose a quantity" : `Record ${n} ${t.unit}`}
          </button>
        </div>
      )}
      {prog.result && !prog.result.ok && <ResultNotice result={prog.result} />}
    </li>
  );
}

export function DayProgress({ visitId, tasks, canRecord, isEmployee }: { visitId: string; tasks: Task[]; canRecord: boolean; isEmployee: boolean }) {
  const block = useAction(recordDelay);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <ul className="task-list" id="progress">{tasks.map((t) => <TaskRow key={t.id} t={t} canRecord={canRecord} isEmployee={isEmployee} />)}</ul>
      {isEmployee && <p className="small muted" style={{ margin: 0 }}>Your supervisor accepts recorded quantities before they count.</p>}
      {canRecord && (
        <details id="blocker" className="blocker">
          <summary className="button" style={{ listStyle: "none", width: "100%" }}><Warning size={18} aria-hidden /> Report a blocker</summary>
          <form className="form" style={{ marginTop: 12 }} onSubmit={(e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const now = new Date();
            const start = new Date(now.getTime() - Number(f.get("mins")) * 60000);
            block.run({ visitId, start: start.toISOString(), end: now.toISOString(), cause: String(f.get("c")), impact: String(f.get("i") || "") || undefined });
          }}>
            <div className="fields">
              <div className="field"><label htmlFor="bl-c">What is blocking work?</label><select id="bl-c" name="c">{["materials", "site_access", "equipment", "customer", "other_function", "weather", "unknown"].map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</select></div>
              <div className="field"><label htmlFor="bl-m">For how long, until now (minutes)</label><input id="bl-m" name="mins" type="number" inputMode="numeric" min={5} max={720} defaultValue={30} required /></div>
            </div>
            <div className="field"><label htmlFor="bl-i">Details</label><input id="bl-i" name="i" enterKeyHint="send" /></div>
            <button type="submit" className="primary" disabled={block.pending}>Report blocker</button>
            <ResultNotice result={block.result} successText="Blocker reported. Responsibility is assessed separately; it is not assigned to you." />
          </form>
        </details>
      )}
    </div>
  );
}
