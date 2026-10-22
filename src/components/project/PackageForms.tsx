"use client";
/**
 * Package manifest, scanning and exceptions. Typing the code always works; the camera scanner is loaded only when
 * asked for and only where the browser supports barcode detection. Repeat scans are harmless (one event id each tap).
 */
import { useEffect, useRef, useState } from "react";
import { Barcode, Camera, X } from "@phosphor-icons/react";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { EvidenceUploader, attachmentNote, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import { addPackage, decidePackageException, raisePackageException, recordScan } from "@/app/actions";

const val = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };

export function AddPackageForm({ projectId, orders }: { projectId: string; orders: Array<{ id: string; label: string }> }) {
  const a = useAction(addPackage);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ projectId, orderId: val(f, "o"), code: val(f, "c"), loadRef: val(f, "l"), description: val(f, "d"), expectedContents: val(f, "ec"), weightKg: val(f, "w") ? Number(val(f, "w")) : undefined, highValue: f.get("hv") === "on" }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="pk-o">Order</label><select id="pk-o" name="o">{orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        <div className="field"><label htmlFor="pk-c">Package code</label><input id="pk-c" name="c" required pattern="[A-Za-z0-9\-_.]{3,40}" autoCapitalize="characters" /></div>
        <div className="field"><label htmlFor="pk-l">Load / shipment</label><input id="pk-l" name="l" /></div>
        <div className="field"><label htmlFor="pk-w">Weight (kg, optional)</label><input id="pk-w" name="w" inputMode="decimal" /></div>
      </div>
      <div className="field"><label htmlFor="pk-d">Description</label><input id="pk-d" name="d" required /></div>
      <div className="field"><label htmlFor="pk-ec">Expected contents (optional item list)</label><input id="pk-ec" name="ec" /></div>
      <label className="check"><input type="checkbox" name="hv" /> Contains high-value items</label>
      <div><button type="submit" disabled={a.pending}>Add to manifest</button></div>
      <ResultNotice result={a.result} successText="Added." />
    </form>
  );
}

interface Detector { detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>> }

/** Camera scanner, created only on demand. Falls back to typing when unsupported or when camera access is denied. */
function CameraScan({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState("Starting camera…");
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false;
    const W = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector };
    if (!W.BarcodeDetector) { setMsg("This browser cannot read codes with the camera. Type the code instead."); return; }
    const det = new W.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(async (s) => {
      stream = s;
      if (!video.current) return;
      video.current.srcObject = s; await video.current.play(); setMsg("Point the camera at the package code.");
      const tick = async () => {
        if (stop || !video.current) return;
        try { const r = await det.detect(video.current); if (r[0]?.rawValue) { onCode(r[0].rawValue); return; } } catch { /* keep trying */ }
        setTimeout(tick, 250);
      };
      void tick();
    }).catch(() => setMsg("Camera access was not allowed. Type the code instead."));
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div className="scan-cam">
      <video ref={video} muted playsInline aria-label="Camera view for scanning" />
      <p className="small" role="status">{msg}</p>
      <button type="button" onClick={onClose}><X size={16} aria-hidden /> Close camera</button>
    </div>
  );
}

export function ScanBox({ projectId, kinds = ["receipt", "damage"] }: { projectId: string; kinds?: Array<"dispatch" | "receipt" | "damage"> }) {
  const a = useAction(recordScan);
  const [kind, setKind] = useState(kinds[0]!);
  const [code, setCode] = useState("");
  const [cam, setCam] = useState(false);
  const send = (c: string, method: "camera" | "manual") => { if (c.trim()) a.run({ projectId, code: c.trim(), kind, clientEventId: crypto.randomUUID(), method }); setCode(""); setCam(false); };
  const r = a.result?.ok ? (a.result.data as { known: boolean; duplicate: boolean; exceptionId: string | null }) : null;
  return (
    <div className="stack">
      <div className="row">
        <div className="field"><label htmlFor="sc-k">Scan type</label><select id="sc-k" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{kinds.map((k) => <option key={k} value={k}>{k === "receipt" ? "Received on site" : k === "damage" ? "Damaged" : "Dispatched"}</option>)}</select></div>
        <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); send(code, "manual"); }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}><label htmlFor="sc-c">Package code</label><input id="sc-c" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoCorrect="off" enterKeyHint="send" /></div>
          <button type="submit" className="primary" style={{ alignSelf: "flex-end" }} disabled={a.pending || !code.trim()}><Barcode size={16} aria-hidden /> Record</button>
        </form>
        <button type="button" style={{ alignSelf: "flex-end" }} onClick={() => setCam(true)}><Camera size={16} aria-hidden /> Scan with camera</button>
      </div>
      {cam && <CameraScan onCode={(c) => send(c, "camera")} onClose={() => setCam(false)} />}
      <ResultNotice result={a.result} successText={r ? (r.duplicate ? "Already recorded; not counted again." : r.known ? (r.exceptionId ? "Damage recorded and an exception opened." : "Recorded. A received box does not confirm its contents.") : "That code is not in the manifest; kept as an unknown-scan exception.") : "Recorded."} />
    </div>
  );
}

export function PackageExceptionForm({ projectId, packages }: { projectId: string; packages: Array<{ id: string; code: string }> }) {
  const draft = useEvidenceDraft("package.exception");
  const a = useAction(raisePackageException);
  const [note, setNote] = useState("");
  const done = useRef<string | null>(null);
  const id = a.result?.ok ? (a.result.data as { id: string }).id : null;
  useEffect(() => { if (id && done.current !== id) { done.current = id; void draft.attach("package_exception", id).then((r) => setNote(attachmentNote(r))); } }, [id, draft]);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ projectId, packageId: val(f, "p"), kind: val(f, "k"), description: val(f, "d"), replacementRequested: f.get("rr") === "on" }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="px-p">Package</label><select id="px-p" name="p"><option value="">Not in the manifest / unknown</option>{packages.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></div>
        <div className="field"><label htmlFor="px-k">Problem</label><select id="px-k" name="k"><option value="shortage">Item missing</option><option value="damage">Damaged</option><option value="contents_mismatch">Contents differ</option><option value="receipt_unverified">Not received yet</option></select></div>
      </div>
      <div className="field"><label htmlFor="px-d">What exactly</label><input id="px-d" name="d" required minLength={3} /></div>
      <label className="check"><input type="checkbox" name="rr" /> Request a replacement</label>
      <EvidenceUploader draft={draft} label="Photos or video of the package (optional)" />
      <p className="small muted" style={{ margin: 0 }}>Evidence supports the investigation; it does not prove who is responsible or what was inside.</p>
      <div><button type="submit" disabled={a.pending}>Report</button></div>
      <ResultNotice result={a.result} successText={`Reported ${a.result?.ok ? (a.result.data as { businessId: string }).businessId : ""}.${note}`} />
    </form>
  );
}

export function DecidePackage({ id }: { id: string }) {
  const a = useAction(decidePackageException);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ id, responsibleFunction: val(f, "fn"), rootCause: val(f, "rc"), replacementStatus: val(f, "rs"), chargeType: val(f, "ct"), resolve: f.get("res") === "on" }); }}>
      <div className="fields">
        <div className="field"><label htmlFor={`dp-f-${id}`}>Responsible function</label><select id={`dp-f-${id}`} name="fn"><option value="">Not assessed</option>{["Factory", "Purchase", "Logistics", "Services", "Site", "Installation", "Customer"].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label htmlFor={`dp-rs-${id}`}>Replacement</label><select id={`dp-rs-${id}`} name="rs"><option value="">No change</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="delivered">Delivered</option></select></div>
        <div className="field"><label htmlFor={`dp-ct-${id}`}>Charge</label><select id={`dp-ct-${id}`} name="ct"><option value="">Not decided</option><option value="free_of_charge">Free of charge</option><option value="chargeable">Chargeable</option><option value="not_applicable">Not applicable</option></select></div>
      </div>
      <div className="field"><label htmlFor={`dp-rc-${id}`}>Root cause</label><input id={`dp-rc-${id}`} name="rc" /></div>
      <label className="check"><input type="checkbox" name="res" /> Mark resolved</label>
      <div><button type="submit" disabled={a.pending}>Save decision</button></div>
      <ResultNotice result={a.result} successText="Saved." />
    </form>
  );
}
