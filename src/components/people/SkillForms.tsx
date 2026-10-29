"use client";
import { addEmployeeSkill, recordLeave, updateEmployeeSkill, verifySkill } from "@/app/actions";
import { useState } from "react";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { EvidenceUploader, useAttachOnSave, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";

export function SkillForms({ employeeId, skills, records, canVerify, canRecordLeave }: {
  employeeId: string; skills: Array<{ id: string; name: string }>; records: Array<{ id: string; label: string; verified: boolean }>; canVerify: boolean; canRecordLeave: boolean;
}) {
  const add = useAction(addEmployeeSkill);
  const ver = useAction(verifySkill);
  const addDraft = useEvidenceDraft("skill.claim");
  const verDraft = useEvidenceDraft("skill.verification");
  const [verifiedId, setVerifiedId] = useState<string | null>(null);
  const addNote = useAttachOnSave(addDraft, "employee_skill", add.result?.ok ? (add.result.data as { id: string }).id : null);
  const verNote = useAttachOnSave(verDraft, "employee_skill", ver.result?.ok ? verifiedId : null);
  const leave = useAction(recordLeave);
  const leaveData = leave.result?.ok ? (leave.result.data as { conflictingVisits: string[] }) : null;
  return (
    <div className="stack">
      {canVerify && records.length > 0 && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setVerifiedId(String(f.get("r"))); ver.run({ employeeSkillId: String(f.get("r")), verified: f.get("v") === "yes", validTo: f.get("to") ? String(f.get("to")) : undefined, note: String(f.get("n") || "") || undefined }); }}>
          <h3>Verify a skill</h3>
          <div className="fields">
            <div className="field"><label htmlFor="v-r">Record</label><select id="v-r" name="r">{records.map((r) => <option key={r.id} value={r.id}>{r.label}{r.verified ? " (verified)" : ""}</option>)}</select></div>
            <div className="field"><label htmlFor="v-v">Decision</label><select id="v-v" name="v"><option value="yes">Verified</option><option value="no">Not verified</option></select></div>
            <div className="field"><label htmlFor="v-to">Valid until (optional)</label><input id="v-to" type="date" name="to" /></div>
          </div>
          <div className="field"><label htmlFor="v-n">Basis for the decision</label><input id="v-n" name="n" /></div>
          <EvidenceUploader draft={verDraft} label="Certificate, test or work photos (optional)" />
          <button type="submit" disabled={ver.pending}>Save verification</button>
          <ResultNotice result={ver.result} successText={`Verification recorded.${verNote}`} />
        </form>
      )}
      <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); add.run({ employeeId, skillId: String(f.get("s")), level: Number(f.get("l")), validFrom: f.get("from") ? String(f.get("from")) : undefined }); }}>
        <h3>Record a claimed skill</h3>
        <div className="fields">
          <div className="field"><label htmlFor="a-s">Skill</label><select id="a-s" name="s">{skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="field"><label htmlFor="a-l">Level</label><select id="a-l" name="l"><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option></select></div>
          <div className="field"><label htmlFor="a-f">Valid from</label><input id="a-f" type="date" name="from" /></div>
        </div>
        <p className="small muted">New records start unverified and do not qualify for staffing until verified.</p>
        <EvidenceUploader draft={addDraft} label="Photos of past work or a certificate (optional)" />
        <button type="submit" disabled={add.pending}>Add skill record</button>
        <ResultNotice result={add.result} successText={`Skill recorded (unverified).${addNote}`} />
      </form>
      {canRecordLeave && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); leave.run({ employeeId, from: String(f.get("f")), to: String(f.get("t")), kind: String(f.get("k")) }); }}>
          <h3>Record approved leave</h3>
          <div className="fields">
            <div className="field"><label htmlFor="l-f">From</label><input id="l-f" type="date" name="f" required /></div>
            <div className="field"><label htmlFor="l-t">To</label><input id="l-t" type="date" name="t" required /></div>
            <div className="field"><label htmlFor="l-k">Type</label><input id="l-k" name="k" defaultValue="Annual leave" required /></div>
          </div>
          <button type="submit" disabled={leave.pending}>Record leave</button>
          <ResultNotice result={leave.result} successText="Leave recorded." />
          {leaveData && leaveData.conflictingVisits.length > 0 && <div className="notice" data-tone="warn" role="status">Existing bookings now need review (not removed): {leaveData.conflictingVisits.join(", ")}</div>}
        </form>
      )}
    </div>
  );
}

/** Correct an existing skill record. A changed level clears verification; every change needs a reason and is kept. */
export function SkillCorrect({ records }: { records: Array<{ id: string; name: string; level: number; version: number; notes: string | null }> }) {
  const save = useAction(updateEmployeeSkill);
  const [id, setId] = useState(records[0]?.id ?? "");
  const r = records.find((x) => x.id === id);
  if (!r) return null;
  return (
    <form key={`${r.id}-${r.version}`} className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); save.run({ employeeSkillId: r.id, version: r.version, level: Number(f.get("l")), notes: String(f.get("n") || "") || null, reason: String(f.get("why")) }); }}>
      <h3>Correct a skill record</h3>
      <div className="fields">
        <div className="field"><label htmlFor="c-r">Record</label><select id="c-r" value={id} onChange={(e) => { setId(e.target.value); save.reset(); }}>{records.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div className="field"><label htmlFor="c-l">Level</label><select id="c-l" name="l" defaultValue={r.level}><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option></select></div>
      </div>
      <div className="field"><label htmlFor="c-n">Notes</label><input id="c-n" name="n" defaultValue={r.notes ?? ""} maxLength={500} /></div>
      <div className="field"><label htmlFor="c-why">Reason for the change</label><input id="c-why" name="why" required minLength={3} maxLength={300} /></div>
      <p className="small muted">Changing the level clears any verification; it then needs verifying again.</p>
      <button type="submit" disabled={save.pending}>Save correction</button>
      <ResultNotice result={save.result} successText="Correction saved and added to the history." />
    </form>
  );
}
