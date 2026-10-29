/**
 * The factory's Complaints queue (docs/plans/workspaces-design.md §2.2, item 3): phase chips on top
 * (All · Planning · Purchase · QC · Production · Ready to send), then the detailed steps inside the chosen phase, each
 * with its complaints. The viewer's own steps sort first and say "Your step". The whole row opens the complaint.
 * Filters are plain links, so the view works and can be shared without JavaScript. Server component; no cost shown.
 */
import Link from "next/link";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { PriorityTag, UnlistedTag } from "@/components/dispatch/PriorityTag";
import { RECENT_CLOSED_DAYS } from "@/server/queries/complaint-tracker";
import { FACTORY_PHASES, factoryPhaseLabel, groupQueue, queueCounts, type PhaseFilter, type QueueComplaint, type QueueGroup } from "@/server/queries/factory-pipeline";
import { days } from "./FactoryRows";

const href = (show: "open" | "closed", phase: PhaseFilter) => `/complaints?${show === "closed" ? "show=closed" : `phase=${phase}`}`;

function Row({ c }: { c: QueueComplaint }) {
  const open = c.status === "open";
  return (
    <li className="fq-row" data-overdue={c.overdue || undefined} data-mine={c.mine || undefined}>
      <Link className="fq-link" href={`/dispatch/complaints/${c.id}`}>
        <span className="fq-top">
          <span className="code-tag">{c.business_id}</span>
          {c.mine && <span className="fq-mine">Your step</span>}
          <PriorityTag priority={c.priority} />
          <UnlistedTag unlisted={c.unlisted} />
        </span>
        <span className="fq-title"><span className="fq-kind" data-kind={c.kind}>{c.kind === "missing" ? "Missing" : "Damaged"}</span> {c.quantity}{c.unit ? ` ${c.unit}` : ""} × {c.item}</span>
        <span className="fq-sub">{c.order} · {c.customer}</span>
        <span className="fq-meta">
          {open
            ? <span className="fq-age" data-overdue={c.overdue || undefined}>{c.days === 0 ? "In this step since today" : `${days(c.days)} in this step`}{c.overdue ? " · overdue" : ""}</span>
            : <span className="fq-age">Closed</span>}
          {open && <span className="fq-owner">{c.owner === "system" ? "On its way to site" : c.owner_name}</span>}
        </span>
      </Link>
    </li>
  );
}

function Group({ g, showPhase }: { g: QueueGroup; showPhase: boolean }) {
  const id = `fq-${g.stage}`;
  return (
    <section className="fq-group" aria-labelledby={id} data-tone={g.overdue ? "bad" : undefined}>
      <h2 id={id} className="fq-head">
        {showPhase && g.phase !== "done" && <span className="fq-head-phase">{factoryPhaseLabel(g.phase)} ·</span>} {g.label}
        <span className="flow-count">{g.rows.length}</span>
        {g.mine > 0 && <span className="fq-head-mine">{g.mine} yours</span>}
      </h2>
      <ul className="fq-rows">{g.rows.map((c) => <Row key={c.id} c={c} />)}</ul>
    </section>
  );
}

export function ComplaintQueue({ list, show, phase, hasRoles }: { list: QueueComplaint[]; show: "open" | "closed"; phase: PhaseFilter; hasRoles: boolean }) {
  const n = queueCounts(list);
  const groups = groupQueue(list, show, phase);
  const phaseLabel = phase === "all" ? null : factoryPhaseLabel(phase);
  return (
    <div className="stack fq">
      <nav className="ct-filters" aria-label="Filter complaints">
        <div className="ct-seg" role="group" aria-label="Open or closed">
          <Link href={href("open", "all")} aria-current={show === "open" ? "true" : undefined}>Open <span className="ct-n" data-alert={n.overdue > 0 || undefined}>{n.open}</span></Link>
          <Link href={href("closed", "all")} aria-current={show === "closed" ? "true" : undefined}>Closed <span className="ct-n">{n.closed}</span></Link>
        </div>
        {show === "open" && (
          <div className="ct-chips" role="group" aria-label="Phase">
            <Link href={href("open", "all")} aria-current={phase === "all" ? "true" : undefined}>All <span className="ct-n">{n.open}</span></Link>
            {FACTORY_PHASES.map((p) => (
              <Link key={p.code} href={href("open", p.code)} aria-current={phase === p.code ? "true" : undefined} data-zero={n.byPhase[p.code] === 0 || undefined}>
                {p.label} <span className="ct-n" data-alert={n.overdueByPhase[p.code] > 0 || undefined}>{n.byPhase[p.code]}</span>
              </Link>
            ))}
          </div>
        )}
      </nav>
      {show === "open" && hasRoles && (
        <p className="small muted fq-intro">{n.mine ? `${n.mine} step${n.mine === 1 ? "" : "s"} wait for your department. They come first in each step.` : "No step waits for your department right now."}</p>
      )}
      {show === "closed" && <p className="small muted fq-intro">Closed in the last {RECENT_CLOSED_DAYS} days.</p>}
      {groups.length === 0 ? (
        <p className="home-allclear fq-empty">
          <CheckCircle size={22} weight="fill" aria-hidden />
          <span>
            {show === "closed" ? `Nothing closed in the last ${RECENT_CLOSED_DAYS} days.` : phaseLabel ? `No open complaints at ${phaseLabel}. ` : "No open complaints. "}
            {phaseLabel && <Link href={href("open", "all")}>Show all open</Link>}
          </span>
        </p>
      ) : (
        groups.map((g) => <Group key={g.stage} g={g} showPhase={phase === "all" && show === "open"} />)
      )}
    </div>
  );
}
