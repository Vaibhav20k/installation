"use client";
/**
 * Demo-only person picker: a native select (the phone's own picker) that switches identity in place
 * and lands on that role's home screen. Never rendered when demo identities are off.
 */
import { useTransition } from "react";
import { signInAs } from "@/app/actions";

export interface Person { id: string; business_id: string; name: string; permission_role: string; job_role: string }

const GROUPS: Array<[string, string]> = [["admin", "Administrator"], ["manager", "Managers"], ["supervisor", "Site supervisors"], ["employee", "Field crew"]];

export function PersonSwitch({ people, currentId, variant }: { people: Person[]; currentId: string; variant: "chip" | "field" }) {
  const [pending, start] = useTransition();
  const select = (
    <select
      aria-label="Switch person (demo)"
      value={currentId}
      disabled={pending}
      onChange={(e) => { const id = e.target.value; start(() => signInAs(id)); }}
      className={variant === "chip" ? "person-chip-select" : undefined}
    >
      {GROUPS.map(([role, label]) => (
        <optgroup key={role} label={label}>
          {people.filter((p) => p.permission_role === role).map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.business_id} · {p.job_role.replace(/_/g, " ")}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
  if (variant === "chip") return select;
  return (
    <div className="field person-field">
      <span className="small" aria-live="polite">{pending ? "Switching…" : "Switch person (demo)"}</span>
      {select}
    </div>
  );
}
