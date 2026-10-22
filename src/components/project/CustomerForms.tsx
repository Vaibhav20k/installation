"use client";
/** Customer journey, checklist, communication log and design/measurement requests. Nothing here sends a message. */
import { useEffect, useRef, useState } from "react";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { EvidenceUploader, attachmentNote, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import { addDesignRevision, addObligation, completeObligation, createDesignRequest, decideDesignRequest, logCommunication, setJourney } from "@/app/actions";

const val = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
export const STAGE_LABEL: Record<string, string> = { order_confirmed: "Order confirmed", measurement: "Measurement", design_final: "Design final", dispatch: "Dispatch",
  site_ready: "Site ready", installation: "Installation", handover: "Handover", closed: "Closed" };
const STAGES = Object.keys(STAGE_LABEL);

/** Links attachments once the server returns the saved record's id. */
function useAttachAfterSave(draft: ReturnType<typeof useEvidenceDraft>, parentType: string, id: string | null) {
  const [note, setNote] = useState("");
  const done = useRef<string | null>(null);
  useEffect(() => { if (id && done.current !== id) { done.current = id; void draft.attach(parentType, id).then((r) => setNote(attachmentNote(r))); } }, [id, draft, parentType]);
  return note;
}

export function JourneyForm({ projectId, current, staff }: { projectId: string; current: { stage: string; owner_id: string | null; version: number } | null; staff: Array<{ id: string; name: string }> }) {
  const a = useAction(setJourney);
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ projectId, stage: val(f, "s"), ownerId: val(f, "o"), version: current?.version }); }}>
      <div className="field"><label htmlFor="jr-s">Stage</label><select id="jr-s" name="s" defaultValue={current?.stage ?? "order_confirmed"}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></div>
      <div className="field"><label htmlFor="jr-o">Journey owner</label><select id="jr-o" name="o" defaultValue={current?.owner_id ?? ""}><option value="">Not assigned</option>{staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <button type="submit" style={{ alignSelf: "flex-end" }} disabled={a.pending}>Save</button>
      <ResultNotice result={a.result} successText="Journey updated." />
    </form>
  );
}

export function ObligationForm({ projectId, staff }: { projectId: string; staff: Array<{ id: string; name: string }> }) {
  const a = useAction(addObligation);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ projectId, stage: val(f, "s"), description: val(f, "d"), ownerId: val(f, "o"), dueDate: val(f, "due") }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="ob-s">Stage</label><select id="ob-s" name="s">{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></div>
        <div className="field"><label htmlFor="ob-o">Owner</label><select id="ob-o" name="o"><option value="">Not assigned</option>{staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="field"><label htmlFor="ob-due">Due</label><input id="ob-due" name="due" type="date" /></div>
      </div>
      <div className="field"><label htmlFor="ob-d">What must happen</label><input id="ob-d" name="d" required minLength={3} placeholder="Confirm appliance delivery date with the customer" /></div>
      <div><button type="submit" disabled={a.pending}>Add to checklist</button></div>
      <ResultNotice result={a.result} successText="Added." />
    </form>
  );
}

export function ObligationToggle({ id, status }: { id: string; status: string }) {
  const a = useAction(completeObligation);
  return <button type="button" className="link small" disabled={a.pending} onClick={() => a.run({ id, status: status === "open" ? "done" : "open" })}>{status === "open" ? "Mark done" : "Reopen"}</button>;
}

export function CommunicationForm({ projectId, today }: { projectId: string; today: string }) {
  const draft = useEvidenceDraft("communication.log");
  const a = useAction(logCommunication);
  const note = useAttachAfterSave(draft, "communication_log", a.result?.ok ? (a.result.data as { id: string }).id : null);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ projectId, channel: val(f, "c"), direction: val(f, "dir"), summary: val(f, "s"), commitment: val(f, "cm"), nextAction: val(f, "na"), dueDate: val(f, "due"), acknowledgement: val(f, "ack"), date: val(f, "d"), time: val(f, "t") }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="cl-c">Channel</label><select id="cl-c" name="c">{["call", "visit", "whatsapp", "email", "in_person", "other"].map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</select></div>
        <div className="field"><label htmlFor="cl-dir">Direction</label><select id="cl-dir" name="dir"><option value="to_customer">To customer</option><option value="from_customer">From customer</option><option value="internal">Internal</option></select></div>
        <div className="field"><label htmlFor="cl-d">Date</label><input id="cl-d" name="d" type="date" defaultValue={today} required /></div>
        <div className="field"><label htmlFor="cl-t">Time</label><input id="cl-t" name="t" type="time" required /></div>
      </div>
      <div className="field"><label htmlFor="cl-s">What was said</label><textarea id="cl-s" name="s" rows={2} required minLength={3} /></div>
      <div className="fields">
        <div className="field"><label htmlFor="cl-cm">Commitment made</label><input id="cl-cm" name="cm" /></div>
        <div className="field"><label htmlFor="cl-na">Next action</label><input id="cl-na" name="na" /></div>
        <div className="field"><label htmlFor="cl-due">Due</label><input id="cl-due" name="due" type="date" /></div>
        <div className="field"><label htmlFor="cl-ack">Customer acknowledgement</label><select id="cl-ack" name="ack"><option value="not_requested">Not asked</option><option value="awaiting">Waiting for the customer</option><option value="acknowledged_by_customer">Customer confirmed</option></select></div>
      </div>
      <EvidenceUploader draft={draft} label="Photo or video (optional, for example a site walk-through)" />
      <p className="small muted" style={{ margin: 0 }}>This records a conversation that already happened. The app does not send messages; logging is not proof the customer received anything.</p>
      <div><button type="submit" disabled={a.pending}>Log it</button></div>
      <ResultNotice result={a.result} successText={`Logged.${note}`} />
    </form>
  );
}

export function DesignRequestForm({ projectId, items }: { projectId: string; items: Array<{ id: string; label: string }> }) {
  const draft = useEvidenceDraft("design.request");
  const a = useAction(createDesignRequest);
  const note = useAttachAfterSave(draft, "design_request", a.result?.ok ? (a.result.data as { id: string }).id : null);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const sub = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "submit"; const f = new FormData(e.currentTarget);
      a.run({ projectId, orderItemId: val(f, "oi"), kind: val(f, "k"), origin: val(f, "o"), brief: val(f, "b"), applianceBrief: val(f, "ab"), requestedSkills: val(f, "sk"), reason: val(f, "r"), submit: sub }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="dr-k">Type</label><select id="dr-k" name="k"><option value="design">Design change</option><option value="measurement">Measurement</option></select></div>
        <div className="field"><label htmlFor="dr-o">Asked for by</label><select id="dr-o" name="o"><option value="customer">Customer</option><option value="sales">Sales</option><option value="site_team">Site team</option><option value="designer">Designer</option></select></div>
        <div className="field"><label htmlFor="dr-oi">Product</label><select id="dr-oi" name="oi"><option value="">Whole project</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></div>
        <div className="field"><label htmlFor="dr-sk">Skills needed</label><input id="dr-sk" name="sk" placeholder="Measurement, stone templating…" /></div>
      </div>
      <div className="field"><label htmlFor="dr-b">Brief</label><textarea id="dr-b" name="b" rows={3} required minLength={5} /></div>
      <div className="field"><label htmlFor="dr-ab">Appliance and accessory brief</label><input id="dr-ab" name="ab" /></div>
      <div className="field"><label htmlFor="dr-r">Why</label><input id="dr-r" name="r" required minLength={3} /></div>
      <EvidenceUploader draft={draft} label="Site photos or video (optional)" />
      <div className="row"><button type="submit" value="draft" disabled={a.pending}>Save draft</button><button type="submit" value="submit" className="primary" disabled={a.pending}>Submit</button></div>
      <ResultNotice result={a.result} successText={`Saved ${a.result?.ok ? (a.result.data as { businessId: string }).businessId : ""}.${note}`} />
    </form>
  );
}

export function RevisionForm({ requestId, limit }: { requestId: string; limit: number | null }) {
  const a = useAction(addDesignRevision);
  const r = a.result?.ok ? (a.result.data as { seq: number; needsEscalation: boolean; limitConfigured: boolean }) : null;
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ requestId, cause: val(f, "c"), reason: val(f, "r") }); }}>
      <div className="field"><label htmlFor={`rv-c-${requestId}`}>Cause</label><select id={`rv-c-${requestId}`} name="c"><option value="customer_change">Customer changed the brief</option><option value="sales_change">Sales changed the brief</option><option value="designer_correction">Designer correction</option><option value="site_measurement">Site measurement</option></select></div>
      <div className="field" style={{ flex: 1, minWidth: 180 }}><label htmlFor={`rv-r-${requestId}`}>Reason</label><input id={`rv-r-${requestId}`} name="r" required minLength={3} /></div>
      <button type="submit" style={{ alignSelf: "flex-end" }} disabled={a.pending}>Add revision</button>
      <ResultNotice result={a.result} successText={r ? `Revision ${r.seq} added.${r.needsEscalation ? " Past the approved limit: needs escalation." : ""}${limit === null ? " No revision limit is configured, so nothing is blocked." : ""}` : "Added."} />
    </form>
  );
}

export function DecideDesign({ id }: { id: string }) {
  const a = useAction(decideDesignRequest);
  return (
    <span className="row">
      <button type="button" className="primary" disabled={a.pending} onClick={() => a.run({ requestId: id, decision: "approved" })}>Approve</button>
      <button type="button" className="danger" disabled={a.pending} onClick={() => a.run({ requestId: id, decision: "rejected", note: "Not approved" })}>Reject</button>
      <ResultNotice result={a.result} successText="Decision recorded." />
    </span>
  );
}
