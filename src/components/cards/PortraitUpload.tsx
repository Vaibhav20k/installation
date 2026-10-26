"use client";
/** Card portrait (optional): shrunk to 512 px in the browser, stored privately, readable by administrators only. */
import { useRef, useState } from "react";
import { Camera } from "@phosphor-icons/react";
import { linkEvidence } from "@/app/actions";
import { shrinkFile, uploadPhotoNow } from "@/lib/photo-upload";
import { initials } from "./skill-meta";

export function PortraitUpload({ employeeId, name, current, onUploaded }: { employeeId: string; name: string; current: string | null; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [shown, setShown] = useState(current);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const draftKey = crypto.randomUUID();
      const small = await shrinkFile(file, 512, `portrait-${Date.now()}.jpg`);
      const assetId = await uploadPhotoNow(small, draftKey, "employee.portrait");
      const r = await linkEvidence({ draftKey, parentType: "employee_portrait", parentId: employeeId });
      if (!r.ok) throw new Error(r.message);
      setShown(assetId); setMsg({ tone: "ok", text: "Photo updated." }); onUploaded();
    } catch (e) {
      setMsg({ tone: "warn", text: e instanceof Error ? e.message : "The photo could not be uploaded." });
    } finally { setBusy(false); }
  };
  return (
    <div className="row" style={{ alignItems: "center", gap: 14 }}>
      <div className="sc-portrait" style={{ width: 120, margin: 0, aspectRatio: "1 / 1" }}>
        {shown ? <img src={`/api/evidence/file/${shown}`} alt={`Photo of ${name}`} /> : <span className="sc-monogram" style={{ fontSize: 36 }} aria-hidden>{initials(name)}</span>}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-busy={busy}><Camera size={16} aria-hidden /> {busy ? "Uploading…" : shown ? "Change photo" : "Add photo"}</button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        <span className="small muted">Optional. Visible to administrators only.</span>
        {msg && <span className="small" role="status" style={{ color: msg.tone === "ok" ? "var(--ok)" : "var(--warn)" }}>{msg.text}</span>}
      </div>
    </div>
  );
}
