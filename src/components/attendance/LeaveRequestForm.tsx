"use client";
/** Leave or emergency unavailability request. Photos/videos are optional and visible only to the decision chain. */
import { useState } from "react";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { EvidenceUploader, attachmentNote, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import { requestLeave } from "@/app/actions";

export function LeaveRequestForm({ today }: { today: string }) {
  const draft = useEvidenceDraft("leave.request");
  const [linked, setLinked] = useState("");
  const act = useAction(requestLeave, { onSuccess: async (d) => setLinked(attachmentNote(await draft.attach("leave_request", (d as { id: string }).id))) });
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      act.run({ kind: f.get("kind"), startDate: f.get("start"), endDate: f.get("end"), reason: f.get("reason") });
    }}>
      <div className="grid cols-3">
        <div className="field"><label htmlFor="lr-k">Type</label><select id="lr-k" name="kind"><option value="leave">Leave</option><option value="emergency_unavailability">Emergency unavailability</option></select></div>
        <div className="field"><label htmlFor="lr-s">From</label><input id="lr-s" name="start" type="date" defaultValue={today} required /></div>
        <div className="field"><label htmlFor="lr-e">To</label><input id="lr-e" name="end" type="date" defaultValue={today} required /></div>
      </div>
      <div className="field"><label htmlFor="lr-r">Reason</label><input id="lr-r" name="reason" required minLength={3} maxLength={500} /></div>
      <EvidenceUploader draft={draft} label="Supporting photo or video (optional, private)" />
      <p className="small muted" style={{ margin: 0 }}>Only your manager chain and administrators see this request and its attachments. Planning sees approved leave as unavailability, not the reason.</p>
      <div><button type="submit" className="primary" disabled={act.pending}>Send request</button></div>
      <ResultNotice result={act.result} successText={`Request sent.${linked}`} />
    </form>
  );
}
