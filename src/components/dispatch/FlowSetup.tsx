"use client";
/**
 * Dispatch setup (administrators): department role members, and the stage definitions as JSON. Saving checks
 * the whole definition (owners, next stages, branches, back links) and stores it as a new active version;
 * dispatches and complaints already in flight keep the version they started with.
 */
import { useState } from "react";
import { saveFlowDefinition, setFlowRoleMember } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";

interface Role { code: string; name: string; description: string; members: Array<{ employee_id: string; name: string; business_id: string }> }
interface Person { id: string; name: string; business_id: string; job_role: string }

export function RoleMembers({ roles, people }: { roles: Role[]; people: Person[] }) {
  const act = useAction(setFlowRoleMember);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <ul className="role-list">
        {roles.map((r) => (
          <li key={r.code}>
            <div><strong>{r.name}</strong><span className="small muted"> · {r.description}</span></div>
            <div className="role-members">
              {r.members.length === 0 && <span className="small muted">Nobody yet: steps owned by this role will wait.</span>}
              {r.members.map((m) => (
                <span key={m.employee_id} className="chip">{m.name} <span className="code muted">{m.business_id}</span>
                  <button type="button" className="icon-btn" disabled={act.pending} aria-label={`Remove ${m.name} from ${r.name}`} onClick={() => act.run({ roleCode: r.code, employeeId: m.employee_id, member: false })}>×</button></span>
              ))}
              <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act.run({ roleCode: r.code, employeeId: String(f.get("e")), member: true }); }}>
                <label className="sr-only" htmlFor={`rm-${r.code}`}>Add to {r.name}</label>
                <select id={`rm-${r.code}`} name="e" required defaultValue=""><option value="" disabled>Add a person…</option>{people.filter((p) => !r.members.some((m) => m.employee_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.business_id}</option>)}</select>
                <button type="submit" disabled={act.pending}>Add</button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <ResultNotice result={act.result} successText="Role updated." />
    </div>
  );
}

export function DefinitionEditor({ flow, current, version }: { flow: "dispatch" | "complaint"; current: string; version: number }) {
  const act = useAction(saveFlowDefinition);
  const [text, setText] = useState(current);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act.run({ flow, definition: text, note: String(f.get("note")) }); }}>
      <div className="field">
        <label htmlFor={`fd-${flow}`}>Definition (version {version}, JSON)</label>
        <textarea id={`fd-${flow}`} className="code-editor" rows={18} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="small muted">Each stage: code, label, owner (a role code or &quot;system&quot;), fields, next, optional branches (when field equals value: to, hold or back), backTo, slaDays.</span>
      </div>
      <div className="field"><label htmlFor={`fn-${flow}`}>What changed (kept with the version)</label><input id={`fn-${flow}`} name="note" required minLength={3} maxLength={200} /></div>
      <div className="row"><button type="submit" className="primary" disabled={act.pending}>{act.pending ? "Checking…" : "Save as new version"}</button><button type="button" onClick={() => setText(current)}>Undo edits</button></div>
      <ResultNotice result={act.result} successText="Saved as a new active version. New records use it; open ones keep theirs." />
    </form>
  );
}
