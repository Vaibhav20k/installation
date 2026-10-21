"use client";
import { Fragment, useState } from "react";
import { applyScheduleRevision, proposeScheduleRevision, updateVisitDates } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { Notice } from "@/components/ui/Notice";
import { when } from "@/lib/format";

interface V { id: string; version: number; planned_start: string | null; planned_end: string | null; departure_at: number | null; return_at: number | null; team_size: number; continuity: string; exec_status: string; outstation: boolean; timezone: string }
interface Start { start: string | null; tentative: boolean; blockers: string[]; notes: string[]; drivers: Array<{ name: string; date: string }> }

const toLocalInput = (ms: number | null) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

export function DatesStep({ visit, requested, start, hasLiveStaff, needsReason }: { visit: V; requested: { date: string | null; meaning: string | null }; start: Start; hasLiveStaff: boolean; needsReason: boolean }) {
  const edit = useAction(updateVisitDates);
  const propose = useAction(proposeScheduleRevision, { refresh: false });
  const apply = useAction(applyScheduleRevision);
  const [dates, setDates] = useState({ start: visit.planned_start ?? "", end: visit.planned_end ?? "" });
  const proposal = propose.result?.ok ? (propose.result.data as { conflicts: Array<{ employee: string; visit: string; state: string }>; personDayChange: number; note: string }) : null;
  return (
    <div className="grid cols-2">
      <section className="card stack" aria-labelledby="h-derive">
        <h2 id="h-derive">Earliest start (derived)</h2>
        <dl className="facts">
          <dt>Customer request</dt><dd>{requested.date ? `${requested.date} (${(requested.meaning ?? "").replace("_", " ")})` : "Not recorded"}</dd>
          {start.drivers.map((d) => <Fragment key={d.name}><dt>{d.name}</dt><dd>{d.date}</dd></Fragment>)}
          <dt>Derived earliest start</dt><dd><strong>{start.start ?? "Unknown"}</strong> {start.tentative && "(tentative)"}</dd>
        </dl>
        {start.blockers.length > 0 && <Notice tone="warn" title="Missing inputs" items={start.blockers} />}
        {start.notes.map((n) => <p key={n} className="small muted">{n}</p>)}
        <p className="small muted">Start = the latest of requested start, arrival, predecessor completion, material availability, clearance and site access, moved to the first permitted working day. No planning buffer is configured.</p>
      </section>
      <section className="card stack" aria-labelledby="h-dates">
        <h2 id="h-dates">Planned dates and travel</h2>
        <p className="small">Current: {visit.planned_start ?? "—"} → {visit.planned_end ?? "—"}{visit.outstation && <> · departs {when(visit.departure_at, visit.timezone)}, returns {when(visit.return_at, visit.timezone)}</>}</p>
        {!hasLiveStaff ? (
          <form className="form" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const dt = (k: string) => (f.get(k) ? new Date(String(f.get(k))).toISOString() : null);
            edit.run({ visitId: visit.id, plannedStart: dates.start, plannedEnd: dates.end, departureAt: dt("departureAt"), returnAt: dt("returnAt"),
              teamSize: Number(f.get("teamSize")), continuity: String(f.get("continuity")), changeReason: f.get("changeReason") ? String(f.get("changeReason")) : undefined });
          }}>
            <div className="fields">
              <div className="field"><label htmlFor="d-s">Work start</label><input id="d-s" type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} required /></div>
              <div className="field"><label htmlFor="d-e">Work end</label><input id="d-e" type="date" value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} required /></div>
              <div className="field"><label htmlFor="d-dep">Departure</label><input id="d-dep" type="datetime-local" name="departureAt" defaultValue={toLocalInput(visit.departure_at)} /></div>
              <div className="field"><label htmlFor="d-ret">Return / release</label><input id="d-ret" type="datetime-local" name="returnAt" defaultValue={toLocalInput(visit.return_at)} /></div>
              <div className="field"><label htmlFor="d-size">Team size</label><input id="d-size" type="number" name="teamSize" min={1} max={12} defaultValue={visit.team_size} /></div>
              <div className="field"><label htmlFor="d-c">Continuity</label><select id="d-c" name="continuity" defaultValue={visit.continuity}><option value="preferred">Preferred</option><option value="mandatory">Mandatory</option><option value="none">None</option></select></div>
            </div>
            {needsReason && <div className="field"><label htmlFor="d-r">Change reason (starts a new revision)</label><input id="d-r" name="changeReason" required /></div>}
            <p className="small muted">Changing dates withdraws proposed (non-blocking) staffing so it is re-checked against the new dates.</p>
            <button className="primary" type="submit" disabled={edit.pending}>Save dates</button>
            <ResultNotice result={edit.result} successText="Dates saved." />
          </form>
        ) : (
          <div className="stack">
            <p className="small">Staff are held or booked, so a date change is a schedule revision: conflicts and cost impact are shown first, then all reservations move together or nothing changes.</p>
            <div className="fields">
              <div className="field"><label htmlFor="r-s">New work start</label><input id="r-s" type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} /></div>
              <div className="field"><label htmlFor="r-e">New work end</label><input id="r-e" type="date" value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} /></div>
            </div>
            <button type="button" onClick={() => propose.run({ visitId: visit.id, plannedStart: dates.start, plannedEnd: dates.end })} disabled={propose.pending}>Preview impact</button>
            <ResultNotice result={propose.result?.ok ? null : propose.result} />
            {proposal && (
              <Notice tone={proposal.conflicts.length ? "warn" : "ok"} title={proposal.note}
                items={[...proposal.conflicts.map((c) => `${c.employee} is ${c.state} on ${c.visit}`), `Person-day change: ${proposal.personDayChange > 0 ? "+" : ""}${proposal.personDayChange} (affects per-person-day expense lines)`]} />
            )}
            {proposal && proposal.conflicts.length === 0 && (
              <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); apply.run({ visitId: visit.id, plannedStart: dates.start, plannedEnd: dates.end, version: visit.version, changeReason: String(f.get("reason")) }); }}>
                <div className="field"><label htmlFor="r-why">Reason (creates a new plan revision for reapproval)</label><input id="r-why" name="reason" required minLength={3} /></div>
                <button className="primary" type="submit" disabled={apply.pending}>Apply revision</button>
              </form>
            )}
            <ResultNotice result={apply.result} successText="Schedule revised; reservations moved together. Reapproval is required." />
          </div>
        )}
      </section>
    </div>
  );
}
