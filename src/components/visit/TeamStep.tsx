"use client";
import Link from "next/link";
import { useState } from "react";
import { bookVisit, holdCapacity, releaseReservation, setVisitStaffing, suggestTeams } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { hours, when } from "@/lib/format";

interface Member { id: string; name: string; jobRole: string }
interface Option { start: string; memberIds: string[]; members: Member[]; continuityMembers: number; workloadMinutes: number; crewPresence: Array<{ date: string; present: number }>; coverage: { results: Array<{ skillCode: string; message: string; met: boolean }> } }
interface Suggestion {
  options: Option[]; earliest: Option | null; strongestContinuity: Option | null; preferredTeam: Array<{ id: string; name?: string }>; resultStatement: string; noSolutionWithinHorizon: boolean;
  searched: { dates: number; combinations: number; horizonEnd: string; truncatedDates: string[]; combinationBudgetPerDate: number }; unavailableOnFirstDate: Array<{ id: string; name: string; reasons: string[] }>;
  tieBreakRules: string[]; teamSize: number; spanDays: number; continuity: string;
}

export function TeamStep({ visitId, staffing, coverage, approval, execStatus, gate, needsReason, role, candidates }: {
  visitId: string; staffing: Array<{ id: string; employee_id: string; employee: string; business_id: string; role: string; state: string; hold_expires_at: number | null }>;
  coverage: { met: boolean; problems: string[] }; approval: string; execStatus: string; gate: { ok: boolean; blockers: string[] }; needsReason: boolean; role: string;
  candidates: Array<{ id: string; business_id: string; name: string; job_role: string; skills: string }>;
}) {
  const suggest = useAction(suggestTeams, { refresh: false });
  const staff = useAction(setVisitStaffing);
  const [reason, setReason] = useState("");
  const [manual, setManual] = useState<Set<string>>(() => new Set(staffing.map((m) => m.employee_id)));
  const s = suggest.result?.ok ? (suggest.result.data as Suggestion) : null;
  const choose = (ids: string[]) => staff.run({ visitId, employeeIds: ids, changeReason: reason || undefined });
  const OptionCard = ({ o, title }: { o: Option; title: string }) => (
    <div className="card stack">
      <div className="spread"><h3 style={{ margin: 0 }}>{title}</h3><span className="small">Starts {o.start}</span></div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{o.members.map((m) => <li key={m.id}>{m.name} · {m.jobRole.replace(/_/g, " ")}</li>)}</ul>
      <p className="small muted">Returning members: {o.continuityMembers} · assigned workload in window: {hours(o.workloadMinutes)} · crew present {o.crewPresence.length} day(s)</p>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{o.coverage.results.map((r) => <li key={r.skillCode + r.message}>{r.met ? "✓" : "×"} {r.skillCode}: {r.message}</li>)}</ul>
      <button type="button" className="primary" onClick={() => choose(o.memberIds)} disabled={staff.pending || ["in_progress", "completed", "closed"].includes(execStatus)}>Propose this team</button>
    </div>
  );
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="h-staff">
        <h2 id="h-staff">Current staffing</h2>
        {staffing.length === 0 ? <p className="muted">No one selected yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Employee</th><th>Role</th><th>Reservation</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{staffing.map((m) => (
              <tr key={m.id}>
                <td><Link href={`/people/${m.employee_id}`}>{m.employee}</Link> <span className="muted small">{m.business_id}</span></td><td>{m.role.replace(/_/g, " ")}</td>
                <td><Badge state={m.state} />{m.hold_expires_at && <div className="small muted">expires {when(m.hold_expires_at)}</div>}</td>
                <td>{role !== "employee" && role !== "supervisor" && <ActionButton action={releaseReservation} input={{ reservationId: m.id, reason: "Released from team step" }} label="Release" tone="danger" confirm="Release this employee's reservation for this visit? Recorded actual time is not affected." />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Notice tone={coverage.met ? "ok" : "warn"} title={coverage.met ? "Staffing meets the requirements" : "Staffing does not meet the requirements yet"} items={coverage.problems} />
        <div className="row">
          <ActionButton action={holdCapacity} input={{ visitId }} label="Hold capacity" successText="Held. Holds block other bookings until they expire; they do not authorize deployment." />
          <ActionButton action={bookVisit} input={{ visitId, idempotencyKey: `book-${visitId}-${staffing.map((x) => x.id).join("").slice(0, 40)}` }} label="Firm booking" tone="primary"
            confirm={`Confirm all selected staff for this visit? This re-checks the approved plan (${approval}), clearance and skill coverage inside one transaction.`} successText="Booked. All reservations confirmed." />
        </div>
        {!gate.ok && <p className="small muted">Firm booking will be refused until clearance is complete or an authorized exception applies: {gate.blockers.join("; ")}.</p>}
      </section>

      <section className="card stack" aria-labelledby="h-opts">
        <h2 id="h-opts">Team options</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); suggest.run({ visitId, horizonDays: Number(f.get("horizon")), teamSize: f.get("size") ? Number(f.get("size")) : undefined }); }}>
          <div className="field"><label htmlFor="t-h">Search horizon (days)</label><input id="t-h" name="horizon" type="number" min={1} max={120} defaultValue={30} /></div>
          <div className="field"><label htmlFor="t-s">Team size override</label><input id="t-s" name="size" type="number" min={1} max={12} placeholder="visit setting" /></div>
          <button type="submit" className="primary" style={{ alignSelf: "flex-end" }} disabled={suggest.pending}>{suggest.pending ? "Searching…" : "Find qualified teams"}</button>
        </form>
        <ResultNotice result={suggest.result?.ok ? null : suggest.result} />
        {needsReason && <div className="field"><label htmlFor="t-r">Change reason (staffing changes start a new revision)</label><input id="t-r" value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
        {s && (
          <div className="stack">
            <Notice tone={s.noSolutionWithinHorizon ? "warn" : "info"} title={s.resultStatement}>
              Team size {s.teamSize}, {s.spanDays} day span, continuity {s.continuity}. Searched {s.searched.dates} working date(s) to {s.searched.horizonEnd}, {s.searched.combinations} combination(s)
              {s.searched.truncatedDates.length ? `; combination budget (${s.searched.combinationBudgetPerDate}) reached on ${s.searched.truncatedDates.join(", ")}` : ""}.
            </Notice>
            <div className="grid cols-3">
              {s.earliest && <OptionCard o={s.earliest} title="Earliest feasible start" />}
              {s.strongestContinuity && s.strongestContinuity !== s.earliest && <OptionCard o={s.strongestContinuity} title="Strongest returning-team continuity" />}
            </div>
            {s.options.length > 1 && <details><summary>All {s.options.length} ranked options</summary><div className="grid cols-3" style={{ marginTop: 8 }}>{s.options.map((o, i) => <OptionCard key={i} o={o} title={`Option ${i + 1}`} />)}</div></details>}
            <details><summary>Tie-break rules</summary><ol className="small">{s.tieBreakRules.map((r) => <li key={r}>{r.replace(/^\d+\.\s*/, "")}</li>)}</ol></details>
            <details><summary>Why people were excluded on the first date ({s.unavailableOnFirstDate.length})</summary>
              <ul className="small">{s.unavailableOnFirstDate.map((u) => <li key={u.id}>{u.name}: {u.reasons.join(", ")}</li>)}</ul></details>
            {s.preferredTeam.length > 0 && <p className="small muted">Preferred returning team: {s.preferredTeam.map((p) => p.name ?? p.id).join(", ")}</p>}
          </div>
        )}
        <form className="form" onSubmit={(e) => { e.preventDefault(); choose([...manual]); }}>
          <fieldset>
            <legend>Manual selection ({manual.size} selected)</legend>
            <div className="grid cols-3" style={{ maxHeight: 280, overflowY: "auto" }}>
              {candidates.map((c) => (
                <label key={c.id} className="check small">
                  <input type="checkbox" checked={manual.has(c.id)} onChange={() => { const n = new Set(manual); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); setManual(n); }} />
                  <span>{c.name} ({c.business_id}) · {c.job_role.replace(/_/g, " ")}<br /><span className="muted">{c.skills || "no skills recorded"}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" disabled={staff.pending || manual.size === 0}>Check and propose selected</button>
          <p className="small muted">Manual selections pass exactly the same availability, leave, team-size and skill checks. Skills shown with ✓ are verified.</p>
        </form>
        <ResultNotice result={staff.result} successText="Team proposed. Proposals do not reserve capacity until held or booked." />
      </section>
    </div>
  );
}
