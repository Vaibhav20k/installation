"use client";
/**
 * On-site controls for the customer schedule: tick a day done or record why it slipped,
 * lay a template onto a visit, and copy or print the customer's copy.
 */
import { useState } from "react";
import { Check, Copy, Printer, Warning } from "@phosphor-icons/react";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { applyInstallSchedule, setScheduleDayStatus } from "@/app/actions";

export function DayControls({ dayId, status }: { dayId: string; status: string }) {
  const { run, pending, result } = useAction(setScheduleDayStatus);
  const [slip, setSlip] = useState(false);
  const [note, setNote] = useState("");
  if (status === "done") {
    return <button type="button" className="link small" disabled={pending} onClick={() => run({ dayId, status: "planned" })}>Undo</button>;
  }
  return (
    <div className="day-controls">
      {!slip ? (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="primary" disabled={pending} aria-busy={pending} onClick={() => run({ dayId, status: "done" })}><Check size={16} weight="bold" aria-hidden /> Done</button>
          <button type="button" disabled={pending} onClick={() => setSlip(true)}><Warning size={16} aria-hidden /> Slipped</button>
        </div>
      ) : (
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run({ dayId, status: "delayed", note }); }}>
          <label className="small" htmlFor={`n-${dayId}`}>Why did this day slip?</label>
          <input id={`n-${dayId}`} value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} maxLength={300} enterKeyHint="send" />
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="primary" disabled={pending}>Save</button>
            <button type="button" onClick={() => setSlip(false)}>Cancel</button>
          </div>
        </form>
      )}
      <ResultNotice result={result} />
    </div>
  );
}

export function ApplySchedule({ visitId, templates, defaultStart, replacing }: {
  visitId: string; templates: Array<{ code: string; name: string; work_days: number }>; defaultStart: string; replacing: boolean;
}) {
  const { run, pending, result } = useAction(applyInstallSchedule);
  const [code, setCode] = useState(templates[0]?.code ?? "");
  const [start, setStart] = useState(defaultStart);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run({ visitId, templateCode: code, startDate: start }); }}>
      <div className="grid cols-2">
        <div className="field"><label htmlFor="sc-t">Schedule</label>
          <select id="sc-t" value={code} onChange={(e) => setCode(e.target.value)}>
            {templates.map((t) => <option key={t.code} value={t.code}>{t.name} ({t.work_days} working days)</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="sc-s">First day on site</label><input id="sc-s" type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Weekly offs and holidays from the work calendar are skipped and shown to the customer as off days.</p>
      <div><button type="submit" className="primary" disabled={pending} aria-busy={pending}>{replacing ? "Replace schedule" : "Lay out schedule"}</button></div>
      <ResultNotice result={result} successText={result?.ok && (result.data as { outsideBooking?: boolean }).outsideBooking ? "Schedule laid out. It runs outside the booked visit dates; rebook the team to match." : "Schedule laid out."} />
    </form>
  );
}

export function CustomerCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (
    <div className="stack">
      <pre className="customer-copy">{text}</pre>
      <div className="row no-print" style={{ gap: 8 }}>
        <button type="button" className="primary" onClick={copy}><Copy size={16} aria-hidden /> {copied ? "Copied" : "Copy for WhatsApp or email"}</button>
        <button type="button" onClick={() => window.print()}><Printer size={16} aria-hidden /> Print</button>
      </div>
      <span className="sr-only" aria-live="polite">{copied ? "Schedule copied" : ""}</span>
    </div>
  );
}
