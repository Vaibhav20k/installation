"use client";
/**
 * Demo-only person picker: a native select (the phone's own picker) that switches identity in place
 * and lands on that role's home screen. Never rendered when demo identities are off.
 */
import { demoPeopleGroups } from "@/lib/demo-people";
import { useTransition } from "react";
import { signInAs } from "@/app/actions";

export interface Person { id: string; business_id: string; name: string; permission_role: string; job_role: string }



export function PersonSwitch({ people, currentId, variant }: { people: Person[]; currentId: string; variant: "chip" | "field" }) {
  const [pending, start] = useTransition();
  const groups = demoPeopleGroups(people);
  const current = people.find(p => p.id === currentId);
  const currentIsListed = groups.some(g => g.people.some(p => p.id === currentId));
  const select = (
    <select
      aria-label="Switch person (demo)"
      value={currentId}
      disabled={pending}
      aria-busy={pending}
      onChange={(e) => { const id = e.target.value; start(() => signInAs(id)); }}
      className={variant === "chip" ? "person-chip-select" : undefined}
    >
      {groups.map(group => <optgroup key={group.id} label={group.label}>
        {group.people.map(p => <option key={p.id} value={p.id}>{p.name} · {p.business_id} · {p.job_role.replace(/_/g, " ")}</option>)}
      </optgroup>)}
      {!currentIsListed && current && <optgroup label="Current signed-in person"><option value={current.id}>{current.name} · {current.business_id}</option></optgroup>}
    </select>
  );
  if (variant === "chip") return <>{select}{pending && <span className="person-switch-status" role="status">Switching person…</span>}</>;
  return (
    <div className="field person-field">
      <span className="small" aria-live="polite">{pending ? "Switching…" : "Switch person (demo)"}</span>
      {select}
    </div>
  );
}
