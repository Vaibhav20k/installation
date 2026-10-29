/**
 * Installation head's site workforce: who is planned on the site and who has recorded presence there, with
 * role, skills, assigned work, planned dates, check-in/out and recorded site days. A plan is not attendance:
 * planned and recorded figures sit side by side and are never merged. Open sessions are counted separately.
 */
import type { siteWorkforce } from "@/server/queries/site-ops";
import { formatDateTime, formatMinutes } from "@/lib/dates";
import { shortDate } from "@/domain/install-schedule";
import { Empty } from "@/components/ui/Notice";
import { roleLabel } from "@/components/cards/labels";
import { AddSessionForm, SessionFix } from "./PresenceForms";

const LEVEL = ["", "Low", "Medium", "High"];
type Data = Awaited<ReturnType<typeof siteWorkforce>>;

function dateRange(dates: string[]) {
  if (!dates.length) return "No booking";
  return dates.length === 1 ? shortDate(dates[0]!) : `${shortDate(dates[0]!)} to ${shortDate(dates[dates.length - 1]!)}`;
}

export function SiteWorkforce({ data, visitId, canCorrect, actorId }: { data: Data; visitId: string; canCorrect: boolean; actorId: string }) {
  const t = data.totals;
  const tz = data.timezone;
  return (
    <>
      <dl className="wf-summary">
        <div><dt>Planned</dt><dd>{t.planned}</dd></div>
        <div><dt>Recorded here</dt><dd>{t.present}</dd></div>
        <div><dt>On site now</dt><dd>{t.onSiteNow}</dd></div>
        <div><dt>Recorded site days</dt><dd>{t.personDays}</dd></div>
        <div><dt>Open sessions</dt><dd style={t.open ? { color: "var(--warn)" } : undefined}>{t.open}</dd></div>
      </dl>
      <p className="small muted" style={{ marginTop: 0 }}>Planned days come from bookings; recorded days come only from site check-in and check-out. A recorded day is a date someone was on site, however short, not a paid working day. Sessions without a check-out are not counted until corrected.</p>
      {data.rows.length === 0 ? <Empty>No one is booked on or has checked in at this site.</Empty> : (
        <div>
          {data.rows.map((r) => (
            <details key={r.id} className="wf-person">
              <summary>
                <span><strong>{r.name}</strong> <span className="code muted">{r.business_id}</span><span className="small muted" style={{ display: "block" }}>{roleLabel(r.job_role)}{r.on_team ? "" : " · no longer on the team"}</span></span>
                <span className="wf-figs" style={{ justifyContent: "flex-end" }}>
                  <span>Planned <strong>{r.plannedDates.length}</strong></span>
                  <span>Recorded <strong>{r.summary.recordedDays}</strong></span>
                  {r.summary.openSessions > 0 && <span style={{ color: "var(--warn)" }}>{r.summary.openSessions} open</span>}
                </span>
              </summary>
              <div className="wf-body">
                <div className="wf-figs">
                  <span>Planned dates <strong>{dateRange(r.plannedDates)}</strong></span>
                  <span>On site <strong>{formatMinutes(r.summary.recordedMinutes)}</strong></span>
                  <span>First in <strong>{r.summary.firstIn ? formatDateTime(r.summary.firstIn, tz) : "—"}</strong></span>
                  <span>Last out <strong>{r.summary.lastOut ? formatDateTime(r.summary.lastOut, tz) : "—"}</strong></span>
                </div>
                <div className="small"><strong>Skills:</strong> {r.skills.length ? r.skills.map((s) => `${s.name} ${LEVEL[s.level]}${s.verified ? "" : " (not verified)"}`).join(", ") : <span className="muted">Not entered</span>}</div>
                <div className="small"><strong>Assigned work:</strong> {r.tasks.length ? r.tasks.join(", ") : <span className="muted">No task assigned</span>}</div>
                {r.summary.days.length > 0 && <div className="small"><strong>Days recorded:</strong> {r.summary.days.map((d) => `${shortDate(d.date)} (${formatMinutes(d.minutes)})`).join(", ")}</div>}
                <ul className="session-list" aria-label={`Site sessions for ${r.name}`}>
                  {r.sessions.length === 0 && <li className="muted">No site check-in recorded.</li>}
                  {r.sessions.map((s) => (
                    <li key={s.id}>
                      <span>In {formatDateTime(Number(s.check_in_at), tz)} · {s.check_out_at === null ? <strong style={{ color: "var(--warn)" }}>no check-out yet</strong> : `out ${formatDateTime(Number(s.check_out_at), tz)}`}{s.source === "correction" || s.changes ? <span className="muted"> · corrected</span> : null}</span>
                      {canCorrect && r.id !== actorId && <SessionFix session={{ id: s.id, version: s.version, checkIn: Number(s.check_in_at), checkOut: s.check_out_at === null ? null : Number(s.check_out_at) }} tz={tz} />}
                    </li>
                  ))}
                </ul>
                {canCorrect && r.id !== actorId && <AddSessionForm employeeId={r.id} visitId={visitId} />}
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
