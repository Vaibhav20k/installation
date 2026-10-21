"use client";
import { addEmployeeSkill, recordLeave, verifySkill } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";

export function SkillForms({ employeeId, skills, records, canVerify, canRecordLeave }: {
  employeeId: string; skills: Array<{ id: string; name: string }>; records: Array<{ id: string; label: string; verified: boolean }>; canVerify: boolean; canRecordLeave: boolean;
}) {
  const add = useAction(addEmployeeSkill);
  const ver = useAction(verifySkill);
  const leave = useAction(recordLeave);
  const leaveData = leave.result?.ok ? (leave.result.data as { conflictingVisits: string[] }) : null;
  return (
    <div className="stack">
      {canVerify && records.length > 0 && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); ver.run({ employeeSkillId: String(f.get("r")), verified: f.get("v") === "yes", validTo: f.get("to") ? String(f.get("to")) : undefined, note: String(f.get("n") || "") || undefined }); }}>
          <h3>Verify a skill</h3>
          <div className="fields">
            <div className="field"><label htmlFor="v-r">Record</label><select id="v-r" name="r">{records.map((r) => <option key={r.id} value={r.id}>{r.label}{r.verified ? " (verified)" : ""}</option>)}</select></div>
            <div className="field"><label htmlFor="v-v">Decision</label><select id="v-v" name="v"><option value="yes">Verified</option><option value="no">Not verified</option></select></div>
            <div className="field"><label htmlFor="v-to">Valid until (optional)</label><input id="v-to" type="date" name="to" /></div>
          </div>
          <div className="field"><label htmlFor="v-n">Basis for the decision</label><input id="v-n" name="n" /></div>
          <button type="submit" disabled={ver.pending}>Save verification</button>
          <ResultNotice result={ver.result} successText="Verification recorded." />
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
        <button type="submit" disabled={add.pending}>Add skill record</button>
        <ResultNotice result={add.result} successText="Skill recorded (unverified)." />
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
