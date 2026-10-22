"use client";
/** Additional-work request (any crew member on the job) and the manager decisions on scope and charges. */
import { useEffect, useRef, useState } from "react";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { EvidenceUploader, attachmentNote, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import { decideAdditionalWork, requestAdditionalWork, setInstallationCharge } from "@/app/actions";
import { rupeesToMinor } from "@/lib/format";

const val = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };

export function AdditionalWorkForm({ projectId, orders, visitId }: { projectId: string; orders: Array<{ id: string; label: string }>; visitId?: string }) {
  const draft = useEvidenceDraft("additional_work.request");
  const a = useAction(requestAdditionalWork);
  const [note, setNote] = useState("");
  const done = useRef<string | null>(null);
  const id = a.result?.ok ? (a.result.data as { id: string }).id : null;
  useEffect(() => { if (id && done.current !== id) { done.current = id; void draft.attach("additional_work", id).then((r) => setNote(attachmentNote(r))); } }, [id, draft]);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ projectId, orderId: val(f, "o"), visitId, description: val(f, "d"), requestedBy: val(f, "by"), reason: val(f, "r"), estimatedMinutes: val(f, "m") ? Number(val(f, "m")) : undefined }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="aw-o">Order</label><select id="aw-o" name="o">{orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        <div className="field"><label htmlFor="aw-by">Asked for by</label><select id="aw-by" name="by"><option value="customer">Customer</option><option value="sales">Sales</option><option value="site_team">Site team</option><option value="design">Design</option><option value="other">Other</option></select></div>
        <div className="field"><label htmlFor="aw-m">Estimated minutes (optional)</label><input id="aw-m" name="m" type="number" inputMode="numeric" min={0} max={100000} /></div>
      </div>
      <div className="field"><label htmlFor="aw-d">What extra work</label><input id="aw-d" name="d" required minLength={5} placeholder="For example: extra wall shelf beside the fridge" /></div>
      <div className="field"><label htmlFor="aw-r">Why</label><input id="aw-r" name="r" required minLength={3} /></div>
      <EvidenceUploader draft={draft} />
      <p className="small muted" style={{ margin: 0 }}>A manager approves it and decides whether it is charged. Do not start chargeable extra work before approval.</p>
      <div><button type="submit" className="primary" disabled={a.pending}>Send request</button></div>
      <ResultNotice result={a.result} successText={`Request ${a.result?.ok ? (a.result.data as { businessId: string }).businessId : ""} sent.${note}`} />
    </form>
  );
}

export function DecideAdditionalWork({ id }: { id: string }) {
  const a = useAction(decideAdditionalWork);
  const [charge, setCharge] = useState("chargeable");
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ id, decision: "approved", chargeType: charge, quotedAmountMinor: val(f, "q") ? rupeesToMinor(val(f, "q")!) : undefined, commercialRef: val(f, "cr"), plannedCostMinor: val(f, "pc") ? rupeesToMinor(val(f, "pc")!) : undefined, note: val(f, "n") }); }}>
      <div className="fields">
        <div className="field"><label htmlFor={`dc-c-${id}`}>Charge</label><select id={`dc-c-${id}`} value={charge} onChange={(e) => setCharge(e.target.value)}><option value="chargeable">Chargeable</option><option value="free_of_charge">Free of charge</option><option value="waived">Waived</option></select></div>
        {charge === "chargeable" && <div className="field"><label htmlFor={`dc-q-${id}`}>Quoted (₹)</label><input id={`dc-q-${id}`} name="q" inputMode="decimal" required pattern="\d+(\.\d{1,2})?" /></div>}
        <div className="field"><label htmlFor={`dc-cr-${id}`}>Commercial reference</label><input id={`dc-cr-${id}`} name="cr" /></div>
        <div className="field"><label htmlFor={`dc-pc-${id}`}>Planned internal cost (₹)</label><input id={`dc-pc-${id}`} name="pc" inputMode="decimal" pattern="\d+(\.\d{1,2})?" /></div>
      </div>
      <div className="field"><label htmlFor={`dc-n-${id}`}>Note</label><input id={`dc-n-${id}`} name="n" /></div>
      <div className="row"><button type="submit" className="primary" disabled={a.pending}>Approve</button>
        <button type="button" className="danger" disabled={a.pending} onClick={() => a.run({ id, decision: "rejected", note: "Not approved" })}>Reject</button></div>
      <ResultNotice result={a.result} successText="Decision recorded." />
    </form>
  );
}

export function ChargeForm({ projectId, orders }: { projectId: string; orders: Array<{ id: string; label: string }> }) {
  const a = useAction(setInstallationCharge);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ projectId, orderId: val(f, "o"), quotedMinor: rupeesToMinor(val(f, "q") ?? "0"), waivedMinor: val(f, "w") ? rupeesToMinor(val(f, "w")!) : 0, source: val(f, "s"), reference: val(f, "r") }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="ch-o">Order</label><select id="ch-o" name="o">{orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        <div className="field"><label htmlFor="ch-q">Quoted installation charge (₹)</label><input id="ch-q" name="q" inputMode="decimal" required pattern="\d+(\.\d{1,2})?" /></div>
        <div className="field"><label htmlFor="ch-w">Waived (₹)</label><input id="ch-w" name="w" inputMode="decimal" pattern="\d+(\.\d{1,2})?" /></div>
        <div className="field"><label htmlFor="ch-s">Source</label><input id="ch-s" name="s" required placeholder="Quotation, contract…" /></div>
        <div className="field"><label htmlFor="ch-r">Reference</label><input id="ch-r" name="r" /></div>
      </div>
      <div><button type="submit" disabled={a.pending}>Save charge</button></div>
      <ResultNotice result={a.result} successText="Saved. The previous figure stays in history." />
    </form>
  );
}
