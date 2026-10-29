"use client";
/**
 * "Report missing or damaged" for the crew on site, built for one hand on a phone. Four taps and a photo:
 * pick the item, Missing or Damaged, how many (− / +), a ready-made reason, then take a photo and send. The
 * button says exactly what is still missing, items already reported can't be picked twice, and the screen
 * confirms who was told. The site's Installation Manager confirms or rejects each report.
 */
import { useCallback, useState } from "react";
import { ArrowLeft, CheckCircle, Minus, Package, Plus, WarningCircle } from "@phosphor-icons/react";
import { reportMnd } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { FilesField, type FileState } from "@/components/dispatch/StageForms";

interface Line { item_id: string; name: string; unit: string; quantity: string; open_complaint: string | null; pending_report: string | null }
interface Site { project_id: string; project: string; dispatches: Array<{ dispatch_id: string; business_id: string; types: string[]; lines: Line[] }> }
interface Mine { id: string; kind: string; quantity: string; item: string; dispatch: string; status: string; decision_reason: string | null; complaint: string | null }

const REASONS = {
  missing: ["Not in the delivery", "Box was empty", "Fewer than listed"],
  damaged: ["Broken", "Scratched or dented", "Wet or swollen", "Wrong size"],
} as const;

export function SiteMndReport({ sites, mine }: { sites: Site[]; mine: Mine[] }) {
  const [line, setLine] = useState<(Line & { dispatch: string }) | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  if (sent) return (
    <div className="mnd-done" role="status">
      <CheckCircle size={40} weight="fill" aria-hidden />
      <p><strong>Sent.</strong> {sent} Your Installation Manager will confirm it, and you will get a notification either way.</p>
      <button type="button" className="primary flow-submit" onClick={() => setSent(null)}>Report another item</button>
    </div>
  );
  if (line) return <ReportForm line={line} onBack={() => setLine(null)} onSent={(t) => { setLine(null); setSent(t); }} />;
  const any = sites.some((s) => s.dispatches.length);
  return (
    <div className="stack" style={{ gap: 12 }}>
      {!any ? <p className="small muted" style={{ margin: 0 }}>Nothing to report on today: no delivery has been received yet at a site you are booked on.</p> : (
        <>
          <p className="small muted" style={{ margin: 0 }}>Found something missing or damaged? Tap the item.</p>
          {sites.map((s) => s.dispatches.map((d) => (
            <section key={d.dispatch_id} aria-label={`${s.project}, ${d.business_id}`}>
              <h3 className="flow-subhead">{s.project} <span className="code muted">{d.business_id} · {d.types.join(" + ")}</span></h3>
              <ul className="mnd-items">
                {d.lines.map((l) => {
                  const taken = l.open_complaint ? `Complaint ${l.open_complaint} open` : l.pending_report ? "Reported, waiting for IM" : null;
                  return (
                    <li key={l.item_id}>
                      <button type="button" disabled={!!taken} onClick={() => setLine({ ...l, dispatch: d.business_id })}>
                        <Package size={22} aria-hidden />
                        <span><strong>{l.name}</strong><span className="small muted">{taken ?? `${l.quantity} ${l.unit} delivered`}</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )))}
        </>
      )}
      {mine.length > 0 && (
        <section aria-label="My reports">
          <h3 className="flow-subhead">My reports</h3>
          <ul className="mnd-mine">
            {mine.map((m) => (
              <li key={m.id} data-status={m.status}>
                <span><strong>{m.kind === "missing" ? "Missing" : "Damaged"}: {m.quantity} × {m.item}</strong><span className="small muted">{m.dispatch}</span></span>
                <span className="mnd-status">{m.status === "pending" ? "Waiting for IM" : m.status === "confirmed" ? `Confirmed · ${m.complaint}` : `Not accepted: ${m.decision_reason}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ReportForm({ line, onBack, onSent }: { line: Line & { dispatch: string }; onBack: () => void; onSent: (text: string) => void }) {
  const max = Number(line.quantity);
  const [kind, setKind] = useState<"missing" | "damaged" | "">("");
  const [qty, setQty] = useState(1);
  const [chip, setChip] = useState("");
  const [details, setDetails] = useState("");
  const [photo, setPhoto] = useState<FileState | null>(null);
  const act = useAction(reportMnd, { onSuccess: () => onSent(`${qty} × ${line.name} reported as ${kind}.`) });
  const onPhoto = useCallback((s: FileState) => setPhoto((p) => (p?.draftKey === s.draftKey && p.ready === s.ready && p.pending === s.pending ? p : s)), []);
  const reason = [chip, details.trim()].filter(Boolean).join(". ");
  const missing = !kind ? "Choose Missing or Damaged" : reason.length < 3 ? "Choose or write a reason" : photo?.pending ? "Waiting for the photo to upload…" : !photo?.ready ? "Take a photo to send" : null;
  return (
    <form className="form mnd-form" onSubmit={(e) => { e.preventDefault(); if (!missing) act.run({ itemId: line.item_id, kind, quantity: String(qty), reason, photoDraftKey: photo!.draftKey }); }}>
      <button type="button" className="link back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden /> Choose another item</button>
      <h3 style={{ margin: 0 }}>{line.name} <span className="small muted">({line.quantity} {line.unit} delivered, {line.dispatch})</span></h3>
      <fieldset className="flow-choice">
        <legend>1. What is wrong?</legend>
        <div className="flow-choice-row">
          {(["missing", "damaged"] as const).map((k) => (
            <label key={k} data-on={kind === k || undefined}><input type="radio" name="kind" checked={kind === k} onChange={() => { setKind(k); setChip(""); }} /> {k === "missing" ? "Missing" : "Damaged"}</label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <span className="mnd-label" id="mnd-q">2. How many? ({line.unit})</span>
        <div className="mnd-stepper" role="group" aria-labelledby="mnd-q">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="One less"><Minus size={20} /></button>
          <output aria-live="polite">{qty}</output>
          <button type="button" onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} aria-label="One more"><Plus size={20} /></button>
        </div>
        <span className="small muted">At most {max}, the number that came on this delivery.</span>
      </div>
      {kind && (
        <fieldset className="flow-choice">
          <legend>3. Why?</legend>
          <div className="mnd-chips">{REASONS[kind].map((r) => <button key={r} type="button" aria-pressed={chip === r} onClick={() => setChip(chip === r ? "" : r)}>{r}</button>)}</div>
          <label className="sr-only" htmlFor="mnd-d">More details</label>
          <textarea id="mnd-d" rows={2} maxLength={400} placeholder="More details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
        </fieldset>
      )}
      <FilesField id="mnd-photo" field={{ key: "mnd_photo", label: "4. Photo of the problem", accept: "photo", required: true }} onChange={onPhoto} />
      <button type="submit" className="primary flow-submit" disabled={!!missing || act.pending}>{act.pending ? "Sending…" : missing ?? "Send to Installation Manager"}</button>
      {missing && !act.pending && <p className="small muted mnd-hint"><WarningCircle size={14} aria-hidden /> {missing}</p>}
      <ResultNotice result={act.result} successText="Sent." />
    </form>
  );
}
