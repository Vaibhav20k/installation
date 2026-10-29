"use client";
/**
 * The current step's form, drawn from the flow definition: the owner fills in the stage's fields and adds its
 * files, and the server checks everything again. Files must finish uploading before the step can be completed
 * (an invoice or a damage photo is part of the record, not an optional extra). Big targets for phone use on site.
 */
import { useEffect, useState } from "react";
import { Camera, FilePdf, Image as ImageIcon, Trash, ArrowClockwise } from "@phosphor-icons/react";
import { advanceComplaint, advanceDispatch, moveComplaintBack, moveDispatchBack } from "@/app/actions";
import { useAction, type ActionResult } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import { uploadQueue } from "@/lib/upload-queue";
import type { FieldSpec, StageSpec } from "@/domain/flow";

export interface FileState { draftKey: string; ready: number; pending: number }

/** One files field: take or pick photos (and PDFs where the stage accepts documents). */
export function FilesField({ id, field, onChange }: { id: string; field: Pick<FieldSpec, "key" | "label" | "accept" | "required" | "minFiles">; onChange: (s: FileState) => void }) {
  const draft = useEvidenceDraft(`flow.${field.key}`);
  const ready = draft.items.filter((i) => i.state === "ready").length;
  const pending = draft.items.filter((i) => i.state === "queued" || i.state === "uploading" || i.state === "validating").length;
  useEffect(() => { onChange({ draftKey: draft.draftKey, ready, pending }); }, [draft.draftKey, ready, pending, onChange]);
  const add = (files: FileList | null) => { if (files?.length) uploadQueue.add(draft.draftKey, draft.context, files); };
  const docs = field.accept === "document" || field.accept === "photo_or_document";
  const photos = field.accept !== "document";
  return (
    <fieldset className="flow-files" aria-describedby={`${id}-st`}>
      <legend>{field.label}{field.required ? "" : " (optional)"}</legend>
      <div className="flow-file-actions">
        {photos && <label className="button"><Camera size={18} aria-hidden /> Take photo<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} /></label>}
        {photos && <label className="button"><ImageIcon size={18} aria-hidden /> Choose photo<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} /></label>}
        {docs && <label className="button"><FilePdf size={18} aria-hidden /> Choose PDF<input type="file" accept="application/pdf" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} /></label>}
      </div>
      {draft.items.length > 0 && (
        <ul className="flow-file-list">
          {draft.items.map((i) => (
            <li key={i.id} data-state={i.state}>
              {i.preview ? <img src={i.preview} alt="" /> : <FilePdf size={22} aria-hidden />}
              <span className="flow-file-name">{i.name}<span className="small muted">{i.state === "ready" ? "Uploaded" : i.state === "failed" ? `Failed${i.error ? `: ${i.error}` : ""}` : i.state === "uploading" ? `Uploading ${i.progress}%` : "Checking…"}</span></span>
              {i.state === "failed" && <button type="button" className="icon-btn" onClick={() => uploadQueue.retry(i.id)} aria-label={`Retry ${i.name}`}><ArrowClockwise size={16} /></button>}
              <button type="button" className="icon-btn" onClick={() => uploadQueue.remove(i.id)} aria-label={`Remove ${i.name}`}><Trash size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      <p id={`${id}-st`} className="small muted" aria-live="polite" style={{ margin: 0 }}>
        {pending ? `${pending} still uploading. ` : ""}{ready ? `${ready} ready.` : field.required ? `At least ${field.minFiles ?? 1} needed.` : ""}
      </p>
    </fieldset>
  );
}

function shown(f: FieldSpec, values: Record<string, string>) {
  return !f.requiredWhen || values[f.requiredWhen.field] === f.requiredWhen.equals;
}

export function StageForm({ kind, id, version, stage, cta }: { kind: "dispatch" | "complaint"; id: string; version: number; stage: StageSpec; cta?: string }) {
  const act = useAction((kind === "dispatch" ? advanceDispatch : advanceComplaint) as (input: unknown) => Promise<ActionResult<unknown>>);
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));
  const fileFields = stage.fields.filter((f) => f.type === "files");
  const waiting = fileFields.some((f) => (files[f.key]?.pending ?? 0) > 0);
  const missing = fileFields.some((f) => f.required && (files[f.key]?.ready ?? 0) < (f.minFiles ?? 1));
  return (
    <form className="form flow-form" onSubmit={(e) => {
      e.preventDefault();
      const payload = { version, stage: stage.code, values: Object.fromEntries(Object.entries(values).filter(([k]) => { const f = stage.fields.find((x) => x.key === k); return f && shown(f, values); })),
        files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.draftKey])) };
      act.run(kind === "dispatch" ? { dispatchId: id, ...payload } : { complaintId: id, ...payload });
    }}>
      {stage.fields.filter((f) => shown(f, values)).map((f) => {
        const fid = `sf-${stage.code}-${f.key}`;
        const req = !!f.required || !!f.requiredWhen;
        if (f.type === "files") return <FilesField key={f.key} id={fid} field={f} onChange={(s) => setFiles((x) => (x[f.key]?.draftKey === s.draftKey && x[f.key]?.ready === s.ready && x[f.key]?.pending === s.pending ? x : { ...x, [f.key]: s }))} />;
        if (f.type === "select" && (f.options?.length ?? 0) <= 3) return (
          <fieldset key={f.key} className="flow-choice">
            <legend>{f.label}</legend>
            <div className="flow-choice-row">{f.options!.map((o) => (
              <label key={o.value} data-on={values[f.key] === o.value || undefined}><input type="radio" name={f.key} value={o.value} required={req} checked={values[f.key] === o.value} onChange={() => set(f.key, o.value)} /> {o.label}</label>
            ))}</div>
          </fieldset>
        );
        return (
          <div key={f.key} className="field">
            <label htmlFor={fid}>{f.label}{req ? "" : " (optional)"}</label>
            {f.type === "select" ? (
              <select id={fid} required={req} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}><option value="">Choose…</option>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            ) : f.type === "longtext" ? (
              <textarea id={fid} rows={3} required={req} maxLength={2000} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <input id={fid} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} pattern={f.type === "number" ? "\\d+(\\.\\d{1,2})?" : undefined}
                required={req} maxLength={300} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            )}
            {f.help && <span className="small muted">{f.help}</span>}
          </div>
        );
      })}
      <button type="submit" className="primary flow-submit" disabled={act.pending || waiting || missing}>
        {act.pending ? "Saving…" : waiting ? "Waiting for uploads…" : cta ?? `Complete: ${stage.label}`}
      </button>
      <ResultNotice result={act.result} successText="Saved. The next owner has been notified." />
    </form>
  );
}

export function BackForm({ kind, id, version, stage, targets }: { kind: "dispatch" | "complaint"; id: string; version: number; stage: string; targets: Array<{ code: string; label: string }> }) {
  const act = useAction((kind === "dispatch" ? moveDispatchBack : moveComplaintBack) as (input: unknown) => Promise<ActionResult<unknown>>);
  return (
    <details className="flow-back">
      <summary>Send back to an earlier step</summary>
      <form className="form" onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        const base = { version, stage, to: String(f.get("to")), reason: String(f.get("reason")) };
        act.run(kind === "dispatch" ? { dispatchId: id, ...base } : { complaintId: id, ...base });
      }}>
        <div className="field"><label htmlFor={`bk-${id}`}>Back to</label><select id={`bk-${id}`} name="to" required>{targets.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></div>
        <div className="field"><label htmlFor={`bkr-${id}`}>Reason (required)</label><textarea id={`bkr-${id}`} name="reason" rows={2} required minLength={3} maxLength={500} /></div>
        <button type="submit" disabled={act.pending}>{act.pending ? "Sending…" : "Send back"}</button>
        <ResultNotice result={act.result} successText="Sent back. That step's owner has been notified." />
      </form>
    </details>
  );
}
