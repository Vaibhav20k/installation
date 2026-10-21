"use client";
import { useState } from "react";
import { setSkillRequirements } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";

interface Req { skillId: string; minLevel: 1 | 2 | 3; headcount: number; mode: "collective" | "per_person" }

export function SkillsStep({ visitId, skills, requirements, needsReason, editable }: {
  visitId: string; skills: Array<{ id: string; code: string; name: string }>;
  requirements: Array<{ skill_id: string; min_level: number; headcount: number; mode: string; source_complexity_label: string | null }>; needsReason: boolean; editable: boolean;
}) {
  const [rows, setRows] = useState<Req[]>(requirements.map((r) => ({ skillId: r.skill_id, minLevel: r.min_level as 1 | 2 | 3, headcount: r.headcount, mode: r.mode as Req["mode"] })));
  const [label, setLabel] = useState(requirements[0]?.source_complexity_label ?? "");
  const [reason, setReason] = useState("");
  const { run, pending, result } = useAction(setSkillRequirements);
  const update = (i: number, patch: Partial<Req>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <section className="card stack" aria-labelledby="h-skills">
      <h2 id="h-skills">Required skills</h2>
      <p className="small muted">Levels are an ordering (Low &lt; Medium &lt; High), not a score: several Low employees never replace one High. Only verified, currently valid skill records qualify; a senior job title alone does not prove High proficiency. Collective requirements in the same simultaneous slot need distinct people.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Skill</th><th>Minimum level</th><th>Headcount</th><th>Mode</th><th><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><label className="sr-only" htmlFor={`sk-${i}`}>Skill</label><select id={`sk-${i}`} value={r.skillId} onChange={(e) => update(i, { skillId: e.target.value })} disabled={!editable}>{skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
              <td><label className="sr-only" htmlFor={`lv-${i}`}>Minimum level</label><select id={`lv-${i}`} value={r.minLevel} onChange={(e) => update(i, { minLevel: Number(e.target.value) as 1 | 2 | 3 })} disabled={!editable}><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option></select></td>
              <td><label className="sr-only" htmlFor={`hc-${i}`}>Headcount</label><input id={`hc-${i}`} type="number" min={1} max={12} value={r.headcount} onChange={(e) => update(i, { headcount: Number(e.target.value) })} disabled={!editable} /></td>
              <td><label className="sr-only" htmlFor={`md-${i}`}>Mode</label><select id={`md-${i}`} value={r.mode} onChange={(e) => update(i, { mode: e.target.value as Req["mode"] })} disabled={!editable}><option value="collective">Collective (count distinct people)</option><option value="per_person">Every team member</option></select></td>
              <td>{editable && <button type="button" className="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {editable && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); run({ visitId, requirements: rows, sourceComplexityLabel: label || undefined, changeReason: reason || undefined }); }}>
          <div className="row"><button type="button" onClick={() => setRows([...rows, { skillId: skills[0]!.id, minLevel: 1, headcount: 1, mode: "collective" }])}>Add requirement</button></div>
          <div className="fields">
            <div className="field"><label htmlFor="sk-label">Source complexity label (optional)</label><input id="sk-label" value={label} onChange={(e) => setLabel(e.target.value)} />
              <span className="hint">Recorded for reference only; it is not a skill level or a site approval.</span></div>
            {needsReason && <div className="field"><label htmlFor="sk-r">Change reason (starts a new revision)</label><input id="sk-r" value={reason} onChange={(e) => setReason(e.target.value)} required /></div>}
          </div>
          <button type="submit" className="primary" disabled={pending}>Save requirements</button>
          <ResultNotice result={result} successText="Requirements saved." />
        </form>
      )}
    </section>
  );
}
