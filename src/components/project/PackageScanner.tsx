"use client";
/** Camera barcode scanner for package codes. Falls back to typing when unsupported or when camera access is denied. */
import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";

interface Detector { detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>> }

/** Camera scanner, created only on demand. Falls back to typing when unsupported or when camera access is denied. */
export function CameraScan({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
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
