"use client";
/**
 * One-off photo uploads that the caller waits for (clock-in selfie, skill-card portrait): shrink in the browser,
 * then upload through the private evidence pipeline. Background uploads use the shared queue instead.
 */
import { completeEvidenceUpload, createEvidenceUpload } from "@/app/actions";

/** Longest side `max` px, JPEG: a portrait or selfie never needs the full camera resolution. */
export async function shrinkImage(source: CanvasImageSource, w: number, h: number, max: number, name: string): Promise<File> {
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not read the photo"))), "image/jpeg", 0.82));
  return new File([blob], name, { type: "image/jpeg" });
}

/** Decodes a picked image file so it can be shrunk. */
export async function shrinkFile(file: File, max: number, name: string) {
  const bmp = await createImageBitmap(file);
  try { return await shrinkImage(bmp, bmp.width, bmp.height, max, name); } finally { bmp.close(); }
}

/** Uploads one file now; resolves with the asset id once the server has checked its contents. */
export async function uploadPhotoNow(file: File, draftKey: string, context: string) {
  const s = await createEvidenceUpload({ draftKey, context, fileName: file.name, mime: file.type, size: file.size, idempotencyKey: crypto.randomUUID() });
  if (!s.ok) throw new Error(s.message);
  const put = await fetch(s.data.uploadUrl, { method: "PUT", body: file });
  if (!put.ok) throw new Error((await put.json().catch(() => ({ message: "Upload failed" }))).message ?? "Upload failed");
  const done = await completeEvidenceUpload({ sessionId: s.data.sessionId });
  if (!done.ok) throw new Error(done.message);
  return s.data.assetId;
}
