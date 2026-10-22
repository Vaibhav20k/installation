/** Customer coordination tab: journey owner and stage, checklist, communication log, design/measurement requests. */
import type { customerDetail } from "@/server/services/customer";
import { when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Notice";
import { CommunicationForm, DecideDesign, DesignRequestForm, JourneyForm, ObligationForm, ObligationToggle, RevisionForm, STAGE_LABEL } from "./CustomerForms";

type Detail = Awaited<ReturnType<typeof customerDetail>>;
const ACK: Record<string, string> = { not_requested: "Not asked", awaiting: "Waiting for customer", acknowledged_by_customer: "Customer confirmed" };

export function CustomerPanel({ projectId, c, items, today, canEdit, isManager, actorId }: { projectId: string; c: Detail; items: Array<{ id: string; label: string }>; today: string; canEdit: boolean; isManager: boolean; actorId: string }) {
  const overdue = c.obligations.filter((o) => o.status === "open" && o.due_date && o.due_date < today).length;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" aria-labelledby="h-jr">
        <h2 id="h-jr">Customer journey</h2>
        <p style={{ margin: 0 }}><strong>{c.journey ? STAGE_LABEL[c.journey.stage] : "Not started"}</strong>{c.journey?.owner ? ` · owner ${c.journey.owner}` : " · no owner assigned"}{overdue ? <> · <Badge state="fail" tone="bad" label={`${overdue} overdue`} /></> : null}</p>
        {canEdit && <JourneyForm projectId={projectId} current={c.journey} staff={c.staff} />}
        {c.obligations.length === 0 ? <Empty>No checklist items yet.</Empty> : (
          <ul className="req-list">
            {c.obligations.map((o) => (
              <li key={o.id}><span className="code-tag">{STAGE_LABEL[o.stage]?.toUpperCase()}</span>
                <span>{o.description}<span className="small muted" style={{ display: "block" }}>{o.owner ?? "No owner"}{o.due_date ? ` · due ${o.due_date}` : ""}</span>{canEdit && <ObligationToggle id={o.id} status={o.status} />}</span>
                <Badge state={o.status === "done" ? "completed" : o.status === "not_applicable" ? "na" : o.due_date && o.due_date < today ? "expired" : "open"} label={o.status === "open" && o.due_date && o.due_date < today ? "Overdue" : undefined} /></li>
            ))}
          </ul>
        )}
        {canEdit && <details><summary className="button">Add a checklist item</summary><ObligationForm projectId={projectId} staff={c.staff} /></details>}
      </section>

      <section className="card stack" aria-labelledby="h-cl">
        <h2 id="h-cl">Communication log ({c.logs.length})</h2>
        {c.logs.length === 0 ? <Empty>Nothing logged yet.</Empty> : (
          <ul className="req-list">
            {c.logs.map((l) => (
              <li key={l.id}><span className="code-tag">{l.channel.replace("_", " ").toUpperCase()}</span>
                <span><strong>{l.summary}</strong><span className="small muted" style={{ display: "block" }}>{l.direction.replace(/_/g, " ")} · {when(l.occurred_at)} · {l.by ?? "unknown"}{l.commitment ? ` · committed: ${l.commitment}` : ""}{l.next_action ? ` · next: ${l.next_action}` : ""}{l.due_date ? ` by ${l.due_date}` : ""}</span></span>
                <Badge state={l.acknowledgement === "acknowledged_by_customer" ? "completed" : l.acknowledgement === "awaiting" ? "pending" : "na"} label={ACK[l.acknowledgement]} /></li>
            ))}
          </ul>
        )}
        <details><summary className="button">Log a conversation</summary><CommunicationForm projectId={projectId} today={today} /></details>
      </section>

      <section className="card stack" aria-labelledby="h-dr">
        <h2 id="h-dr">Design and measurement requests ({c.designs.length})</h2>
        <p className="small muted" style={{ margin: 0 }}>Revision limit: {c.revisionLimit === null ? "not configured. The meeting proposals conflict, so nothing is blocked and drafts are always allowed." : `${c.revisionLimit} approved revisions; later ones need escalation.`}</p>
        {c.designs.length === 0 ? <Empty>No requests.</Empty> : (
          <ul className="req-list">
            {c.designs.map((d) => (
              <li key={d.id}><span className="code-tag">{d.business_id}</span>
                <span><strong>{d.kind === "measurement" ? "Measurement" : "Design"}: {d.brief}</strong>
                  <span className="small muted" style={{ display: "block" }}>{d.item ?? "Whole project"} · asked by {d.origin.replace("_", " ")} · {d.reason}{d.requested_skills ? ` · skills: ${d.requested_skills}` : ""}{d.appliance_brief ? ` · appliances: ${d.appliance_brief}` : ""} · {d.by ?? "unknown"}</span>
                  {d.revisions.length > 0 && <span className="small" style={{ display: "block" }}>{d.revisions.map((r) => `r${r.seq} ${r.cause.replace(/_/g, " ")}${r.needs_escalation ? " (escalate)" : ""}`).join(" · ")}</span>}
                  {d.status !== "rejected" && <details><summary className="small">Add a revision</summary><RevisionForm requestId={d.id} limit={c.revisionLimit} /></details>}
                  {isManager && ["draft", "submitted"].includes(d.status) && d.created_by !== actorId && <DecideDesign id={d.id} />}</span>
                <Badge state={d.status === "draft" ? "draft" : d.status === "submitted" ? "submitted" : d.status} /></li>
            ))}
          </ul>
        )}
        <details><summary className="button">New design or measurement request</summary><DesignRequestForm projectId={projectId} items={items} /></details>
      </section>
    </div>
  );
}
