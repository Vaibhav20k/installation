"use client";
/**
 * One employee skill card. Everything essential is on the face of the card (no hover, no flip): portrait,
 * name and role, availability strip, skill stat rows with verification and expiry, real experience, and actions.
 */
import { ArrowRight, CheckCircle, Eye, PencilSimple, WarningCircle } from "@phosphor-icons/react";
import { AVAILABILITY_LABEL } from "@/domain/availability";
import type { CardSummary } from "@/server/queries/skill-cards";
import { LEVEL_LABEL, Pips, initials, roleLabel, shortDate, skillMeta } from "./skill-meta";

const SHOWN = 4;

export function availabilityNote(c: CardSummary) {
  if (c.availability === "available") return "Free now";
  if (c.availability === "unknown") return c.active ? "No calendar on record" : "Inactive";
  return c.next_available ? `Free ${shortDate(c.next_available)}` : "Not free within 90 days";
}

export function SkillStatus({ s }: { s: CardSummary["skills"][number] }) {
  return (
    <span className="sc-stat-status">
      {s.expired ? <span data-tone="bad">Expired {shortDate(s.valid_to)}</span>
        : s.verified ? <span data-tone="ok">Verified</span> : <span data-tone="warn">Not verified</span>}
      {s.not_yet && <span data-tone="warn">Valid from {shortDate(s.valid_from)}</span>}
      {!s.expired && s.valid_to && <span>Valid to {shortDate(s.valid_to)}</span>}
    </span>
  );
}

export function SkillCard({ c, onOpen }: { c: CardSummary; onOpen: (kind: "detail" | "edit" | "assign") => void }) {
  const skills = c.skills.slice(0, SHOWN);
  const e = c.experience;
  return (
    <article className="skill-card" data-inactive={!c.active || undefined} aria-labelledby={`sc-${c.id}`}>
      <div className="sc-portrait">
        {c.portrait ? <img src={`/api/evidence/file/${c.portrait}`} alt="" loading="lazy" decoding="async" /> : <span className="sc-monogram" aria-hidden>{initials(c.name)}</span>}
        <span className="sc-id">{c.business_id}</span>
        <span className="sc-role-tag">{roleLabel(c.job_role)}</span>
      </div>
      <p className="sc-avail" data-state={c.availability}>
        {AVAILABILITY_LABEL[c.availability]}
        <span className="sc-avail-note">{availabilityNote(c)}</span>
      </p>
      <div className="sc-body">
        <h2 className="sc-name" id={`sc-${c.id}`}>{c.name}</h2>
        <p className="sc-sub">{roleLabel(c.job_role)} · {c.base_city}</p>
        {c.current && <p className="sc-current">On {c.current.visit} · {c.current.project}</p>}
      </div>
      {skills.length === 0 ? <p className="sc-none"><WarningCircle size={14} aria-hidden /> No skill records yet</p> : (
        <ul className="sc-stats" aria-label={`Skills of ${c.name}`}>
          {skills.map((s) => {
            const m = skillMeta(s.code);
            return (
              <li key={s.id} className="sc-stat" style={m.style}>
                <span className="sc-stat-name"><m.icon size={15} weight="bold" aria-hidden />{s.name}</span>
                <span className="sc-stat-level"><Pips level={s.level} />{LEVEL_LABEL[s.level]}</span>
                <SkillStatus s={s} />
              </li>
            );
          })}
        </ul>
      )}
      {c.skills.length > SHOWN && <p className="sc-more">+{c.skills.length - SHOWN} more in details</p>}
      <p className="sc-exp">
        {e.visits === 0 ? "No visits on record yet" : <>
          <CheckCircle size={13} aria-hidden style={{ verticalAlign: "-2px" }} /> {e.completed_visits} completed visit{e.completed_visits === 1 ? "" : "s"} of {e.visits} · {e.projects} project{e.projects === 1 ? "" : "s"}{e.since ? ` · since ${shortDate(e.since)}` : ""}
        </>}
      </p>
      <div className="sc-actions">
        <button type="button" onClick={() => onOpen("detail")} aria-label={`View details for ${c.name}`}><Eye size={16} aria-hidden /> Details</button>
        <button type="button" onClick={() => onOpen("edit")} aria-label={`Edit skills of ${c.name}`}><PencilSimple size={16} aria-hidden /> Edit skills</button>
        <button type="button" className="primary" onClick={() => onOpen("assign")} disabled={!c.active} aria-label={`Assign ${c.name} to a plan`}>Assign plan <ArrowRight size={16} aria-hidden /></button>
      </div>
    </article>
  );
}
