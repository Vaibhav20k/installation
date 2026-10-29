/**
 * The Complaints view: each missing or damaged item the Installation Manager raised, as a card with the five
 * factory phases (Planning → Purchase → QC → Production → Dispatched) and who it waits for, in plain words.
 * The whole card opens the complaint (one stretched link on the item name, so a screen reader hears the item,
 * not the whole card). Filters are plain links, so the view works and can be shared without JavaScript.
 * Server components only.
 */
import Link from "next/link";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { PHASES, phaseTrack, type PhaseCode, type PhaseTrack } from "@/domain/complaint-phases";
import { RECENT_CLOSED_DAYS, trackerCounts, type TrackedComplaint } from "@/server/queries/complaint-tracker";
import { TZ } from "@/lib/format";

const STATE_TEXT = { done: "done", current: "now", todo: "to come", skipped: "item was in stock" } as const;
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: TZ });
const shortDay = (ms: number) => dateFmt.format(ms);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Five dots on one line, the current phase filled and labelled; skipped phases are drawn hollow and dashed. */
export function PhaseDots({ track, large }: { track: PhaseTrack; large?: boolean }) {
  return (
    <ol className="ct-dots" data-size={large ? "lg" : undefined} aria-label="Factory progress">
      {track.steps.map((s) => (
        <li key={s.code} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
          <span className="ct-dot" aria-hidden>{s.state === "done" && <Check size={large ? 12 : 10} weight="bold" />}</span>
          <span className="ct-dot-label">{s.label}{s.state === "skipped" && <span className="ct-dot-note">skipped</span>}<span className="sr-only">: {STATE_TEXT[s.state]}</span></span>
        </li>
      ))}
    </ol>
  );
}

/** "Waiting for Planning team · Management approval": the phase owner first, the exact step as a quiet detail. */
function Waiting({ track, stageLabel }: { track: PhaseTrack; stageLabel: string }) {
  if (!track.waitingFor) return <p className="ct-status">{track.says}</p>;
  const detail = track.waitingFor.toLowerCase() === stageLabel.toLowerCase() ? null : stageLabel;
  return <p className="ct-status">Waiting for <strong>{track.waitingFor}</strong>{detail && <span className="ct-status-step"> · {detail}</span>}</p>;
}

/**
 * The same tracker at the top of a complaint's page: one sentence on what is happening, then the five phases.
 * The detailed thirteen-step stepper stays below it for the departments.
 */
export function PhaseStrip({ k }: { k: { stage: string; status: string; item_source: string | null; outcome: string | null; step?: { label: string; owner: string; terminal?: boolean } } }) {
  const track = phaseTrack({ stage: k.stage, status: k.status, itemSource: k.item_source, owner: k.step?.owner, terminal: k.step?.terminal, outcome: k.outcome });
  const stageLabel = k.step?.label ?? k.stage;
  return (
    <section className="ct-strip" aria-label="Where the factory is">
      <Waiting track={track} stageLabel={stageLabel} />
      {track.waitingFor && <p className="ct-strip-says small">{track.says}</p>}
      <PhaseDots track={track} large />
    </section>
  );
}

function Card({ c }: { c: TrackedComplaint }) {
  const open = c.status === "open";
  return (
    <li className="ct-card" data-overdue={c.overdue || undefined} data-status={c.status} data-priority={c.priority ?? undefined}>
      <div className="ct-card-top">
        <span className="ct-kind" data-kind={c.kind}>{c.kind === "missing" ? "Missing" : "Damaged"} · {c.quantity}{c.unit ? ` ${c.unit}` : ""}</span>
        {/* PRIORITY HOOK: shown only when complaint.priority exists and is raised above normal. */}
        {(c.priority === "high" || c.priority === "urgent") && <span className="ct-priority" data-level={c.priority}>{c.priority === "urgent" ? "Urgent" : "High priority"}</span>}
        <span className="code-tag ct-code">{c.business_id}</span>
      </div>
      <h3 className="ct-title"><Link className="ct-link" href={`/dispatch/complaints/${c.id}`}>{c.item}</Link></h3>
      <p className="ct-sub small">{c.order} · {c.customer} · {c.project}</p>
      <PhaseDots track={c.track} />
      <Waiting track={c.track} stageLabel={c.stage_label} />
      <p className="ct-meta small">
        <span>Raised {shortDay(c.raised_at)}{c.raised_by_me ? " by you" : ""}</span>
        {open ? <span data-tone={c.overdue ? "bad" : undefined}>{c.days_in_stage === 0 ? "In this step since today" : `${plural(c.days_in_stage, "day")} in this step`}{c.overdue ? " · overdue" : ""}</span>
          : <span>Closed {c.closed_at ? shortDay(c.closed_at) : ""}</span>}
      </p>
    </li>
  );
}

function Section({ title, list, tone }: { title: string; list: TrackedComplaint[]; tone?: "bad" }) {
  if (!list.length) return null;
  return (
    <section className="stack ct-section" style={{ gap: 8 }} aria-label={title} data-tone={tone}>
      <h2 className="flow-subhead">{title} <span className="flow-count">{list.length}</span></h2>
      <ul className="ct-cards">{list.map((c) => <Card key={c.id} c={c} />)}</ul>
    </section>
  );
}

const href = (show: "open" | "closed", phase?: PhaseCode) => `/dispatch?view=complaints${show === "closed" ? "&show=closed" : ""}${phase ? `&phase=${phase}` : ""}`;

export function parseTrackerFilter(sp: { show?: string; phase?: string }) {
  const show: "open" | "closed" = sp.show === "closed" ? "closed" : "open";
  const phase = show === "open" ? PHASES.find((p) => p.code === sp.phase)?.code : undefined;
  return { show, phase };
}

export function ComplaintTracker({ list, show, phase }: { list: TrackedComplaint[]; show: "open" | "closed"; phase?: PhaseCode }) {
  const n = trackerCounts(list);
  if (!list.length) {
    return <div className="empty ct-empty">No open complaints, and none closed in the last {RECENT_CLOSED_DAYS} days. When you mark something missing or damaged on receipt, it shows here and you can follow it through the factory.</div>;
  }
  const shown = list.filter((c) => c.status === show && (!phase || c.track.phase === phase));
  const mine = shown.filter((c) => c.raised_by_me);
  const others = shown.filter((c) => !c.raised_by_me);
  const phaseLabel = phase ? PHASES.find((p) => p.code === phase)!.label : null;
  return (
    <div className="stack ct">
      <p className="small muted ct-intro">Missing and damaged items, and where the factory is with each replacement. Tap one for the full history.</p>
      <nav className="ct-filters" aria-label="Filter complaints">
        <div className="ct-seg" role="group" aria-label="Open or closed">
          <Link href={href("open")} aria-current={show === "open" ? "true" : undefined}>Open <span className="ct-n" data-alert={n.overdue > 0 || undefined}>{n.open}</span></Link>
          <Link href={href("closed")} aria-current={show === "closed" ? "true" : undefined}>Closed <span className="ct-n">{n.closed}</span></Link>
        </div>
        {show === "open" && (
          <div className="ct-chips" role="group" aria-label="Phase">
            <Link href={href("open")} aria-current={!phase ? "true" : undefined}>All phases</Link>
            {PHASES.map((p) => (
              <Link key={p.code} href={href("open", p.code)} aria-current={phase === p.code ? "true" : undefined} data-zero={n.byPhase[p.code] === 0 || undefined}>
                {p.label} <span className="ct-n">{n.byPhase[p.code]}</span>
              </Link>
            ))}
          </div>
        )}
      </nav>
      {show === "closed" && <p className="small muted ct-intro">Closed in the last {RECENT_CLOSED_DAYS} days.</p>}
      {!shown.length ? (
        <div className="empty ct-empty">
          {show === "closed" ? `Nothing closed in the last ${RECENT_CLOSED_DAYS} days.` : phaseLabel ? `No open complaints at ${phaseLabel} right now. ` : "Nothing open. Every replacement has arrived. "}
          {phaseLabel && <Link href={href("open")}>Show all open</Link>}
        </div>
      ) : mine.length && others.length ? (
        <>
          <Section title="Raised by you" list={mine} tone={mine.some((c) => c.overdue) ? "bad" : undefined} />
          <Section title="Others on your projects" list={others} tone={others.some((c) => c.overdue) ? "bad" : undefined} />
        </>
      ) : (
        <Section title={show === "closed" ? "Closed" : phaseLabel ? `At ${phaseLabel}` : "Open complaints"} list={shown} tone={shown.some((c) => c.overdue) ? "bad" : undefined} />
      )}
    </div>
  );
}
