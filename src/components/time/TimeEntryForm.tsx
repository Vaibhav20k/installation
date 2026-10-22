"use client";
import { useId, useRef, useState } from "react";
import { amendTimeEntry, createTimeEntry, updateDraftEntry } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { EvidenceUploader, attachmentNote, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";

export interface EntryDefaults { entryId?: string; version?: number; mode?: "create" | "edit" | "amend"; date?: string; endDate?: string; start?: string; end?: string; activity?: string; projectId?: string | null; visitId?: string | null; overhead?: string | null }

/** Mobile-friendly time entry. Overnight work uses an explicit end date; breaks must lie inside the entry. */
export function TimeEntryForm({ employeeId, timezone, defaultDate, projects, visits, defaults = {}, onDone }: {
  employeeId: string; timezone: string; defaultDate: string; projects: Array<{ id: string; label: string }>; visits: Array<{ id: string; business_id: string; project_id: string }>;
  defaults?: EntryDefaults; onDone?: () => void;
}) {
  const mode = defaults.mode ?? "create";
  const [projectId, setProjectId] = useState(defaults.projectId ?? projects[0]?.id ?? "");
  const [overhead, setOverhead] = useState(!!defaults.overhead);
  const [breaks, setBreaks] = useState<Array<{ start: string; end: string }>>(mode === "create" ? [{ start: "13:00", end: "14:00" }] : []);
  const action = mode === "amend" ? amendTimeEntry : mode === "edit" ? updateDraftEntry : createTimeEntry;
  // One idempotency token per form submission attempt; a successful save starts a fresh token.
  const token = useRef<string | null>(null);
  const draft = useEvidenceDraft(mode === "amend" ? "time.correction" : "time.entry");
  const [linked, setLinked] = useState("");
  const { run, pending, result } = useAction(action, { onSuccess: async (d) => {
    token.current = null;
    const id = (d as { id?: string } | null)?.id ?? defaults.entryId;
    if (id) setLinked(attachmentNote(await draft.attach("time_entry", id)));
    onDone?.();
  } });
  const key = useId().replace(/:/g, "");
  const projectVisits = visits.filter((v) => v.project_id === projectId);
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const startDate = String(f.get("date")), endDate = String(f.get("endDate") || startDate), startTime = String(f.get("start")), endTime = String(f.get("end"));
      // A break before the entry start belongs to the next day for overnight work.
      const breakDate = (t: string) => (endDate !== startDate && t < startTime ? endDate : startDate);
      run({
        ...(mode === "edit" ? { entryId: defaults.entryId, version: defaults.version } : {}),
        ...(mode === "amend" ? { entryId: defaults.entryId, reason: String(f.get("reason")) } : {}),
        ...(mode === "create" ? { idempotencyKey: (token.current ??= `te-${crypto.randomUUID()}`) } : {}),
        employeeId, timezone, activity: String(f.get("activity")),
        projectId: overhead ? undefined : projectId || undefined, visitId: overhead ? undefined : String(f.get("visitId") || "") || undefined,
        overheadCategory: overhead ? String(f.get("overheadCategory")) : undefined,
        start: { date: startDate, time: startTime }, end: { date: endDate, time: endTime },
        breaks: breaks.filter((b) => b.start && b.end).map((b) => ({ start: { date: breakDate(b.start), time: b.start }, end: { date: breakDate(b.end), time: b.end } })),
        note: String(f.get("note") || "") || undefined,
      });
    }}>
      <div className="fields">
        <div className="field"><label htmlFor={`${key}-a`}>Activity</label>
          <select id={`${key}-a`} name="activity" defaultValue={defaults.activity ?? "installation"}>
            <option value="installation">Installation work</option><option value="additional">Authorized additional work</option><option value="rework">Rework</option>
            <option value="travel">Travel</option><option value="waiting">Waiting / site delay</option><option value="other">Other approved activity</option>
          </select></div>
        <label className="check" style={{ alignSelf: "flex-end" }}><input type="checkbox" checked={overhead} onChange={(e) => setOverhead(e.target.checked)} /> Overhead (not a project)</label>
      </div>
      {overhead ? (
        <div className="field"><label htmlFor={`${key}-oh`}>Overhead category</label><select id={`${key}-oh`} name="overheadCategory" defaultValue={defaults.overhead ?? "training"}><option value="training">Training</option><option value="workshop">Workshop</option><option value="admin">Administration</option></select></div>
      ) : (
        <div className="fields">
          <div className="field"><label htmlFor={`${key}-p`}>Project</label><select id={`${key}-p`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
          <div className="field"><label htmlFor={`${key}-v`}>Visit</label><select id={`${key}-v`} name="visitId" defaultValue={defaults.visitId ?? ""}><option value="">No visit</option>{projectVisits.map((v) => <option key={v.id} value={v.id}>{v.business_id}</option>)}</select></div>
        </div>
      )}
      <div className="fields">
        <div className="field"><label htmlFor={`${key}-d`}>Start date</label><input id={`${key}-d`} type="date" name="date" defaultValue={defaults.date ?? defaultDate} required /></div>
        <div className="field"><label htmlFor={`${key}-s`}>Start time</label><input id={`${key}-s`} type="time" name="start" defaultValue={defaults.start ?? "10:00"} required /></div>
        <div className="field"><label htmlFor={`${key}-ed`}>End date</label><input id={`${key}-ed`} type="date" name="endDate" defaultValue={defaults.endDate ?? defaults.date ?? defaultDate} required />
          <span className="hint">Use the next date for work past midnight.</span></div>
        <div className="field"><label htmlFor={`${key}-e`}>End time</label><input id={`${key}-e`} type="time" name="end" defaultValue={defaults.end ?? "19:00"} required /></div>
      </div>
      <fieldset>
        <legend>Breaks</legend>
        {breaks.map((b, i) => (
          <div key={i} className="row">
            <label className="sr-only" htmlFor={`${key}-bs-${i}`}>Break {i + 1} start</label><input id={`${key}-bs-${i}`} type="time" value={b.start} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} style={{ width: 130 }} />
            <span aria-hidden="true">to</span>
            <label className="sr-only" htmlFor={`${key}-be-${i}`}>Break {i + 1} end</label><input id={`${key}-be-${i}`} type="time" value={b.end} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} style={{ width: 130 }} />
            <button type="button" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" onClick={() => setBreaks([...breaks, { start: "", end: "" }])}>Add break</button>
      </fieldset>
      <div className="field"><label htmlFor={`${key}-n`}>Note {mode === "create" && "(required if no booking covers this time)"}</label><textarea id={`${key}-n`} name="note" /></div>
      {mode === "amend" && <div className="field"><label htmlFor={`${key}-r`}>Reason for the correction</label><input id={`${key}-r`} name="reason" required minLength={3} /></div>}
      <EvidenceUploader draft={draft} />
      <button type="submit" className="primary" disabled={pending}>{pending ? "Saving…" : mode === "amend" ? "Save correction as new revision" : mode === "edit" ? "Save draft" : "Save draft entry"}</button>
      <ResultNotice result={result} successText={(mode === "amend" ? "Correction saved as a new revision; any final month covering it is now invalidated for review." : "Saved as draft. Submit it when the day is complete.") + linked} />
    </form>
  );
}
