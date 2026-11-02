"use client";

import { useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { demoPeopleGroups, type DemoPerson } from "@/lib/demo-people";
import { signInAs } from "@/app/actions";
import { SignInButton } from "./SignInButton";

type Person = DemoPerson & { base_city: string; capabilities: string[] };
const PURPOSE: Record<string, string> = {
  admin: "Review decisions and manage settings. Your personal queue opens first.",
  manager: "Plan site work, review approvals and follow dispatch handoffs.",
  supervisor: "Coordinate the site team, check readiness and review work.",
  employee: "Open your daily attendance, site check-in and assigned work.",
  hub: "See the dispatch and complaint steps assigned to your department.",
};

export function IdentityDirectory({ people }: { people: Person[] }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  // Group first so searching never expands the agreed demo roster.
  const groups = demoPeopleGroups(people).map(g => ({ ...g, people: g.people.filter(p =>
    `${p.name} ${p.business_id} ${p.job_role.replaceAll("_", " ")} ${p.base_city}`.toLowerCase().includes(query)) }));
  const count = groups.reduce((n, g) => n + g.people.length, 0);
  return <div className="identity-directory stack">
    <div className="identity-search">
      <label htmlFor="identity-search">Find a person</label>
      <input id="identity-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, employee ID, role or city" autoComplete="off" />
      <p className="identity-result-count muted" role="status">{count} people{query ? " match your search" : " available"}. Selecting a person opens their own task queue.</p>
    </div>
    {groups.filter(g => g.people.length > 0).map(g => <section key={g.id} className="plate" aria-labelledby={`h-${g.id}`}>
      <div className="plate-head"><h2 id={`h-${g.id}`}>{g.label}</h2><span className="code-tag">{g.people.length}</span></div>
      <p className="identity-group-note muted">{PURPOSE[g.id]}</p>
      <ul className="callouts">{g.people.map(p => <li key={p.id}>
        <form action={signInAs.bind(null, p.business_id)}><SignInButton>
          <span className="monogram" aria-hidden>{p.name.split(/\s+/).map(x => x[0]).join("").slice(0, 2)}</span>
          <span><span className="callout-title">{p.name} <span className="code">{p.business_id}</span></span>
            <span className="callout-meta">{p.job_role.replaceAll("_", " ")} · {p.base_city}</span>
            <span className="callout-meta">Open this person’s tasks</span></span>
          <CaretRight size={18} className="callout-go" aria-hidden />
        </SignInButton></form>
      </li>)}</ul>
    </section>)}
    {count === 0 && <p className="notice">No matching person. Try a different name, ID, role or city.</p>}
  </div>;
}
