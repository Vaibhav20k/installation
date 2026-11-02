import Link from "next/link";
import { CaretRight, Clock, MapPin, Package, Warning } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { myDay } from "@/server/queries/time";
import { clock, qty } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import { submitTimeEntries } from "../../actions";
import { DayProgress } from "@/components/time/DayProgress";
import { TimeEntryForm } from "@/components/time/TimeEntryForm";
import { AttendancePanel, type PanelShift } from "@/components/attendance/AttendancePanel";
import { currentAttendance } from "@/server/queries/attendance";
import { autoClosedMessage } from "@/server/services/attendance";
import { AutoClosedNotice } from "@/components/attendance/AutoClosedNotice";
import { shortDate } from "@/domain/install-schedule";
import { AdditionalWorkForm } from "@/components/project/CommercialForms";
import { ScanBox, PackageExceptionForm } from "@/components/project/PackageForms";
import { SiteCheck } from "@/components/install/PresenceForms";
import { CheckRow } from "@/components/install/WorkForms";
import { myPresence, todaysWork } from "@/server/queries/site-ops";
import { addDays, localDateOf } from "@/lib/dates";
import { myMndReports, reportableLines } from "@/server/services/site-mnd";
import { SiteMndReport } from "@/components/install/SiteMndReport";

export const metadata = { title: "My day" };

export default async function MyDayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const now = Date.now();
  const d = await myDay(db, actor, now);
  // Today's work: any chosen date (bounded to a year either side); defaults to today.
  const workDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.workdate ?? "") && Math.abs(Date.parse(sp.workdate!) - now) < 366 * 86400000 ? sp.workdate! : d.today;
  const [presence, work, mndSites, mndMine] = await Promise.all([myPresence(db, actor, now), todaysWork(db, actor, workDate), reportableLines(db, actor, now), myMndReports(db, actor)]);
  const staleOpen = !!presence.open && localDateOf(Number(presence.open.check_in_at), presence.open.timezone) < localDateOf(now, presence.open.timezone);
  const att = await currentAttendance(db, actor, d.today, now);
  const c = att.current;
  const panel: PanelShift | null = c ? {
    shiftId: c.shift.id, state: c.summary.state === "not_started" ? "clocked_out" : c.summary.state, activity: c.summary.activity, t0: Number(c.shift.t0),
    warnAt: Number(c.shift.warn_at), otAt: Number(c.shift.ot_at), timezone: c.shift.timezone, workDate: c.shift.work_date, open: c.summary.open,
    regularWorkMinutes: c.summary.regularWorkMinutes, recordedOvertimeWorkMinutes: c.summary.recordedOvertimeWorkMinutes, breakMinutes: c.summary.breakMinutes,
    lastClockOut: c.summary.lastClockOut, otReason: c.shift.ot_reason,
  } : null;
  const drafts = d.entries.filter((e) => e.state === "draft").map((e) => e.id);
  const first = actor.name.split(" ")[0] ?? actor.name;
  const working = d.visit?.exec_status === "in_progress";
  const next = staleOpen
    ? { title: "Resolve your earlier site check-in", detail: "An earlier site session is still open. Open site check-in to see how to request a correction.", href: "#site-check", label: "Open site check-in" }
    : !panel
      ? { title: "Starting your working day?", detail: "Open attendance below to clock in when you start. Site check-in is separate: it records your location at a site.", href: "#attendance", label: "Open attendance" }
      : !panel.open
        ? { title: drafts.length ? "Review your time before submitting" : "Your attendance session is closed", detail: drafts.length ? "Check today's entries, then submit them for review. Opening this section does not submit anything." : "Review today's recorded time. If a time is incorrect, request a correction from My attendance.", href: "#time", label: "Review time entries" }
        : !presence.open && presence.sites.length > 0
          ? { title: "At your assigned site?", detail: "Use site check-in when you arrive. Your attendance is already running; checking in records where you are working.", href: "#site-check", label: "Open site check-in" }
          : working
            ? { title: "Keep your visit progress up to date", detail: "Open visit quantities to record completed work or report a blocker. Your supervisor accepts the quantities you record.", href: "#progress", label: "Open visit quantities" }
            : { title: "Keep your activity up to date", detail: "Attendance is running. Use its controls to record working, travel, a break or idle time, and clock out when you finish.", href: "#attendance", label: "Open attendance controls" };
  return (
    <div className="stack day-guide daily-workspace" style={{ gap: 16, maxWidth: 820, width: "100%", margin: "0 auto" }}>
      <div>
        <h1>Today, {first}</h1>
        <p className="muted small" style={{ margin: 0 }}>{shortDate(d.today)} · {actor.jobRole.replaceAll("_", " ")} · Your attendance, site work and time records.</p>
      </div>

      <section className="plate next-action" aria-labelledby="h-day-next">
        <span className="section-label">Your next step</span>
        <h2 id="h-day-next">{next.title}</h2>
        <p className="muted">{next.detail}</p>
        <a className="button primary" href={next.href}>{next.label}<CaretRight size={16} aria-hidden /></a>
      </section>
      <nav className="day-jumps row" style={{ flexWrap: "wrap", gap: 8 }} aria-label="On this page">
        <a className="button" href="#attendance">Attendance</a>
        <a className="button" href="#site-check">Site check-in</a>
        <a className="button" href="#work">Daily checklist</a>
        {d.visit && <a className="button" href="#progress">Visit quantities</a>}
        <a className="button" href="#time">Time entries</a>
        {(mndSites.length > 0 || mndMine.length > 0) && <a className="button" href="#report-mnd">Missing or damaged</a>}
        {d.visit && working && <a className="button" href="#receive-packages">Receive packages</a>}
        {d.visit && working && <a className="button" href="#extra-work">Extra work</a>}
      </nav>

      <AutoClosedNotice items={att.missed.filter((m) => m.shift.auto_closed).map((m) => ({ shiftId: m.shift.id, text: autoClosedMessage(m.shift.work_date) }))} />
      <div id="attendance">
      <AttendancePanel shift={panel} serverNow={now} employeeFirstName={first} today={shortDate(d.today)}
        visitLabel={att.visit ? `${att.visit.business_id} · ${att.visit.project}` : d.visit ? `${d.visit.business_id} · ${d.visit.project}` : null} />
      </div>
      {att.missed.some((m) => !m.shift.auto_closed) && (
        <p className="notice" data-tone="warn" role="status">You did not clock out on {att.missed.filter((m) => !m.shift.auto_closed).map((m) => shortDate(m.shift.work_date)).join(", ")}. That day stays provisional; open My attendance and request the correct clock-out time.</p>
      )}

      <section className="plate" id="site-check" aria-labelledby="h-site-check">
        <div className="plate-head"><h2 id="h-site-check" style={{ margin: 0 }}>Site check-in</h2>{presence.open && !staleOpen ? <span className="code-tag">on site</span> : null}</div>
        <p className="small muted">Records your arrival and departure at a site. Use attendance above to start or end your working day.</p>
        <SiteCheck sites={presence.sites} open={presence.open} stale={staleOpen} recent={presence.recent} />
      </section>

      {(mndSites.length > 0 || mndMine.length > 0) && (
        <section className="plate" id="report-mnd" aria-labelledby="h-mnd">
          <div className="plate-head"><h2 id="h-mnd" style={{ margin: 0 }}>Report missing or damaged</h2>{mndMine.some((m) => m.status === "pending") ? <span className="code-tag">{mndMine.filter((m) => m.status === "pending").length} waiting</span> : null}</div>
          <SiteMndReport sites={mndSites} mine={mndMine} />
        </section>
      )}

      <section className="plate" id="work" aria-labelledby="h-work-today">
        <div className="plate-head"><h2 id="h-work-today" style={{ margin: 0 }}>{workDate === d.today ? "Daily checklist" : `Checklist for ${shortDate(workDate)}`}</h2><span className="code-tag">{work.today.filter((i) => i.done_at !== null).length} of {work.today.length} done</span></div>
        <p className="small muted">Mark assigned checklist items done. Record installed quantities separately in Visit quantities.</p>
        <nav className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }} aria-label="Choose a date">
          <Link className="button" href={`/my-day?workdate=${addDays(workDate, -1)}#work`}>Previous day</Link>
          {workDate !== d.today && <Link className="button" href="/my-day#work">Today</Link>}
          <Link className="button" href={`/my-day?workdate=${addDays(workDate, 1)}#work`}>Next day</Link>
        </nav>
        {work.overdue.length > 0 && (
          <>
            <h3 className="section-label" style={{ color: "var(--signal)" }}>Not done from earlier days <span className="code">{work.overdue.length}</span></h3>
            <ul className="check-list" style={{ marginBottom: 12 }}>{work.overdue.slice(0, 5).map((i) => <CheckRow key={i.id} item={i} overdue />)}</ul>
            {work.overdue.length > 5 && (
              <details style={{ marginBottom: 12 }}><summary className="small">Show {work.overdue.length - 5} more from earlier days</summary>
                <ul className="check-list" style={{ marginTop: 8 }}>{work.overdue.slice(5).map((i) => <CheckRow key={i.id} item={i} overdue />)}</ul>
              </details>
            )}
          </>
        )}
        {work.today.length === 0 ? <p className="muted" style={{ margin: 0 }}>No checklist items are assigned to you for {shortDate(workDate)}.</p> : <ul className="check-list">{work.today.map((i) => <CheckRow key={i.id} item={i} />)}</ul>}
        <p className="small muted" style={{ margin: "10px 0 0" }}>Ticking reports the item done for your task team; your supervisor still accepts quantities and the customer signs off on the visit.</p>
      </section>

      {!d.visit ? (
        <section className="plate">
          <div className="plate-head"><span className="code-tag">No visit</span></div>
          <h2 className="plate-title">You are not booked on a visit today</h2>
          <p className="plate-sub">You can still record travel, training or workshop time below.</p>
        </section>
      ) : (
        <section className="plate" aria-labelledby="h-visit">
          <div className="plate-head">
            <span className="code-tag">{d.visit.business_id} · {d.visit.visit_type.replace("_", "-")}</span>
            <Badge state={d.visit.exec_status} className="stamp-hero stamp-press" />
          </div>
          <h2 id="h-visit" className="plate-title">{d.visit.project}</h2>
          <p className="plate-sub" style={{ display: "flex", gap: 6, alignItems: "center" }}><MapPin size={16} aria-hidden /> {d.visit.site_address}</p>
          <ol className="callouts" style={{ marginTop: 10 }}>
            <li><a href="#progress"><span className="callout-n">1</span><span><span className="callout-title">Open visit quantities</span><span className="callout-meta">{working ? `${d.tasks.length} task${d.tasks.length === 1 ? "" : "s"} · record completed quantities below` : "View scope; recording opens when your supervisor starts the visit"}</span></span><Package size={20} className="callout-go" aria-hidden /></a></li>
            <li><a href="#time"><span className="callout-n">2</span><span><span className="callout-title">Check today&apos;s time rows</span><span className="callout-meta">{d.entries.length ? `${d.entries.length} entr${d.entries.length === 1 ? "y" : "ies"} today` : "Made from your clock-out, or add one by hand"}</span></span><Clock size={20} className="callout-go" aria-hidden /></a></li>
            <li><a href={working ? "#blocker" : `/visits/${d.visit.id}?step=execution`}><span className="callout-n">3</span><span><span className="callout-title">{working ? "Report a blocker" : "Open the visit"}</span><span className="callout-meta">{working ? "Materials, site access, equipment" : "Status, team and readiness"}</span></span>{working ? <Warning size={20} className="callout-go" aria-hidden /> : <CaretRight size={20} className="callout-go" aria-hidden />}</a></li>
          </ol>
        </section>
      )}

      {d.visit && (
        <section className="plate" id="progress" aria-labelledby="h-tasks">
          <div className="plate-head"><h2 id="h-tasks" style={{ margin: 0 }}>Visit quantities</h2><span className="code-tag">{d.tasks.length} tasks</span></div>
          {d.tasks.length === 0 && <p className="muted" style={{ margin: 0 }}>No open tasks on this visit.</p>}
            <DayProgress visitId={d.visit.id} tasks={d.tasks.map((t) => ({ ...t, scoped: qty(t.scoped), accepted: qty(t.accepted), pending: qty(t.pending), target: t.target ? qty(t.target) : null }))} canRecord={working} isEmployee={actor.role === "employee"} />
        </section>
      )}

      {d.visit && working && (
        <section className="plate" id="receive-packages" aria-labelledby="h-pk">
          <div className="plate-head"><h2 id="h-pk" style={{ margin: 0 }}>Receive packages</h2></div>
          <ScanBox projectId={d.visit.project_id} />
          <details><summary className="small">Report a missing or damaged item</summary><PackageExceptionForm projectId={d.visit.project_id} packages={d.packages} /></details>
        </section>
      )}

      {d.visit && working && (
        <section className="plate" id="extra-work" aria-labelledby="h-extra">
          <div className="plate-head"><h2 id="h-extra" style={{ margin: 0 }}>Extra work asked for on site?</h2></div>
          <details><summary className="small">Record a request for additional work</summary>
            <AdditionalWorkForm projectId={d.visit.project_id} visitId={d.visit.id} orders={d.orders.map((o) => ({ id: o.id, label: o.business_id }))} />
          </details>
        </section>
      )}

      <section className="plate" id="time" aria-labelledby="h-today">
        <div className="plate-head">
          <h2 id="h-today" style={{ margin: 0 }}>Time entries</h2>
          {drafts.length > 0 ? <ActionButton action={submitTimeEntries} input={{ entryIds: drafts }} label={`Submit ${drafts.length} for review`} tone="primary" successText="Submitted for review." /> : <span className="code-tag">{d.entries.length} entries</span>}
        </div>
        <p className="small muted">Check recorded time before submitting it to your reviewer. Saving a manual entry creates a draft; submitting sends it for review.</p>
        {d.entries.length > 0 && (
          <ul className="spec" style={{ marginBottom: 12 }}>
            {d.entries.map((e) => (
              <li key={e.id} className="spec-row" style={{ gridTemplateColumns: "1fr auto" }}>
                <span><span className="spec-value" style={{ fontSize: 17 }}>{clock(e.start, d.timezone)}–{clock(e.end, d.timezone)}</span><span className="spec-label" style={{ display: "block" }}>{e.activity}</span></span>
                <Badge state={e.state} />
              </li>
            ))}
          </ul>
        )}
        <details open={d.entries.length === 0}>
          <summary className="button" style={{ listStyle: "none", width: "100%" }}><Clock size={18} aria-hidden /> Add a time entry</summary>
          <div style={{ marginTop: 12 }}>
            <TimeEntryForm employeeId={actor.id} timezone={d.timezone} defaultDate={d.today} projects={d.visit ? [{ id: d.visit.project_id, label: d.visit.project }] : []} visits={d.visit ? [{ id: d.visit.id, business_id: d.visit.business_id, project_id: d.visit.project_id }] : []}
              defaults={d.visit ? { projectId: d.visit.project_id, visitId: d.visit.id } : { overhead: "training" }} />
          </div>
        </details>
      </section>
    </div>
  );
}
