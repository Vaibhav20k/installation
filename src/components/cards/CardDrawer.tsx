"use client";
/**
 * Card details and skill editing (admin only). Loads the record on open; edits go through the card services,
 * which keep history and never mark a skill verified as a side effect. Failed saves keep what was typed.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowClockwise } from "@phosphor-icons/react";
import { cardDetail } from "@/app/actions";
import { AVAILABILITY_LABEL } from "@/domain/availability";
import type { CardSummary, cardDetail as detailQuery } from "@/server/queries/skill-cards";
import { Drawer } from "./Drawer";
import { PortraitUpload } from "./PortraitUpload";
import { AddSkillForm, SkillEditor } from "./SkillEditor";
import { LEVEL_LABEL, Pips, roleLabel, shortDate, skillMeta } from "./skill-meta";
import { availabilityNote } from "./SkillCard";

export type Detail = Awaited<ReturnType<typeof detailQuery>>;

export function CardDrawer({ card, tab: initialTab, onClose }: { card: CardSummary; tab: "detail" | "edit"; onClose: () => void }) {
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const load = useCallback(async () => {
    setError(null);
    const r = await cardDetail(card.id);
    if (r.ok) setData(r.data as Detail); else setError(r.message);
  }, [card.id]);
  useEffect(() => { void load(); }, [load]);
  const changed = () => { void load(); router.refresh(); };

  return (
    <Drawer title={card.name} onClose={onClose}>
      <div className="drawer-tabs" role="tablist" aria-label="Card sections">
        <button type="button" role="tab" aria-selected={tab === "detail"} onClick={() => setTab("detail")}>Details</button>
        <button type="button" role="tab" aria-selected={tab === "edit"} onClick={() => setTab("edit")}>Edit skills</button>
      </div>
      {error && <div className="notice" data-tone="bad" role="alert">{error} <button type="button" onClick={() => void load()}><ArrowClockwise size={14} aria-hidden /> Retry</button></div>}
      {!data && !error && <p className="small muted" role="status">Loading the card…</p>}
      {data && tab === "detail" && <DetailView card={card} d={data} onChanged={changed} />}
      {data && tab === "edit" && (
        <div className="stack" role="tabpanel">
          <p className="small muted" style={{ margin: 0 }}>Changing a level clears its verification; verify it again separately. Every change needs a reason and is kept in the history.</p>
          {data.skills.length === 0 && <p className="notice" data-tone="warn">No skill records yet. Add the first one below.</p>}
          {data.skills.map((s) => <SkillEditor key={s.id} s={s} employeeId={data.employee.id} onChanged={changed} />)}
          <AddSkillForm employeeId={data.employee.id} catalog={data.catalog.filter((c) => !data.skills.some((s) => s.skill_id === c.id && !s.expired))} onChanged={changed} />
        </div>
      )}
    </Drawer>
  );
}

function DetailView({ card, d, onChanged }: { card: CardSummary; d: Detail; onChanged: () => void }) {
  const e = d.employee;
  return (
    <div className="stack" role="tabpanel">
      <PortraitUpload employeeId={e.id} name={e.name} current={card.portrait} onUploaded={onChanged} />
      <dl className="facts">
        <div><dt>Employee ID</dt><dd className="code">{e.business_id}</dd></div>
        <div><dt>Job role</dt><dd style={{ textTransform: "capitalize" }}>{roleLabel(e.job_role)}</dd></div>
        <div><dt>Base</dt><dd>{e.base_city}</dd></div>
        <div><dt>Reports to</dt><dd>{e.manager ?? "None"}</dd></div>
        <div><dt>Availability</dt><dd>{AVAILABILITY_LABEL[card.availability]} · {availabilityNote(card)}</dd></div>
        <div><dt>Now on</dt><dd>{card.current ? `${card.current.visit} · ${card.current.project}` : "No current visit"}</dd></div>
      </dl>
      <section aria-labelledby="h-skills">
        <h3 id="h-skills">Skills</h3>
        {d.skills.length === 0 ? <p className="small muted">No skill records.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Skill</th><th>Level</th><th>Verification</th><th>Validity</th></tr></thead>
            <tbody>{d.skills.map((s) => (
              <tr key={s.id} style={skillMeta(s.code).style}>
                <td><strong>{s.name}</strong>{s.notes && <div className="small muted">{s.notes}</div>}</td>
                <td><span className="sc-stat-level"><Pips level={s.level} />{LEVEL_LABEL[s.level as 1 | 2 | 3]}</span></td>
                <td>{s.verified ? <>Verified by {s.verifier ?? "unknown"}<div className="small muted">{s.verified_at ? new Date(Number(s.verified_at)).toLocaleDateString("en-IN") : ""}</div></> : <span style={{ color: "var(--warn)" }}>Not verified</span>}</td>
                <td>{s.expired ? <span style={{ color: "var(--signal)" }}>Expired {shortDate(s.valid_to)}</span> : s.valid_to ? `Until ${shortDate(s.valid_to)}` : s.valid_from ? `From ${shortDate(s.valid_from)}` : <span className="muted">No expiry recorded</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <section aria-labelledby="h-asg">
        <h3 id="h-asg">Recent assignments</h3>
        {d.assignments.length === 0 ? <p className="small muted">None on record.</p> : (
          <ul className="history">{d.assignments.map((a, i) => (
            <li key={i}><span><strong>{a.visit}</strong> · {a.project}</span><time>{new Date(Number(a.from)).toLocaleDateString("en-IN")} – {new Date(Number(a.until) - 1).toLocaleDateString("en-IN")} · {a.state} · visit {a.exec_status.replace("_", " ")}</time></li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
