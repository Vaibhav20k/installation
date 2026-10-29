import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { session } from "@/server/session";
import { timesheet } from "@/server/queries/time";
import { listEmployees } from "@/server/queries/people";
import { listProjects } from "@/server/queries/projects";
import { AppError } from "@/server/errors";
import { addDays, isLocalDate, localDateOf, weekday } from "@/lib/dates";
import { clock, hours, TZ, when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, Notice, PageHeader, Tabs } from "@/components/ui/Notice";
import { ActionButton } from "@/components/ui/ActionButton";
import { submitTimeEntries } from "../../actions";
import { TimeEntryForm } from "@/components/time/TimeEntryForm";
import { EntryActions } from "@/components/time/EntryActions";
import { MonthPanel } from "@/components/time/MonthPanel";
import { loadApprovals } from "@/components/approvals/waiting";
import { WaitingStrip } from "@/components/approvals/Queue";

export const metadata = { title: "Timesheets" };

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const now = Date.now();
  const people = await listEmployees(db, actor);
  const employeeId = sp.employee && people.some((p) => p.id === sp.employee) ? sp.employee : actor.id;
  const today = localDateOf(now, TZ);
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const from = sp.from && isLocalDate(sp.from) ? sp.from : monday;
  const tab = sp.tab === "month" ? "month" : "week";
  let ts;
  try { ts = await timesheet(db, actor, employeeId, tab === "month" ? { from: `${(sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : from.slice(0, 7))}-01`, days: 31 } : { from, days: 7 }, now); } catch (e) {
    if (e instanceof AppError) return <Notice tone="warn" title="Not available">{e.message}</Notice>;
    throw e;
  }
  const projects = await listProjects(db, actor);
  const visits = await db.query<{ id: string; business_id: string; project_id: string }>(
    "select v.id, v.business_id, v.project_id from visit v where v.project_id = any($1::uuid[]) and v.exec_status <> 'cancelled' order by v.business_id", [projects.map((p) => p.id)]);
  // Team time waiting for this viewer's decision comes first (supervisors and managers only).
  const teamQueues = actor.role === "employee" ? [] : (await loadApprovals(db, actor, now)).queues.filter((q) => q.id === "time" || q.id === "overtime");
  const person = people.find((p) => p.id === employeeId);
  const own = employeeId === actor.id;
  const canAct = own || actor.role !== "employee";
  const base = `/timesheets?employee=${employeeId}`;
  const totals = ts.entries.reduce((a, e) => ({ net: a.net + e.netMinutes, within: a.within + e.withinScheduleMinutes, outside: a.outside + e.outsideScheduleMinutes }), { net: 0, within: 0, outside: 0 });
  const drafts = canAct ? ts.entries.filter((e) => e.state === "draft") : [];
  const returned = canAct ? ts.entries.filter((e) => e.state === "returned") : [];
  const who = own ? "you" : person?.name ?? "this person";
  return (
    <div className="inbox-page">
      <PageHeader title="Timesheets" subtitle={`${person?.name ?? "Employee"} (${person?.business_id ?? ""}) · times in ${ts.timezone}. Hours worked are never cut by an overtime decision.`} />
      <WaitingStrip queues={teamQueues} base="/approvals" clearText={null} />
      {tab === "week" && drafts.length + returned.length > 0 && (
        <div className="notice" data-tone="warn">
          <div className="spread">
            <span>
              <strong>{drafts.length + returned.length} {drafts.length + returned.length === 1 ? "entry needs" : "entries need"} {who} this week.</strong>{" "}
              {[drafts.length > 0 && `${drafts.length} not sent for review yet`, returned.length > 0 && `${returned.length} sent back to fix (use Correct… on the marked row)`].filter(Boolean).join(" · ")}
            </span>
            {drafts.length > 0 && <ActionButton action={submitTimeEntries} input={{ entryIds: drafts.map((d) => d.id) }} label={drafts.length === 1 ? "Send for review" : `Send all ${drafts.length} for review`} tone="primary" successText="Sent for review." />}
          </div>
        </div>
      )}
      {people.length > 1 && (
        <form className="row card no-print inbox-filter" aria-label="Choose employee">
          <input type="hidden" name="tab" value={tab} />
          <div className="field"><label htmlFor="ts-emp">Employee</label>
            <select id="ts-emp" name="employee" defaultValue={employeeId}>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.business_id})</option>)}</select></div>
          <button type="submit">Show</button>
        </form>
      )}
      <Tabs current={tab} items={[{ id: "week", label: "Week", href: `${base}&tab=week&from=${from}` }, { id: "month", label: `Month settlement (${ts.month})`, href: `${base}&tab=month&month=${ts.month}` }]} />
      {tab === "week" ? (
        <>
          <div className="spread no-print">
            <div className="row"><Link className="button" href={`${base}&from=${addDays(from, -7)}`} aria-label="Previous week"><CaretLeft size={16} aria-hidden /> Previous</Link><Link className="button" href={`${base}&from=${monday}`}>This week</Link><Link className="button" href={`${base}&from=${addDays(from, 7)}`} aria-label="Next week">Next <CaretRight size={16} aria-hidden /></Link></div>
            <span className="small muted">Week of {from}</span>
          </div>
          <section className="card stack" aria-labelledby="h-entries">
            <div className="inbox-head"><h2 id="h-entries">Recorded time</h2>{ts.entries.length > 0 && <span className="small">Net this week: <strong>{hours(totals.net)}</strong></span>}</div>
            {ts.entries.length === 0 ? <Empty>No time recorded this week. Use Record actual time below to add it.</Empty> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>Work</th><th>Start → end</th><th>Breaks</th><th className="num">Net</th><th className="num">Within schedule</th><th className="num">Outside schedule</th><th>Status</th><th>Overtime check</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{ts.entries.map((e) => (
                  <tr key={e.id} data-needs={(canAct && (e.state === "draft" || e.state === "returned")) || undefined}>
                    <td>{e.date}{e.crossesMidnight && <div className="small muted">crosses midnight</div>}</td>
                    <td>{e.activity}<div className="small muted">{e.visit ?? e.overhead_category ?? e.project ?? ""}</div></td>
                    <td>{clock(e.start, ts.timezone)} → {e.crossesMidnight ? when(e.end, ts.timezone) : clock(e.end, ts.timezone)}</td>
                    <td className="small">{e.breaks.map((b) => `${clock(b.start, ts.timezone)}–${clock(b.end, ts.timezone)}`).join(", ") || "—"}</td>
                    <td className="num">{hours(e.netMinutes)}</td><td className="num">{hours(e.withinScheduleMinutes)}</td><td className="num">{hours(e.outsideScheduleMinutes)}</td>
                    <td><Badge state={e.state} />{e.revision_no > 1 && <div className="small muted">revision {e.revision_no}</div>}{e.is_exception && <div><Badge state={e.exception_resolved ? "approved" : "pending"} label={e.exception_resolved ? "Exception cleared" : "Not booked"} /></div>}{e.review_note && <div className="small">“{e.review_note}”</div>}</td>
                    <td className="small">{e.requests.length === 0 ? "—" : e.requests.map((r) => <div key={r.id}><Badge state={r.decision} /> {clock(r.start, ts.timezone)}–{clock(r.end, ts.timezone)}<br />{r.decision_explanation ?? `Claimed: ${r.claimed_reason}`}</div>)}</td>
                    <td><EntryActions entry={{ id: e.id, state: e.state, version: e.version, date: e.date, endDate: localDateOf(e.end, ts.timezone), start: clock(e.start, ts.timezone), end: clock(e.end, ts.timezone), activity: e.activity, projectId: e.project_id, visitId: e.visit_id, overhead: e.overhead_category, timezone: ts.timezone }} employeeId={employeeId} canAct={canAct} /></td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><th colSpan={4}>Week total</th><th className="num">{hours(totals.net)}</th><th className="num">{hours(totals.within)}</th><th className="num">{hours(totals.outside)}</th><th colSpan={3} /></tr></tfoot>
              </table></div>
            )}
            <p className="small muted" style={{ margin: 0 }}>Outside-schedule time only records when the work happened; it is not an overtime approval. Catching up on the original job does not count as overtime.</p>
          </section>
          <div className="grid cols-2">
            <section className="card stack" aria-labelledby="h-new">
              <h2 id="h-new" style={{ margin: 0 }}>Record actual time</h2>
              {canAct ? <TimeEntryForm employeeId={employeeId} timezone={ts.timezone} defaultDate={today} projects={projects.map((p) => ({ id: p.id, label: `${p.business_id} · ${p.name}` }))} visits={visits} /> : <p className="muted" style={{ margin: 0 }}>You can only record your own time.</p>}
            </section>
            <section className="card stack" aria-labelledby="h-exp">
              <h2 id="h-exp" style={{ margin: 0 }}>Planned from assignments</h2>
              <p className="small muted" style={{ margin: 0 }}>For reference only. Planned work never counts as time worked.</p>
              {ts.expected.length === 0 ? <p className="muted" style={{ margin: 0 }}>No bookings this week.</p> : <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{ts.expected.map((x, i) => <li key={i}>{x.visit} · {x.project}: {when(x.start, ts.timezone)} → {when(x.end, ts.timezone)} ({x.state})</li>)}</ul>}
              {ts.history.length > 0 && <details><summary>Replaced revisions ({ts.history.length})</summary><ul className="small">{ts.history.map((h) => <li key={h.id}>Revision {h.revision_no}: {when(h.start, ts.timezone)} → {when(h.end, ts.timezone)} ({h.state}){h.review_note ? `: “${h.review_note}”` : ""}</li>)}</ul></details>}
            </section>
          </div>
        </>
      ) : (
        <MonthPanel employeeId={employeeId} month={ts.month} recon={ts.reconciliation} missingDates={ts.missingDates} stored={ts.storedState} role={actor.role} own={own} />
      )}
    </div>
  );
}
