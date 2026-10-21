import { session } from "@/server/session";
import { employeeProfile, skillsCatalog } from "@/server/queries/people";
import { AppError } from "@/server/errors";
import { hours, LEVEL, when } from "@/lib/format";
import { Badge, DemoTag } from "@/components/ui/Badge";
import { Notice, PageHeader } from "@/components/ui/Notice";
import { SkillForms } from "@/components/people/SkillForms";
import { EmployeeAdmin } from "@/components/people/EmployeeAdmin";

export const metadata = { title: "Employee" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, actor } = await session();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Notice tone="bad">Employee not found.</Notice>;
  let d;
  try { d = await employeeProfile(db, actor, id, Date.now()); } catch (e) {
    if (e instanceof AppError) return <Notice tone="warn" title="Not available">{e.message}</Notice>;
    throw e;
  }
  const e = d.employee;
  const skills = await skillsCatalog(db);
  const canVerify = actor.capabilities.includes("skill_verify") && actor.id !== id;
  return (
    <>
      <PageHeader title={`${e.name} (${e.business_id})`} subtitle={<>{e.job_role.replace(/_/g, " ")} · permission {e.permission_role} · {e.base_city} · reports to {e.manager ?? "None"} {e.is_demo && <DemoTag />} {!e.active && <Badge state="cancelled" label="Inactive" />}</>}
        actions={<a className="button" href={`/timesheets?employee=${id}`}>Timesheet</a>} />
      <div className="grid cols-2">
        <section className="card stack" aria-labelledby="h-sk">
          <h2 id="h-sk">Skill card</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Skill</th><th>Level</th><th>Verification</th><th>Valid</th></tr></thead>
            <tbody>{d.skills.map((s) => (
              <tr key={s.id}><td>{s.name}</td><td>{LEVEL[s.level]}</td>
                <td>{s.verified ? <Badge state="approved" label={`Verified by ${s.verified_by}`} /> : <Badge state="pending" label="Unverified" />}{s.verified && <div className="small muted">{when(s.verified_at)}</div>}</td>
                <td className="small">{s.valid_from ?? "None"} → {s.valid_to ?? "open"}</td></tr>
            ))}</tbody>
          </table></div>
          <SkillForms employeeId={id} skills={skills} records={d.skills.map((s) => ({ id: s.id, label: `${s.name} ${LEVEL[s.level]}`, verified: s.verified }))} canVerify={canVerify} canRecordLeave={actor.role !== "employee"} />
          {!canVerify && <p className="small muted">Verifying skills needs the skill-verify capability, and nobody verifies their own record.</p>}
        </section>
        <section className="card stack" aria-labelledby="h-wl">
          <h2 id="h-wl">Calendar, workload and balance</h2>
          <dl className="facts">
            <dt>Work calendar</dt><dd>{e.calendar} {e.calendar_illustrative && <Badge state="illustrative" label="Illustrative" />}</dd>
            <dt>Confirmed future occupancy</dt><dd>{hours(d.futureReservedMinutes)}</dd>
            <dt>Scheduled utilization ({d.utilization.month})</dt><dd>{d.utilization.ratio === null ? "N/A (no available working time)" : `${d.utilization.ratio}%`} <span className="small muted">({hours(d.utilization.reservedWorkingMinutes)} reserved of {hours(d.utilization.availableMinutes)} available after leave; not capped, so over 100% shows a conflict)</span></dd>
          </dl>
          <h3>Monthly reconciliation</h3>
          {d.months.length === 0 ? <p className="muted small">No reconciliation stored yet.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Month</th><th>State</th><th className="num">Normal (N)</th><th className="num">Qualifying (Q)</th><th className="num">Approved OT</th></tr></thead>
              <tbody>{d.months.map((m) => <tr key={`${m.month}-${m.revision}`}><td>{m.month} r{m.revision}</td><td><Badge state={m.state} /></td><td className="num">{hours(m.totals.N)}</td><td className="num">{hours(m.totals.Q)}</td><td className="num">{hours(m.totals.approvedOT)}</td></tr>)}</tbody>
            </table></div>
          )}
          <h3>Leave</h3>
          <ul className="small">{d.leave.map((l, i) => <li key={i}>{l.kind}: {when(l.start)} → {when(l.end)} ({l.status})</li>)}{d.leave.length === 0 && <li>None recorded</li>}</ul>
        </section>
      </div>
      {actor.role === "admin" && actor.id !== id && <EmployeeAdmin employee={{ id, version: e.version, active: e.active, job_role: e.job_role, permission_role: e.permission_role }} />}
      <section className="card" aria-labelledby="h-as">
        <h2 id="h-as">Assignments</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Visit</th><th>Project</th><th>Role</th><th>Reservation</th><th>From</th><th>To</th></tr></thead>
          <tbody>{d.assignments.map((a, i) => (
            <tr key={i}><td><a href={`/visits/${a.visit_id}`}>{a.visit}</a></td><td>{a.project}</td><td>{a.role.replace(/_/g, " ")}</td><td><Badge state={a.state} />{a.hold_expires_at && <div className="small muted">hold expires {when(a.hold_expires_at)}</div>}</td><td>{when(a.start)}</td><td>{when(a.end)}</td></tr>
          ))}{d.assignments.length === 0 && <tr><td colSpan={6} className="muted">No assignments.</td></tr>}</tbody>
        </table></div>
      </section>
    </>
  );
}
