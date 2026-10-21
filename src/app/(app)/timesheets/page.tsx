import { session } from "@/server/session";
import { timesheet } from "@/server/queries/time";
import { listEmployees } from "@/server/queries/people";
import { listProjects } from "@/server/queries/projects";
import { AppError } from "@/server/errors";
import { addDays, isLocalDate, localDateOf, weekday } from "@/lib/dates";
import { clock, hours, TZ, when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, Notice, PageHeader, Tabs } from "@/components/ui/Notice";
import { TimeEntryForm } from "@/components/time/TimeEntryForm";
import { EntryActions } from "@/components/time/EntryActions";
import { MonthPanel } from "@/components/time/MonthPanel";

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
  const person = people.find((p) => p.id === employeeId);
  const own = employeeId === actor.id;
  const base = `/timesheets?employee=${employeeId}`;
  const totals = ts.entries.reduce((a, e) => ({ net: a.net + e.netMinutes, within: a.within + e.withinScheduleMinutes, outside: a.outside + e.outsideScheduleMinutes }), { net: 0, within: 0, outside: 0 });
  return (
    <>
      <PageHeader title="Timesheets" subtitle={`${person?.name ?? "Employee"} (${person?.business_id ?? ""}) · times in ${ts.timezone}. Actual time is never reduced by an overtime decision.`} />
      {people.length > 1 && (
        <form className="row card no-print" aria-label="Choose employee">
          <input type="hidden" name="tab" value={tab} />
          <div className="field" style={{ minWidth: 260 }}><label htmlFor="ts-emp">Employee</label>
            <select id="ts-emp" name="employee" defaultValue={employeeId}>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.business_id})</option>)}</select></div>
          <button type="submit" style={{ alignSelf: "flex-end" }}>Show</button>
        </form>
      )}
      <Tabs current={tab} items={[{ id: "week", label: "Week", href: `${base}&tab=week&from=${from}` }, { id: "month", label: `Month settlement (${ts.month})`, href: `${base}&tab=month&month=${ts.month}` }]} />
      {tab === "week" ? (
        <>
          <div className="spread no-print">
            <div className="row"><a className="button" href={`${base}&from=${addDays(from, -7)}`}>← Previous week</a><a className="button" href={`${base}&from=${monday}`}>This week</a><a className="button" href={`${base}&from=${addDays(from, 7)}`}>Next week →</a></div>
            <span className="small muted">Week of {from}</span>
          </div>
          <section className="card stack" aria-labelledby="h-entries">
            <h2 id="h-entries">Recorded activity</h2>
            {ts.entries.length === 0 ? <Empty>No entries this week.</Empty> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>Activity</th><th>Start → end</th><th>Breaks</th><th className="num">Net</th><th className="num">Within schedule</th><th className="num">Outside schedule</th><th>State</th><th>Overtime eligibility</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{ts.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.date}{e.crossesMidnight && <div className="small muted">crosses midnight</div>}</td>
                    <td>{e.activity}<div className="small muted">{e.visit ?? e.overhead_category ?? e.project ?? ""}</div></td>
                    <td>{clock(e.start, ts.timezone)} → {e.crossesMidnight ? when(e.end, ts.timezone) : clock(e.end, ts.timezone)}</td>
                    <td className="small">{e.breaks.map((b) => `${clock(b.start, ts.timezone)}–${clock(b.end, ts.timezone)}`).join(", ") || "—"}</td>
                    <td className="num">{hours(e.netMinutes)}</td><td className="num">{hours(e.withinScheduleMinutes)}</td><td className="num">{hours(e.outsideScheduleMinutes)}</td>
                    <td><Badge state={e.state} />{e.revision_no > 1 && <div className="small muted">revision {e.revision_no}</div>}{e.is_exception && <div><Badge state={e.exception_resolved ? "approved" : "pending"} label={e.exception_resolved ? "Exception resolved" : "Unbooked: exception"} /></div>}{e.review_note && <div className="small">“{e.review_note}”</div>}</td>
                    <td className="small">{e.requests.length === 0 ? "—" : e.requests.map((r) => <div key={r.id}><Badge state={r.decision} /> {clock(r.start, ts.timezone)}–{clock(r.end, ts.timezone)}<br />{r.decision_explanation ?? `Claimed: ${r.claimed_reason}`}</div>)}</td>
                    <td><EntryActions entry={{ id: e.id, state: e.state, version: e.version, date: e.date, endDate: localDateOf(e.end, ts.timezone), start: clock(e.start, ts.timezone), end: clock(e.end, ts.timezone), activity: e.activity, projectId: e.project_id, visitId: e.visit_id, overhead: e.overhead_category, timezone: ts.timezone }} employeeId={employeeId} canAct={own || actor.role !== "employee"} /></td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><th colSpan={4}>Week total</th><th className="num">{hours(totals.net)}</th><th className="num">{hours(totals.within)}</th><th className="num">{hours(totals.outside)}</th><th colSpan={3} /></tr></tfoot>
              </table></div>
            )}
            <p className="small muted">Outside-schedule time is a fact about when work happened, not overtime approval. Verified catch-up on the original assigned target is ineligible for internal overtime under the confirmed rule.</p>
          </section>
          <div className="grid cols-2">
            <section className="card stack" aria-labelledby="h-new">
              <h2 id="h-new">Record actual time</h2>
              {own || actor.role !== "employee" ? <TimeEntryForm employeeId={employeeId} timezone={ts.timezone} defaultDate={today} projects={projects.map((p) => ({ id: p.id, label: `${p.business_id} · ${p.name}` }))} visits={visits} /> : <p className="muted">You can only record your own time.</p>}
            </section>
            <section className="card stack" aria-labelledby="h-exp">
              <h2 id="h-exp">Planned from assignments</h2>
              <p className="small muted">Shown for reference. Expected work is never turned into actual attendance.</p>
              {ts.expected.length === 0 ? <p className="muted">No bookings this week.</p> : <ul className="small">{ts.expected.map((x, i) => <li key={i}>{x.visit} · {x.project}: {when(x.start, ts.timezone)} → {when(x.end, ts.timezone)} ({x.state})</li>)}</ul>}
              {ts.history.length > 0 && <details><summary>Replaced revisions ({ts.history.length})</summary><ul className="small">{ts.history.map((h) => <li key={h.id}>Revision {h.revision_no}: {when(h.start, ts.timezone)} → {when(h.end, ts.timezone)} ({h.state}){h.review_note ? `: “${h.review_note}”` : ""}</li>)}</ul></details>}
            </section>
          </div>
        </>
      ) : (
        <MonthPanel employeeId={employeeId} month={ts.month} recon={ts.reconciliation} missingDates={ts.missingDates} stored={ts.storedState} role={actor.role} own={own} />
      )}
    </>
  );
}
