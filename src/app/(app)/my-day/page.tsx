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
import { shortDate } from "@/domain/install-schedule";
import { AdditionalWorkForm } from "@/components/project/CommercialForms";
import { ScanBox, PackageExceptionForm } from "@/components/project/PackageForms";

export const metadata = { title: "My day" };

export default async function MyDayPage() {
  const { db, actor } = await session();
  const now = Date.now();
  const d = await myDay(db, actor, now);
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
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <div>
        <h1>Today, {first}</h1>
        <p className="muted small" style={{ margin: 0 }}>{d.today} · entries save to the server straight away; this screen needs a connection.</p>
      </div>

      <AttendancePanel shift={panel} serverNow={now} employeeFirstName={first} today={shortDate(d.today)}
        visitLabel={att.visit ? `${att.visit.business_id} · ${att.visit.project}` : d.visit ? `${d.visit.business_id} · ${d.visit.project}` : null} />
      {att.missed.length > 0 && (
        <p className="notice" data-tone="warn" role="status">You did not clock out on {att.missed.map((m) => shortDate(m.shift.work_date)).join(", ")}. That day stays provisional; open My attendance and request the correct clock-out time.</p>
      )}

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
            <li><a href="#progress"><span className="callout-n">1</span><span><span className="callout-title">Record progress</span><span className="callout-meta">{working ? `${d.tasks.length} task${d.tasks.length === 1 ? "" : "s"} on today's plate` : "Opens once your supervisor starts the visit"}</span></span><Package size={20} className="callout-go" aria-hidden /></a></li>
            <li><a href="#time"><span className="callout-n">2</span><span><span className="callout-title">Check today&apos;s time rows</span><span className="callout-meta">{d.entries.length ? `${d.entries.length} entr${d.entries.length === 1 ? "y" : "ies"} today` : "Made from your clock-out, or add one by hand"}</span></span><Clock size={20} className="callout-go" aria-hidden /></a></li>
            <li><a href={working ? "#blocker" : `/visits/${d.visit.id}?step=execution`}><span className="callout-n">3</span><span><span className="callout-title">{working ? "Report a blocker" : "Open the visit"}</span><span className="callout-meta">{working ? "Materials, site access, equipment" : "Status, team and readiness"}</span></span>{working ? <Warning size={20} className="callout-go" aria-hidden /> : <CaretRight size={20} className="callout-go" aria-hidden />}</a></li>
          </ol>
        </section>
      )}

      {d.visit && (
        <section className="plate" aria-labelledby="h-tasks">
          <div className="plate-head"><h2 id="h-tasks" style={{ margin: 0 }}>Today&apos;s plate</h2><span className="code-tag">{d.tasks.length} tasks</span></div>
          {d.tasks.length === 0 ? <p className="muted" style={{ margin: 0 }}>No open tasks on this visit.</p> : (
            <DayProgress visitId={d.visit.id} tasks={d.tasks.map((t) => ({ ...t, scoped: qty(t.scoped), accepted: qty(t.accepted), pending: qty(t.pending), target: t.target ? qty(t.target) : null }))} canRecord={working} isEmployee={actor.role === "employee"} />
          )}
        </section>
      )}

      {d.visit && working && (
        <section className="plate" aria-labelledby="h-pk">
          <div className="plate-head"><h2 id="h-pk" style={{ margin: 0 }}>Receive packages</h2></div>
          <ScanBox projectId={d.visit.project_id} />
          <details><summary className="small">Report a missing or damaged item</summary><PackageExceptionForm projectId={d.visit.project_id} packages={d.packages} /></details>
        </section>
      )}

      {d.visit && working && (
        <section className="plate" aria-labelledby="h-extra">
          <div className="plate-head"><h2 id="h-extra" style={{ margin: 0 }}>Extra work asked for on site?</h2></div>
          <details><summary className="small">Record a request for additional work</summary>
            <AdditionalWorkForm projectId={d.visit.project_id} visitId={d.visit.id} orders={d.orders.map((o) => ({ id: o.id, label: o.business_id }))} />
          </details>
        </section>
      )}

      <section className="plate" id="time" aria-labelledby="h-today">
        <div className="plate-head">
          <h2 id="h-today" style={{ margin: 0 }}>Time today</h2>
          {drafts.length > 0 ? <ActionButton action={submitTimeEntries} input={{ entryIds: drafts }} label={`Submit ${drafts.length}`} tone="primary" successText="Submitted for review." /> : <span className="code-tag">{d.entries.length} entries</span>}
        </div>
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
