/**
 * Read-only pieces shared by the dispatch and complaint screens: the stage stepper, the history timeline with
 * its attachments, and the task cards used on the lists. Server components (the stepper's sideways scroll to the
 * current step is the one small client piece).
 */
import Link from "next/link";
import { FilePdf, Paperclip } from "@phosphor-icons/react/dist/ssr";
import type { FlowDefinition } from "@/domain/flow";
import type { FlowItem, HistoryRow } from "@/server/queries/dispatch";
import { when } from "@/lib/format";
import { shortDate } from "@/domain/install-schedule";
import { StepperScroll } from "./StepperScroll";

/** Main path only (branches to later stages show as skipped); the current stage is marked for screen readers. */
export function Stepper({ def, current, status }: { def: FlowDefinition; current: string; status: string }) {
  const idx = def.stages.findIndex((s) => s.code === current);
  const steps = def.stages.filter((s) => s.owner !== "system" || s.terminal);
  return (
    <StepperScroll><ol className="flow-stepper" aria-label="Stages">
      {steps.map((s) => {
        const i = def.stages.indexOf(s);
        const state = status !== "open" ? (s.terminal ? "current" : "done") : i < idx ? "done" : i === idx ? "current" : "todo";
        return <li key={s.code} data-state={state} aria-current={state === "current" ? "step" : undefined}><span className="flow-stepper-dot" aria-hidden /><span className="flow-stepper-label">{s.label}</span></li>;
      })}
    </ol></StepperScroll>
  );
}

const KIND: Record<string, string> = { create: "Created", forward: "Completed", back: "Sent back", hold: "On hold", close: "Closed" };
const HIDE = new Set(["files", "note", "replacement_for", "reason"]);

function detail(data: Record<string, unknown>) {
  return Object.entries(data).filter(([k, v]) => !HIDE.has(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
}

export function Timeline({ rows, def }: { rows: HistoryRow[]; def: FlowDefinition }) {
  const label = (c: string | null) => (c ? def.stages.find((s) => s.code === c)?.label ?? c.replace(/_/g, " ") : "");
  return (
    <ol className="timeline">
      {rows.slice().reverse().map((h) => (
        <li key={h.id} data-kind={h.kind}>
          <div className="spread"><strong>{KIND[h.kind] ?? h.kind}: {h.kind === "back" || h.kind === "create" ? `${label(h.from_stage) || "new"} → ${label(h.to_stage)}` : h.kind === "hold" ? label(h.to_stage) : label(h.from_stage) || label(h.to_stage)}</strong>
            <span className="small muted">{when(Number(h.at))}</span></div>
          <span className="small muted">{h.actor ?? "System"}</span>
          {typeof h.data.note === "string" && h.data.note && <p className="small" style={{ margin: "2px 0 0" }}>{h.data.note}</p>}
          {h.reason && <p className="small" style={{ margin: "2px 0 0" }}><em>Reason:</em> {h.reason}</p>}
          {detail(h.data).length > 0 && <p className="small muted" style={{ margin: "2px 0 0" }}>{detail(h.data).join(" · ")}</p>}
          {h.files.length > 0 && (
            <ul className="timeline-files">
              {h.files.map((f) => (
                <li key={f.id}>{f.media_type === "image"
                  ? <a href={`/api/evidence/file/${f.id}`} target="_blank" rel="noreferrer"><img src={`/api/evidence/file/${f.id}`} alt={f.name} loading="lazy" decoding="async" /></a>
                  : <a href={`/api/evidence/file/${f.id}`} className="timeline-doc">{f.media_type === "document" ? <FilePdf size={18} aria-hidden /> : <Paperclip size={18} aria-hidden />} {f.name}</a>}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

export function ItemCard({ i, showOwner = true }: { i: FlowItem; showOwner?: boolean }) {
  const href = i.type === "dispatch" ? `/dispatch/${i.id}` : `/dispatch/complaints/${i.id}`;
  return (
    <li className="flow-card" data-overdue={i.overdue || undefined} data-type={i.type} data-complaint={i.open_complaints > 0 ? "open" : undefined}>
      <Link href={href}>
        <span className="flow-card-top"><span className="code-tag">{i.business_id} · {i.order}</span>
          <span className="flow-stage">{i.stage_label}</span></span>
        <strong className="flow-card-title">{i.customer} · {i.project}</strong>
        <span className="small">{i.title}</span>
        <span className="flow-meta small">
          {showOwner && <span>{i.owner_name}</span>}
          <span data-tone={i.overdue ? "bad" : undefined}>{i.days_in_stage === 0 ? "today" : `${i.days_in_stage} day${i.days_in_stage === 1 ? "" : "s"} in this step`}{i.overdue ? " · overdue" : ""}</span>
          {i.hold_until && <span data-tone="warn">site not ready until {shortDate(i.hold_until)}</span>}
          {i.open_complaints > 0 && <span className="flow-complaint-mark">{i.open_complaints} open complaint{i.open_complaints === 1 ? "" : "s"}</span>}
          {i.partial && !i.open_complaints && <span data-tone="warn">partial: complaint open</span>}
        </span>
      </Link>
    </li>
  );
}

