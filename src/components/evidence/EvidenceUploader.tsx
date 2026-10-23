"use client";
/**
 * Optional photos and videos beside any worker input. Uploads run in the shared queue, so saving the form,
 * switching tabs or clocking out never waits for them. Use with useEvidenceDraft: after the record saves,
 * call attach(parentType, parentId) and the files link to that exact record (now, or when they finish).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowClockwise, Camera, FilmStrip, Image as ImageIcon, Trash, VideoCamera, X } from "@phosphor-icons/react";
import { uploadQueue, type QueueItem } from "@/lib/upload-queue";

const empty: QueueItem[] = [];
function useQueue(draftKey: string) {
  const all = useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot, () => empty);
  return useMemo(() => all.filter((i) => i.draftKey === draftKey), [all, draftKey]);
}

export function useEvidenceDraft(context: string) {
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID());
  const items = useQueue(draftKey);
  /** Link this form's files to the saved record, then start a fresh draft for the next entry. */
  const attach = useCallback(async (parentType: string, parentId: string) => {
    const r = await uploadQueue.attach(draftKey, { parentType, parentId });
    uploadQueue.clearDone(draftKey);
    if (!r.pending) setDraftKey(crypto.randomUUID());
    return r;
  }, [draftKey]);
  return { draftKey, context, items, attach };
}

/** Links the draft's files once the record has saved (id set), and returns the honest note for the success message. */
export function useAttachOnSave(draft: ReturnType<typeof useEvidenceDraft>, parentType: string, id: string | null | undefined) {
  const [note, setNote] = useState("");
  const done = useRef<string | null>(null);
  useEffect(() => { if (id && done.current !== id) { done.current = id; void draft.attach(parentType, id).then((r) => setNote(attachmentNote(r))); } }, [id, draft, parentType]);
  return note;
}

const STATE_TEXT: Record<QueueItem["state"], string> = { queued: "Waiting", uploading: "Uploading", validating: "Checking", ready: "Ready", failed: "Failed", cancelled: "Cancelled" };

/** Collapsed variant for dense places (table rows, quick actions): the controls open on demand. */
export function EvidenceDisclosure({ draft, label = "Add photos or video (optional)" }: { draft: ReturnType<typeof useEvidenceDraft>; label?: string }) {
  return (
    <details className="evidence-disclosure" open={draft.items.length > 0 || undefined}>
      <summary>{label}{draft.items.length ? ` · ${draft.items.length}` : ""}</summary>
      <EvidenceUploader draft={draft} label={label} />
    </details>
  );
}

/** Photos/videos added to a record that already exists (an activity switch, an overtime reason): pick, then attach. */
export function AttachToRecord({ parentType, id, context, label }: { parentType: string; id: string; context: string; label: string }) {
  const draft = useEvidenceDraft(context);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const usable = draft.items.some((i) => i.state !== "failed" && i.state !== "cancelled");
  return (
    <details className="evidence-disclosure">
      <summary>{label}</summary>
      <div className="stack" style={{ gap: 8 }}>
        <EvidenceUploader draft={draft} label={label} />
        <div className="row">
          <button type="button" disabled={!usable || busy} onClick={async () => { setBusy(true); setNote(attachmentNote(await draft.attach(parentType, id)).trim()); setBusy(false); }}>Attach</button>
          {note && <span className="small muted" role="status">{note}</span>}
        </div>
      </div>
    </details>
  );
}

export function EvidenceUploader({ draft, label = "Photos or video (optional)" }: { draft: ReturnType<typeof useEvidenceDraft>; label?: string }) {
  const id = useId();
  const photo = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null), video = useRef<HTMLInputElement>(null), record = useRef<HTMLInputElement>(null);
  const add = (files: FileList | null) => { if (files?.length) uploadQueue.add(draft.draftKey, draft.context, files); };
  const counts = draft.items.reduce((c, i) => ({ ...c, [i.state]: (c[i.state] ?? 0) + 1 }), {} as Record<string, number>);
  const pending = (counts.queued ?? 0) + (counts.uploading ?? 0) + (counts.validating ?? 0);
  return (
    <div className="evidence" role="group" aria-labelledby={`${id}-l`}>
      <div className="evidence-head">
        <span id={`${id}-l`} className="evidence-label">{label}</span>
        <span className="evidence-limits">JPEG, PNG, WebP, HEIC up to 15 MB · MP4, MOV, WebM up to 200 MB · 10 files</span>
      </div>
      <div className="evidence-actions">
        <button type="button" onClick={() => photo.current?.click()}><ImageIcon size={16} aria-hidden /> Add photos</button>
        <button type="button" onClick={() => camera.current?.click()} className="evidence-capture"><Camera size={16} aria-hidden /> Take photo</button>
        <button type="button" onClick={() => video.current?.click()}><FilmStrip size={16} aria-hidden /> Add video</button>
        <button type="button" onClick={() => record.current?.click()} className="evidence-capture"><VideoCamera size={16} aria-hidden /> Record video</button>
        <input ref={photo} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={video} type="file" accept="video/mp4,video/quicktime,video/webm" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={record} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>
      {draft.items.length > 0 && (
        <>
          <ul className="evidence-list">
            {draft.items.map((i) => (
              <li key={i.id} data-state={i.state}>
                <span className="evidence-thumb" aria-hidden>{i.preview ? <img src={i.preview} alt="" /> : <FilmStrip size={20} />}</span>
                <span className="evidence-meta">
                  <span className="evidence-name">{i.name}</span>
                  <span className="evidence-status">
                    {STATE_TEXT[i.state]}{i.state === "uploading" ? ` ${i.progress}%` : ""}{i.error ? `: ${i.error}` : ""}
                  </span>
                  {(i.state === "uploading" || i.state === "queued") && <span className="evidence-bar" aria-hidden><span style={{ transform: `scaleX(${i.progress / 100})` }} /></span>}
                  <input className="evidence-caption" placeholder="Caption (optional)" aria-label={`Caption for ${i.name}`} value={i.caption} maxLength={200} onChange={(e) => uploadQueue.setCaption(i.id, e.target.value)} />
                </span>
                <span className="evidence-item-actions">
                  {i.state === "failed" && <button type="button" className="icon-btn" onClick={() => uploadQueue.retry(i.id)} aria-label={`Retry ${i.name}`}><ArrowClockwise size={16} /></button>}
                  {i.state === "queued" || i.state === "uploading"
                    ? <button type="button" className="icon-btn" onClick={() => uploadQueue.remove(i.id)} aria-label={`Cancel upload of ${i.name}`} title="Cancel upload"><X size={16} /></button>
                    : <button type="button" className="icon-btn" onClick={() => uploadQueue.remove(i.id)} aria-label={`Remove ${i.name}`}><Trash size={16} /></button>}
                </span>
              </li>
            ))}
          </ul>
          <p className="evidence-summary" aria-live="polite">
            {counts.ready ?? 0} ready{pending ? ` · ${pending} uploading` : ""}{counts.failed ? ` · ${counts.failed} failed` : ""}. You can save now; uploads finish in the background.
          </p>
        </>
      )}
    </div>
  );
}

/** After a save: tell the worker honestly what happened to the attachments. */
export function attachmentNote(r: { linked: number; pending: number; error?: string } | null) {
  if (!r) return "";
  if (r.error) return ` Attachments were not linked: ${r.error}`;
  if (r.pending) return ` ${r.linked} attachment${r.linked === 1 ? "" : "s"} linked; ${r.pending} still uploading and will link when done.`;
  return r.linked ? ` ${r.linked} attachment${r.linked === 1 ? "" : "s"} linked.` : "";
}
