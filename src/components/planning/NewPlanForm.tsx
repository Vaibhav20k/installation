"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPlanAndVisit } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";

export function NewPlanForm({ projects, orders, defaultProject }: { projects: Array<{ id: string; label: string }>; orders: Array<{ id: string; business_id: string; project_id: string; status: string }>; defaultProject?: string }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(defaultProject ?? projects[0]?.id ?? "");
  const [visitType, setVisitType] = useState("fresh");
  const { run, pending, result } = useAction(createPlanAndVisit, { refresh: false, onSuccess: (d) => router.push(`/visits/${(d as { visitId: string }).visitId}?step=scope`) });
  const projectOrders = orders.filter((o) => o.project_id === projectId);
  return (
    <form className="card form" style={{ maxWidth: 760 }} onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const val = (k: string) => (f.get(k) ? String(f.get(k)) : undefined);
      run({
        projectId,
        visit: {
          visitType, repeatReason: val("repeatReason"), plannedStart: val("plannedStart"), plannedEnd: val("plannedEnd"),
          requestedStart: val("requestedStart"), requestedStartMeaning: val("requestedStart") ? val("requestedStartMeaning") : undefined,
          outstation: f.get("outstation") === "on", teamSize: Number(val("teamSize") ?? 3), continuity: val("continuity"),
          departureAt: val("departureAt") ? new Date(String(val("departureAt"))).toISOString() : undefined,
          returnAt: val("returnAt") ? new Date(String(val("returnAt"))).toISOString() : undefined,
          orderIds: f.getAll("orderIds").map(String),
        },
      });
    }}>
      <div className="field">
        <label htmlFor="np-project">Project (customer → location)</label>
        <select id="np-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <fieldset>
        <legend>Orders in this visit</legend>
        {projectOrders.length === 0 ? <p className="muted">This project has no orders.</p> : projectOrders.map((o) => (
          <label key={o.id} className="check"><input type="checkbox" name="orderIds" value={o.id} defaultChecked /> {o.business_id} <span className="muted small">({o.status.replace("_", " ")})</span></label>
        ))}
        <p className="small muted">Only orders of the selected project are offered; the database also rejects cross-project links.</p>
      </fieldset>
      <div className="fields">
        <div className="field"><label htmlFor="np-type">Visit type</label>
          <select id="np-type" value={visitType} onChange={(e) => setVisitType(e.target.value)}><option value="fresh">Fresh</option><option value="follow_up">Follow-up</option><option value="final">Final</option></select></div>
        {visitType !== "fresh" && (
          <div className="field"><label htmlFor="np-reason">Repeat-visit reason</label>
            <select id="np-reason" name="repeatReason" required>
              <option value="planned_phasing">Planned phasing</option><option value="material_shortage">Material shortage</option><option value="customer_change">Customer change</option>
              <option value="failed_readiness">Failed readiness</option><option value="rework">Rework</option><option value="other_documented">Other documented cause</option>
            </select></div>
        )}
        <div className="field"><label htmlFor="np-size">Team size</label><input id="np-size" name="teamSize" type="number" min={1} max={12} defaultValue={3} />
          <span className="hint">Demo default is 3 (unresolved: teams of three vs three teams).</span></div>
        <div className="field"><label htmlFor="np-cont">Returning-team continuity</label>
          <select id="np-cont" name="continuity" defaultValue="preferred"><option value="preferred">Preferred</option><option value="mandatory">Mandatory</option><option value="none">None</option></select></div>
      </div>
      <fieldset>
        <legend>Dates (explicit year)</legend>
        <div className="fields">
          <div className="field"><label htmlFor="np-req">Customer-requested start</label><input id="np-req" type="date" name="requestedStart" /></div>
          <div className="field"><label htmlFor="np-reqm">Requested start means</label>
            <select id="np-reqm" name="requestedStartMeaning" defaultValue="installation_start"><option value="installation_start">Installation start</option><option value="travel_start">Travel start</option></select></div>
          <div className="field"><label htmlFor="np-start">Planned work start</label><input id="np-start" type="date" name="plannedStart" /></div>
          <div className="field"><label htmlFor="np-end">Planned work end</label><input id="np-end" type="date" name="plannedEnd" /></div>
        </div>
        <label className="check"><input type="checkbox" name="outstation" /> Outstation visit (travel and occupancy until return)</label>
        <div className="fields">
          <div className="field"><label htmlFor="np-dep">Departure (local time)</label><input id="np-dep" type="datetime-local" name="departureAt" /></div>
          <div className="field"><label htmlFor="np-ret">Return / release (local time)</label><input id="np-ret" type="datetime-local" name="returnAt" /></div>
        </div>
        <p className="small muted">Missing dates keep the plan tentative with named blockers; no buffer is added unless configured.</p>
      </fieldset>
      <div className="row"><button type="submit" className="primary" disabled={pending}>{pending ? "Creating…" : "Create draft plan and continue"}</button></div>
      <ResultNotice result={result} successText="Draft created. Opening the visit…" />
    </form>
  );
}
