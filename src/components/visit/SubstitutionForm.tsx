"use client";
/**
 * Replace one booked crew member from an effective date and time. Earlier days stay with the outgoing person;
 * the incoming person goes through the same overlap, leave and skill checks as any booking.
 */
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { substitute } from "@/app/actions";

export function SubstitutionForm({ visitId, staffing, candidates, today }: {
  visitId: string; staffing: Array<{ employee_id: string; employee: string; business_id: string; state: string }>;
  candidates: Array<{ id: string; business_id: string; name: string; job_role: string; skills: string }>; today: string;
}) {
  const a = useAction(substitute);
  const booked = staffing.filter((m) => m.state === "held" || m.state === "confirmed");
  const others = candidates.filter((c) => !booked.some((m) => m.employee_id === c.id));
  return (
    <section className="card stack" aria-labelledby="h-subst">
      <h2 id="h-subst">Replace a crew member</h2>
      <p className="small muted" style={{ margin: 0 }}>Use this when someone cannot continue (leave, emergency, reassignment). Their completed days and recorded time stay theirs; the replacement is booked from the moment you choose.</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
        a.run({ visitId, outgoingId: f.get("o"), incomingId: f.get("i"), date: f.get("d"), time: f.get("t"), reason: f.get("r") }); }}>
        <div className="fields">
          <div className="field"><label htmlFor="sb-o">Outgoing</label><select id="sb-o" name="o" required>{booked.map((m) => <option key={m.employee_id} value={m.employee_id}>{m.employee} ({m.business_id})</option>)}</select></div>
          <div className="field"><label htmlFor="sb-i">Incoming</label><select id="sb-i" name="i" required>{others.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.business_id}) · {c.job_role.replace(/_/g, " ")} · {c.skills}</option>)}</select></div>
          <div className="field"><label htmlFor="sb-d">From date</label><input id="sb-d" name="d" type="date" defaultValue={today} required /></div>
          <div className="field"><label htmlFor="sb-t">From time</label><input id="sb-t" name="t" type="time" defaultValue="09:00" required /></div>
        </div>
        <div className="field"><label htmlFor="sb-r">Reason</label><input id="sb-r" name="r" required minLength={5} placeholder="For example: approved leave from Thursday" /></div>
        <div><button type="submit" className="primary" disabled={a.pending || booked.length === 0}>Replace</button></div>
        <ResultNotice result={a.result} successText="Replaced. The outgoing booking now ends at the chosen moment and the history keeps both." />
      </form>
    </section>
  );
}
