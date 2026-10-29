import type { ReactNode } from "react";
import { session } from "@/server/session";
import { myRequests } from "@/server/queries/attendance";
import { employeeCalendar } from "@/server/services/time";
import { localDateOf } from "@/lib/dates";
import { when } from "@/lib/format";
import { shortDate } from "@/domain/install-schedule";
import { Badge } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";
import { LeaveRequestForm } from "@/components/attendance/LeaveRequestForm";
import { loadApprovals } from "@/components/approvals/waiting";
import { WaitingStrip } from "@/components/approvals/Queue";

export const metadata = { title: "My requests" };

interface Item { id: string; tag: string; title: ReactNode; detail: string; note: string | null; state: string; pending: boolean; at: number }

function RequestList({ items }: { items: Item[] }) {
  return (
    <ul className="req-list">
      {items.map((x) => (
        <li key={x.id} data-done={!x.pending || undefined}><span className="code-tag">{x.tag}</span>
          <span><strong>{x.title}</strong><span className="small muted"> · {x.detail}</span>{x.note && <span className="small" style={{ display: "block" }}>{x.note}</span>}</span>
          <Badge state={x.state} /></li>
      ))}
    </ul>
  );
}

export default async function RequestsPage() {
  const { db, actor } = await session();
  const now = Date.now();
  const cal = await employeeCalendar(db, actor.id);
  const today = localDateOf(now, cal.timezone);
  const r = await myRequests(db, actor.id);
  // Supervisors and managers also see what waits on them, linked to To approve.
  const queues = actor.role === "employee" ? [] : (await loadApprovals(db, actor, now)).queues;
  const items: Item[] = [
    ...r.leave.map((l) => ({ id: l.id, tag: l.kind === "leave" ? "LEAVE" : "UNAVAILABLE", title: `${shortDate(l.start_date)}${l.end_date !== l.start_date ? ` to ${shortDate(l.end_date)}` : ""}`, detail: l.reason, note: l.decision_note && `Note: ${l.decision_note}`, state: l.status, pending: l.status === "requested", at: l.created_at })),
    ...r.corrections.map((c) => ({ id: c.id, tag: "CORRECTION", title: `${c.field === "clock_in" ? "Clock-in" : "Clock-out"} on ${shortDate(c.work_date)} → ${when(c.requested_at)}`, detail: c.reason, note: c.decision_note && `Note: ${c.decision_note}`, state: c.status, pending: c.status === "requested", at: c.created_at })),
    ...r.overtime.map((o) => ({ id: o.id, tag: "AFTER 8 H", title: `${when(o.lo)} → ${when(o.hi)}`, detail: o.claimed_reason, note: o.decision_explanation, state: o.decision, pending: o.decision === "requested" || o.decision === "pending_policy", at: o.created_at })),
  ].sort((a, b) => b.at - a.at);
  const pending = items.filter((x) => x.pending);
  const decided = items.filter((x) => !x.pending);
  return (
    <div className="inbox-page" style={{ maxWidth: 820, width: "100%" }}>
      <PageHeader title="My requests" subtitle="Ask for leave, fix a clock-in or clock-out, and follow the review of time worked after 8 hours. Everything you asked for is listed here." />
      <WaitingStrip queues={queues} base="/approvals" clearText={null} />
      {pending.length > 0 && (
        <section className="plate" aria-labelledby="h-pending">
          <div className="plate-head"><h2 id="h-pending" style={{ margin: 0 }}>Waiting for a decision</h2><span className="code-tag">{pending.length}</span></div>
          <RequestList items={pending} />
        </section>
      )}
      <section className="plate" aria-labelledby="h-leave">
        <div className="plate-head"><h2 id="h-leave" style={{ margin: 0 }}>Ask for leave or say you are unavailable</h2></div>
        <LeaveRequestForm today={today} />
      </section>
      <section className="plate" aria-labelledby="h-list">
        <div className="plate-head"><h2 id="h-list" style={{ margin: 0 }}>Decided</h2><span className="code-tag">{decided.length}</span></div>
        {decided.length === 0 ? <Empty>{items.length === 0 ? "No requests yet. When you ask for leave or a correction, it shows here with its decision." : "Nothing decided yet."}</Empty> : <RequestList items={decided} />}
      </section>
    </div>
  );
}
