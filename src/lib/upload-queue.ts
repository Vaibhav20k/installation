/**
 * One bounded evidence upload queue per browser tab, kept outside React so it survives route changes and
 * never re-renders the attendance timer. Bytes stay in the File object, never in React state or JSON.
 * A reload loses files that were only selected locally; server-completed uploads stay linked (honest limit).
 */
import { completeEvidenceUpload, createEvidenceUpload, linkEvidence, removeDraftEvidence } from "@/app/actions";

export type ItemState = "queued" | "uploading" | "validating" | "ready" | "failed" | "cancelled";
export interface QueueItem {
  id: string; draftKey: string; context: string; file: File; name: string; mediaType: "image" | "video"; preview: string | null;
  state: ItemState; progress: number; error: string | null; assetId: string | null; sessionId: string | null; caption: string; idempotencyKey: string;
}
interface Parent { parentType: string; parentId: string }

const MAX_PARALLEL = 2;
const items = new Map<string, QueueItem>();
const parents = new Map<string, Parent>();
const xhrs = new Map<string, XMLHttpRequest>();
const listeners = new Set<() => void>();
let snapshot: QueueItem[] = [];

function emit() { snapshot = [...items.values()]; listeners.forEach((l) => l()); }
function set(id: string, patch: Partial<QueueItem>) { const it = items.get(id); if (it) { items.set(id, { ...it, ...patch }); emit(); } }

export const uploadQueue = {
  subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
  getSnapshot() { return snapshot; },
  add(draftKey: string, context: string, files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const mediaType = file.type.startsWith("video/") ? "video" : "image";
      const id = crypto.randomUUID();
      items.set(id, { id, draftKey, context, file, name: file.name, mediaType, preview: mediaType === "image" ? URL.createObjectURL(file) : null,
        state: "queued", progress: 0, error: null, assetId: null, sessionId: null, caption: "", idempotencyKey: crypto.randomUUID() });
    }
    emit(); pump();
  },
  retry(id: string) { const it = items.get(id); if (it && it.state === "failed") { set(id, { state: "queued", error: null, progress: 0 }); pump(); } },
  async remove(id: string) {
    const it = items.get(id);
    if (!it) return;
    xhrs.get(id)?.abort();
    if (it.assetId && it.state === "ready" && !parents.has(it.draftKey)) await removeDraftEvidence({ assetId: it.assetId });
    if (it.preview) URL.revokeObjectURL(it.preview);
    items.delete(id); emit();
  },
  setCaption(id: string, caption: string) { set(id, { caption }); },
  /** The form saved: link what is ready now; anything still uploading links itself when it finishes. */
  async attach(draftKey: string, parent: Parent) {
    parents.set(draftKey, parent);
    const ready = [...items.values()].filter((i) => i.draftKey === draftKey);
    if (!ready.length) return { linked: 0, pending: 0 };
    const captions = Object.fromEntries(ready.filter((i) => i.assetId && i.caption).map((i) => [i.assetId!, i.caption]));
    const r = await linkEvidence({ draftKey, ...parent, captions });
    const pending = ready.filter((i) => ["queued", "uploading", "validating"].includes(i.state)).length;
    return r.ok ? { linked: r.data.linked, pending } : { linked: 0, pending, error: r.message };
  },
  forDraft(draftKey: string) { return snapshot.filter((i) => i.draftKey === draftKey); },
  /** Clear finished items of a saved form (keeps failed ones visible for retry). */
  clearDone(draftKey: string) {
    for (const it of [...items.values()]) if (it.draftKey === draftKey && it.state === "ready") { if (it.preview) URL.revokeObjectURL(it.preview); items.delete(it.id); }
    emit();
  },
};

function pump() {
  const active = [...items.values()].filter((i) => i.state === "uploading" || i.state === "validating").length;
  const next = [...items.values()].filter((i) => i.state === "queued").slice(0, Math.max(0, MAX_PARALLEL - active));
  for (const it of next) void upload(it.id);
}

async function upload(id: string) {
  const it = items.get(id);
  if (!it) return;
  set(id, { state: "uploading", progress: 0 });
  try {
    const created = await createEvidenceUpload({ draftKey: it.draftKey, context: it.context, fileName: it.name, mime: it.file.type || "application/octet-stream",
      size: it.file.size, idempotencyKey: it.idempotencyKey, capturedAt: it.file.lastModified || undefined });
    if (!created.ok) throw new Error(created.message);
    set(id, { assetId: created.data.assetId, sessionId: created.data.sessionId });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrs.set(id, xhr);
      xhr.open("PUT", created.data.uploadUrl);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) set(id, { progress: Math.round((e.loaded / e.total) * 100) }); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else { try { reject(new Error(JSON.parse(xhr.responseText).message)); } catch { reject(new Error(`Upload failed (${xhr.status})`)); } }
      };
      xhr.onerror = () => reject(new Error("Network error. Check the connection and retry."));
      xhr.onabort = () => reject(new Error("cancelled"));
      xhr.send(it.file);
    }).finally(() => xhrs.delete(id));
    set(id, { state: "validating", progress: 100 });
    const done = await completeEvidenceUpload({ sessionId: created.data.sessionId });
    if (!done.ok) throw new Error(done.message);
    set(id, { state: "ready" });
    const parent = parents.get(it.draftKey);
    if (parent) {
      const cur = items.get(id);
      await linkEvidence({ draftKey: it.draftKey, ...parent, captions: cur?.assetId && cur.caption ? { [cur.assetId]: cur.caption } : undefined });
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (items.has(id)) set(id, msg === "cancelled" ? { state: "cancelled" } : { state: "failed", error: msg });
  } finally {
    pump();
  }
}
