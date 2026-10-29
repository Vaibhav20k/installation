import { session } from "@/server/session";
import { attendanceHistory } from "@/server/queries/attendance";
import { requireEmployeeScope } from "@/server/auth/permissions";
import { shortDate } from "@/domain/install-schedule";
import { Badge } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";
import { CorrectionForm } from "@/components/attendance/AttendancePanel";
import { AutoClosedNotice } from "@/components/attendance/AutoClosedNotice";
import { autoClosedMessage } from "@/server/services/attendance";

export const metadata = { title: "My attendance" };

const hm = (min: number) => { const m = Math.round(min); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const employeeId = sp.employee && /^[0-9a-f-]{36}$/.test(sp.employee) ? sp.employee : actor.id;
  if (employeeId !== actor.id) await requireEmployeeScope(db, actor, employeeId);
  const [who] = await db.query<{ name: string; business_id: string }>("select name, business_id from employee where id = $1", [employeeId]);
  const now = Date.now();
  const rows = await attendanceHistory(db, employeeId, now);
  const own = employeeId === actor.id;
  // A missed clock-out is provisional (capped at 24 h, never paid as-is): it counts only once its real time is approved.
  const total = rows.filter((r) => !r.missed).reduce((t, r) => ({ reg: t.reg + r.summary.regularWorkMinutes, ot: t.ot + r.summary.recordedOvertimeWorkMinutes, ok: t.ok + r.approvedOtMinutes, pend: t.pend + r.pendingOtMinutes, no: t.no + r.ineligibleOtMinutes }), { reg: 0, ot: 0, ok: 0, pend: 0, no: 0 });
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 820, width: "100%" }}>
      <PageHeader title={own ? "My attendance" : `Attendance · ${who?.name ?? ""}`} subtitle="Each day: clock-in and out, regular work inside the fixed 8-hour session, work recorded after it, and what review decided. Recorded overtime is not approved overtime." />
      {own && <AutoClosedNotice linkToForm={false} items={rows.filter((r) => r.missed && r.autoClosed).map((r) => ({ shiftId: r.id, text: `${autoClosedMessage(r.work_date)} Use "Add the missing clock-out time" on that day below.` }))} />}
      <section className="plate" aria-labelledby="h-tot">
        <div className="plate-head"><h2 id="h-tot" style={{ margin: 0 }}>{rows.length === 1 ? "Last shift" : `Last ${rows.length} shifts`}</h2><span className="code-tag">{who?.business_id}</span></div>
        <ul className="spec">
          {[["Regular-session work", hm(total.reg), undefined], ["Recorded after 8 hours", hm(total.ot), undefined], ["Overtime found eligible", hm(total.ok), undefined],
            ["Waiting for review", hm(total.pend), total.pend ? "warn" : undefined], ["Not eligible (actual time kept)", hm(total.no), undefined]].map(([l, v, t]) => (
            <li key={l}><div className="spec-row" style={{ gridTemplateColumns: "1fr auto" }}><span className="spec-label">{l}</span><span className="spec-value" data-tone={t}>{v}</span></div></li>
          ))}
        </ul>
        <p className="small muted" style={{ margin: "8px 0 0" }}>Monthly settlement is separate and stays provisional until the monthly policy is approved. This page is not a payslip.</p>
      </section>
      {rows.length === 0 ? <Empty>No shifts yet. Clock in from My day to start one.</Empty> : (
        <ul className="att-list">
          {rows.map((r) => (
            <li key={r.id} id={`shift-${r.id}`} className="plate att-row" data-missed={r.missed || undefined}>
              <div className="att-head">
                <span className="code att-date">{shortDate(r.work_date)}</span>
                {r.missed ? <Badge state="fail" tone="bad" label={r.autoClosed ? "Closed after 24 h" : "Clock-out missing"} /> : r.summary.open ? <Badge state="in_progress" label={r.summary.state === "overtime" ? "Overtime" : "Regular"} /> : <Badge state="completed" label="Closed" />}
              </div>
              <div className="att-times code">{fmt(r.timezone).format(r.t0)} → {r.missed ? (r.autoClosed ? "Not clocked out" : "?") : r.summary.lastClockOut && !r.summary.open ? fmt(r.timezone).format(r.summary.lastClockOut) : "open"}</div>
              <dl className="att-figs">
                <div><dt>Regular work</dt><dd className="code">{r.missed ? "provisional" : hm(r.summary.regularWorkMinutes)}</dd></div>
                <div><dt>After 8 h</dt><dd className="code">{r.missed ? "provisional" : hm(r.summary.recordedOvertimeWorkMinutes)}</dd></div>
                <div><dt>Break</dt><dd className="code">{hm(r.summary.breakMinutes)}</dd></div>
                <div><dt>OT review</dt><dd className="small">{r.approvedOtMinutes ? `${hm(r.approvedOtMinutes)} eligible` : ""}{r.pendingOtMinutes ? ` ${hm(r.pendingOtMinutes)} pending` : ""}{r.ineligibleOtMinutes ? ` ${hm(r.ineligibleOtMinutes)} not eligible` : ""}{!r.approvedOtMinutes && !r.pendingOtMinutes && !r.ineligibleOtMinutes ? "None" : ""}</dd></div>
              </dl>
              {r.otReason === "catch_up" && <p className="small" style={{ margin: 0 }}>Recorded after regular hours. Original-target catch-up is not eligible for overtime approval.</p>}
              {own && <CorrectionForm shiftId={r.id} workDate={r.work_date} open={r.missed} label={r.missed ? "Add the missing clock-out time" : r.corrections ? `Corrections (${r.corrections}) · request another` : "Request a correction"} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
