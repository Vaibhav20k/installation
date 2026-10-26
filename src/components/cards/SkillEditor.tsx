"use client";
/** Edit one skill record, verify it (separately), see its history; add a new claimed skill. Admin only. */
import { useState } from "react";
import { addCardSkill, updateCardSkill, verifyCardSkill } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { EvidenceDisclosure, useAttachOnSave, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import type { Detail } from "./CardDrawer";
import { LEVEL_LABEL, shortDate, skillMeta } from "./skill-meta";

type Skill = Detail["skills"][number];
const val = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
const CHANGE_LABEL: Record<string, string> = { claimed: "Recorded", level: "Level changed", validity: "Validity changed", notes: "Notes changed", verified: "Verified", unverified: "Verification removed" };

function describe(h: Skill["history"][number]) {
  const a = (h.after ?? {}) as Record<string, unknown>, b = (h.before ?? {}) as Record<string, unknown>;
  if (h.change === "level") return `${LEVEL_LABEL[b.level as 1] ?? b.level} → ${LEVEL_LABEL[a.level as 1] ?? a.level}`;
  if (h.change === "validity") return `${(a.validFrom as string) ?? "open"} to ${(a.validTo as string) ?? "no expiry"}`;
  if (h.change === "claimed") return `${LEVEL_LABEL[a.level as 1] ?? ""}, unverified`;
  return "";
}

export function SkillEditor({ s, onChanged }: { s: Skill; employeeId: string; onChanged: () => void }) {
  const save = useAction(updateCardSkill, { onSuccess: () => onChanged() });
  const verify = useAction(verifyCardSkill, { onSuccess: () => onChanged() });
  const draft = useEvidenceDraft("skill.card");
  const savedChange = save.result?.ok ? (save.result.data as { changeId: string }).changeId : verify.result?.ok ? (verify.result.data as { changeId: string | null }).changeId : null;
  const note = useAttachOnSave(draft, "employee_skill_change", savedChange);
  const [level, setLevel] = useState(String(s.level));
  const m = skillMeta(s.code);
  return (
    <section className="skill-edit" style={m.style} aria-labelledby={`se-${s.id}`}>
      <h3 id={`se-${s.id}`}><span><m.icon size={15} weight="bold" aria-hidden /> {s.name}</span>
        <span className="small" style={{ fontWeight: 600, color: s.expired ? "var(--signal)" : s.verified ? "var(--ok)" : "var(--warn)" }}>{s.expired ? `Expired ${shortDate(s.valid_to)}` : s.verified ? `Verified by ${s.verifier ?? "unknown"}` : "Not verified"}</span></h3>
      <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
        save.run({ employeeSkillId: s.id, version: s.version, level: Number(level), validFrom: val(f, "from") ?? null, validTo: val(f, "to") ?? null, notes: val(f, "notes") ?? null, reason: val(f, "reason") }); }}>
        <div className="grid cols-3">
          <div className="field"><label htmlFor={`lv-${s.id}`}>Proficiency</label><select id={`lv-${s.id}`} value={level} onChange={(e) => setLevel(e.target.value)}><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select></div>
          <div className="field"><label htmlFor={`vf-${s.id}`}>Valid from</label><input id={`vf-${s.id}`} name="from" type="date" defaultValue={s.valid_from ?? ""} /></div>
          <div className="field"><label htmlFor={`vt-${s.id}`}>Valid until</label><input id={`vt-${s.id}`} name="to" type="date" defaultValue={s.valid_to ?? ""} /></div>
        </div>
        <div className="field"><label htmlFor={`nt-${s.id}`}>Supporting notes</label><textarea id={`nt-${s.id}`} name="notes" rows={2} maxLength={500} defaultValue={s.notes ?? ""} placeholder="What the record is based on" /></div>
        <div className="field"><label htmlFor={`rs-${s.id}`}>Reason for this change</label><input id={`rs-${s.id}`} name="reason" required minLength={3} maxLength={300} placeholder="For example: observed on VIS-005" /></div>
        {s.verified && Number(level) !== s.level && <p className="notice" data-tone="warn" style={{ margin: 0 }}>Saving a new level removes the current verification. It must be verified again.</p>}
        <EvidenceDisclosure draft={draft} label="Evidence photos or video (optional, admin only)" />
        <div><button type="submit" disabled={save.pending}>Save changes</button></div>
        <ResultNotice result={save.result} successText={`Saved.${(save.result?.ok && (save.result.data as { verificationCleared: boolean }).verificationCleared) ? " Verification removed because the level changed." : ""}${note}`} />
      </form>
      <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); verify.run({ employeeSkillId: s.id, verified: !s.verified, note: val(f, "vnote") }); }}>
        <label className="sr-only" htmlFor={`vn-${s.id}`}>Basis for the decision</label>
        <input id={`vn-${s.id}`} name="vnote" required minLength={3} maxLength={300} placeholder={s.verified ? "Why remove verification" : "How it was verified"} style={{ flex: 1, minWidth: 180 }} />
        <button type="submit" disabled={verify.pending || s.expired}>{s.verified ? "Remove verification" : "Verify"}</button>
      </form>
      <ResultNotice result={verify.result} successText={s.verified ? "Verified." : "Verification removed."} />
      {s.history.length > 0 && (
        <details>
          <summary className="small">History ({s.history.length}{s.history.length >= 12 ? ", latest" : ""})</summary>
          <ul className="history">{s.history.map((h) => (
            <li key={h.id}><span><strong>{CHANGE_LABEL[h.change] ?? h.change}</strong> {describe(h)}{h.evidence ? ` · ${h.evidence} attachment${h.evidence === 1 ? "" : "s"}` : ""}</span>
              <time>{new Date(Number(h.at)).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {h.actor ?? "system"}{h.reason ? ` · ${h.reason}` : ""}</time></li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}

export function AddSkillForm({ employeeId, catalog, onChanged }: { employeeId: string; catalog: Detail["catalog"]; onChanged: () => void }) {
  const add = useAction(addCardSkill, { onSuccess: () => onChanged() });
  const draft = useEvidenceDraft("skill.card");
  const note = useAttachOnSave(draft, "employee_skill_change", add.result?.ok ? (add.result.data as { changeId: string | null }).changeId : null);
  if (!catalog.length) return <p className="small muted">Every skill in the catalogue already has a current record.</p>;
  return (
    <form className="skill-edit" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      add.run({ employeeId, skillId: val(f, "skill"), level: Number(f.get("level")), validFrom: val(f, "from"), validTo: val(f, "to"), notes: val(f, "notes"), reason: val(f, "reason") }); }}>
      <h3>Add a skill</h3>
      <div className="grid cols-2">
        <div className="field"><label htmlFor="as-skill">Skill</label><select id="as-skill" name="skill">{catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="as-level">Proficiency</label><select id="as-level" name="level" defaultValue="1"><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select></div>
        <div className="field"><label htmlFor="as-from">Valid from (optional)</label><input id="as-from" name="from" type="date" /></div>
        <div className="field"><label htmlFor="as-to">Valid until (optional)</label><input id="as-to" name="to" type="date" /></div>
      </div>
      <div className="field"><label htmlFor="as-notes">Supporting notes</label><textarea id="as-notes" name="notes" rows={2} maxLength={500} /></div>
      <div className="field"><label htmlFor="as-reason">Reason</label><input id="as-reason" name="reason" required minLength={3} maxLength={300} placeholder="For example: certificate seen, trial cut on site" /></div>
      <EvidenceDisclosure draft={draft} label="Evidence photos or video (optional, admin only)" />
      <p className="small muted" style={{ margin: 0 }}>New skills start unverified and do not count for staffing until verified.</p>
      <div><button type="submit" disabled={add.pending}>Add skill</button></div>
      <ResultNotice result={add.result} successText={`Skill recorded (unverified).${note}`} />
    </form>
  );
}
