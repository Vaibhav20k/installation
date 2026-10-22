"use client";
import { useState } from "react";
import { requestOvertime, submitTimeEntries } from "@/app/actions";
import { ActionButton } from "@/components/ui/ActionButton";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { EvidenceUploader, attachmentNote, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import { TimeEntryForm } from "./TimeEntryForm";

interface Entry { id: string; state: string; version: number; date: string; endDate: string; start: string; end: string; activity: string; projectId: string | null; visitId: string | null; overhead: string | null; timezone: string }

export function EntryActions({ entry, employeeId, canAct }: { entry: Entry; employeeId: string; canAct: boolean }) {
  const [mode, setMode] = useState<null | "ot" | "amend">(null);
  const otDraft = useEvidenceDraft("overtime.request");
  const [otLinked, setOtLinked] = useState("");
  const ot = useAction(requestOvertime, { onSuccess: async (d) => setOtLinked(attachmentNote(await otDraft.attach("ot_request", (d as { id: string }).id))) });
  if (!canAct) return null;
  return (
    <div className="stack" style={{ gap: 4, minWidth: 140 }}>
      {entry.state === "draft" && <ActionButton action={submitTimeEntries} input={{ entryIds: [entry.id] }} label="Submit" successText="Submitted for review." />}
      {["submitted", "accepted", "returned"].includes(entry.state) && <button type="button" className="link" onClick={() => setMode(mode === "amend" ? null : "amend")} aria-expanded={mode === "amend"}>Correct…</button>}
      {["installation", "additional", "rework"].includes(entry.activity) && entry.state !== "voided" && <button type="button" className="link" onClick={() => setMode(mode === "ot" ? null : "ot")} aria-expanded={mode === "ot"}>Request overtime review…</button>}
      {mode === "ot" && (
        <form className="form" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          const s = String(f.get("s")), en = String(f.get("e"));
          ot.run({ entryId: entry.id, timezone: entry.timezone, claimedReason: String(f.get("r")),
            start: { date: entry.endDate !== entry.date && s < entry.start ? entry.endDate : entry.date, time: s }, end: { date: entry.endDate !== entry.date && en <= entry.start ? entry.endDate : entry.date, time: en } });
        }}>
          <div className="row">
            <label className="sr-only" htmlFor={`ots-${entry.id}`}>From</label><input id={`ots-${entry.id}`} name="s" type="time" defaultValue={entry.end > "19:00" ? "19:00" : entry.start} required style={{ width: 120 }} />
            <label className="sr-only" htmlFor={`ote-${entry.id}`}>To</label><input id={`ote-${entry.id}`} name="e" type="time" defaultValue={entry.end} required style={{ width: 120 }} />
          </div>
          <label className="sr-only" htmlFor={`otr-${entry.id}`}>Why the extra time was needed</label>
          <input id={`otr-${entry.id}`} name="r" placeholder="Why was extra time needed?" required minLength={3} />
          <EvidenceUploader draft={otDraft} />
          <button type="submit" disabled={ot.pending}>Send for review</button>
          <ResultNotice result={ot.result} successText={`Request sent. A reviewer verifies the reason; the confirmed catch-up rule cannot be overridden. Evidence never grants approval.${otLinked}`} />
        </form>
      )}
      {mode === "amend" && (
        <div className="card" style={{ minWidth: 320 }}>
          <TimeEntryForm employeeId={employeeId} timezone={entry.timezone} defaultDate={entry.date} projects={entry.projectId ? [{ id: entry.projectId, label: "Same project" }] : []} visits={entry.visitId && entry.projectId ? [{ id: entry.visitId, business_id: "Same visit", project_id: entry.projectId }] : []}
            defaults={{ mode: "amend", entryId: entry.id, date: entry.date, endDate: entry.endDate, start: entry.start, end: entry.end, activity: entry.activity, projectId: entry.projectId, visitId: entry.visitId, overhead: entry.overhead }} onDone={() => setMode(null)} />
        </div>
      )}
    </div>
  );
}
