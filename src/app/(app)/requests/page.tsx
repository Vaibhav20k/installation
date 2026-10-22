import { session } from "@/server/session";
import { myRequests } from "@/server/queries/attendance";
import { employeeCalendar } from "@/server/services/time";
import { localDateOf } from "@/lib/dates";
import { when } from "@/lib/format";
import { shortDate } from "@/domain/install-schedule";
import { Badge } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";
import { LeaveRequestForm } from "@/components/attendance/LeaveRequestForm";

export const metadata = { title: "My requests" };

export default async function RequestsPage() {
  const { db, actor } = await session();
  const cal = await employeeCalendar(db, actor.id);
  const today = localDateOf(Date.now(), cal.timezone);
  const r = await myRequests(db, actor.id);
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 820, width: "100%" }}>
      <PageHeader title="My requests" subtitle="Leave, attendance corrections and the review of time recorded after 8 hours, in one inbox." />
      <section className="plate" aria-labelledby="h-leave">
        <div className="plate-head"><h2 id="h-leave" style={{ margin: 0 }}>Ask for leave or report unavailability</h2></div>
        <LeaveRequestForm today={today} />
      </section>
      <section className="plate" aria-labelledby="h-list">
        <div className="plate-head"><h2 id="h-list" style={{ margin: 0 }}>Status</h2><span className="code-tag">{r.leave.length + r.corrections.length + r.overtime.length} items</span></div>
        {r.leave.length + r.corrections.length + r.overtime.length === 0 ? <Empty>No requests yet.</Empty> : (
          <ul className="req-list">
            {r.leave.map((l) => (
              <li key={l.id}><span className="code-tag">{l.kind === "leave" ? "LEAVE" : "UNAVAILABLE"}</span><span><strong>{shortDate(l.start_date)}{l.end_date !== l.start_date ? ` to ${shortDate(l.end_date)}` : ""}</strong><span className="small muted"> · {l.reason}</span>{l.decision_note && <span className="small" style={{ display: "block" }}>Note: {l.decision_note}</span>}</span><Badge state={l.status} /></li>
            ))}
            {r.corrections.map((c) => (
              <li key={c.id}><span className="code-tag">CORRECTION</span><span><strong>{c.field === "clock_in" ? "Clock-in" : "Clock-out"} on {shortDate(c.work_date)} → {when(c.requested_at)}</strong><span className="small muted"> · {c.reason}</span>{c.decision_note && <span className="small" style={{ display: "block" }}>Note: {c.decision_note}</span>}</span><Badge state={c.status} /></li>
            ))}
            {r.overtime.map((o) => (
              <li key={o.id}><span className="code-tag">AFTER 8 H</span><span><strong>{when(o.lo)} → {when(o.hi)}</strong><span className="small muted"> · {o.claimed_reason}</span>{o.decision_explanation && <span className="small" style={{ display: "block" }}>{o.decision_explanation}</span>}</span><Badge state={o.decision} /></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
