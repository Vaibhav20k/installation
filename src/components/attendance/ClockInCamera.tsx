"use client";
/**
 * Clock-in selfie (required). Opens the front camera with a live preview; if the camera is blocked or missing,
 * the phone's own camera/photo picker is used instead. The photo is shrunk (longest side 960 px) so it uploads in
 * a moment, then the clock-in is sent with it. Clock-out never asks for a photo.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Camera, SignIn, X } from "@phosphor-icons/react";
import { completeEvidenceUpload, createEvidenceUpload } from "@/app/actions";

type Phase = "starting" | "live" | "captured" | "fallback" | "uploading";

async function shrink(source: CanvasImageSource, w: number, h: number): Promise<File> {
  const scale = Math.min(1, 960 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not read the photo"))), "image/jpeg", 0.82));
  return new File([blob], `clock-in-${Date.now()}.jpg`, { type: "image/jpeg" });
}

/** Upload one file now (not via the background queue): clock-in waits for it. */
async function uploadNow(file: File, draftKey: string) {
  const s = await createEvidenceUpload({ draftKey, context: "attendance.clock_in", fileName: file.name, mime: file.type, size: file.size, idempotencyKey: crypto.randomUUID() });
  if (!s.ok) throw new Error(s.message);
  const put = await fetch(s.data.uploadUrl, { method: "PUT", body: file });
  if (!put.ok) throw new Error((await put.json().catch(() => ({ message: "Upload failed" }))).message ?? "Upload failed");
  const done = await completeEvidenceUpload({ sessionId: s.data.sessionId });
  if (!done.ok) throw new Error(done.message);
}

export function ClockInCamera({ label, onClockIn, onCancel }: { label: string; onClockIn: (photoDraftKey: string) => Promise<boolean>; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  const start = async () => {
    setPhase("starting"); setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setPhase("fallback"); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 } }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play(); }
      setPhase("live");
    } catch { setPhase("fallback"); }
  };
  useEffect(() => { void start(); return stop; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const capture = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const f = await shrink(v, v.videoWidth, v.videoHeight);
    stop();
    setPhoto(f); setPreview(URL.createObjectURL(f)); setPhase("captured");
  };
  const picked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const img = await createImageBitmap(file).catch(() => null);
    const f = img ? await shrink(img, img.width, img.height) : file;
    setPhoto(f); setPreview(URL.createObjectURL(f)); setPhase("captured");
  };
  const retake = () => { setPhoto(null); setPreview(null); void start(); };
  const confirm = async () => {
    if (!photo) return;
    setPhase("uploading"); setError(null);
    const key = crypto.randomUUID();
    try {
      await uploadNow(photo, key);
      const ok = await onClockIn(key);
      if (!ok) setPhase("captured");
    } catch (e) { setError((e as Error).message); setPhase("captured"); }
  };

  return (
    <div className="clockin-cam" role="dialog" aria-label="Clock-in photo">
      <div className="clockin-frame">
        {phase === "live" || phase === "starting" ? <video ref={video} muted playsInline aria-label="Front camera preview" /> : null}
        {preview && (phase === "captured" || phase === "uploading") && <img src={preview} alt="Your clock-in photo" />}
        {phase === "fallback" && <p className="small" style={{ margin: 0, padding: 16 }}>The camera could not open here. Use your phone&apos;s camera instead; a photo is required to clock in.</p>}
        {phase === "starting" && <span className="clockin-hint">Opening front camera…</span>}
      </div>
      <input ref={picker} type="file" accept="image/*" capture="user" hidden onChange={(e) => { void picked(e.target.files); e.target.value = ""; }} />
      <div className="clockin-actions">
        {phase === "live" && <button type="button" className="primary clock-btn" onClick={() => void capture()}><Camera size={20} weight="bold" aria-hidden /> Take photo</button>}
        {phase === "fallback" && <button type="button" className="primary clock-btn" onClick={() => picker.current?.click()}><Camera size={20} weight="bold" aria-hidden /> Open camera</button>}
        {(phase === "captured" || phase === "uploading") && <>
          <button type="button" className="primary clock-btn" disabled={phase === "uploading"} aria-busy={phase === "uploading"} onClick={() => void confirm()}>
            <SignIn size={20} weight="bold" aria-hidden /> {phase === "uploading" ? "Saving photo…" : label}
          </button>
          <button type="button" disabled={phase === "uploading"} onClick={retake}><ArrowCounterClockwise size={16} aria-hidden /> Retake</button>
        </>}
        <button type="button" onClick={() => { stop(); onCancel(); }} disabled={phase === "uploading"}><X size={16} aria-hidden /> Cancel</button>
      </div>
      {error && <p className="notice" data-tone="warn" role="alert" style={{ margin: 0 }}>{error}</p>}
      <p className="small muted" style={{ margin: 0 }}>The photo is attached to this clock-in and visible to you and your supervisors. It does not change any recorded time.</p>
    </div>
  );
}
