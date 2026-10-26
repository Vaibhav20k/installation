"use client";
/** The card grid (or compact list) and the drawers it opens. Drawers load their detail only when opened. */
import { useState } from "react";
import dynamic from "next/dynamic";
import { AVAILABILITY_LABEL } from "@/domain/availability";
import type { CardSummary } from "@/server/queries/skill-cards";
import { SkillCard, availabilityNote } from "./SkillCard";
import { LEVEL_LABEL, roleLabel, skillMeta } from "./skill-meta";

const CardDrawer = dynamic(() => import("./CardDrawer").then((m) => m.CardDrawer), { ssr: false });
const AssignDrawer = dynamic(() => import("./AssignDrawer").then((m) => m.AssignDrawer), { ssr: false });

type Open = { kind: "detail" | "edit" | "assign"; card: CardSummary } | null;

export function CardDirectory({ rows, view }: { rows: CardSummary[]; view: "grid" | "list" }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  return (
    <>
      {view === "grid" ? (
        <ul className="card-grid">
          {rows.map((c) => <li key={c.id}><SkillCard c={c} onOpen={(kind) => setOpen({ kind, card: c })} /></li>)}
        </ul>
      ) : (
        <div className="table-wrap"><table className="card-list">
          <thead><tr><th className="pin">Employee</th><th>Role · base</th><th>Availability</th><th>Skills</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id}>
              <th scope="row" className="pin" style={{ fontWeight: 600 }}>{c.name}<div className="small muted code">{c.business_id}</div></th>
              <td style={{ textTransform: "capitalize" }}>{roleLabel(c.job_role)}<div className="small muted">{c.base_city}</div></td>
              <td><span className="avail-dot" data-state={c.availability}>{AVAILABILITY_LABEL[c.availability]}</span><div className="small muted">{c.current ? `On ${c.current.visit}` : availabilityNote(c)}</div></td>
              <td><span className="chips">{c.skills.length === 0 ? <span className="small muted">None</span> : c.skills.map((s) => (
                <span key={s.id} className="chip" style={skillMeta(s.code).style}>{s.name} · {LEVEL_LABEL[s.level]}{s.expired ? " · expired" : s.verified ? " · verified" : " · unverified"}</span>
              ))}</span></td>
              <td className="row" style={{ flexWrap: "nowrap" }}>
                <button type="button" onClick={() => setOpen({ kind: "detail", card: c })} aria-label={`View details for ${c.name}`}>Details</button>
                <button type="button" onClick={() => setOpen({ kind: "edit", card: c })} aria-label={`Edit skills of ${c.name}`}>Edit</button>
                <button type="button" className="primary" disabled={!c.active} onClick={() => setOpen({ kind: "assign", card: c })} aria-label={`Assign ${c.name} to a plan`}>Assign</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {open && open.kind !== "assign" && <CardDrawer card={open.card} tab={open.kind} onClose={close} />}
      {open?.kind === "assign" && <AssignDrawer card={open.card} onClose={close} />}
    </>
  );
}
