"use client";
import { addTravelLeg, recordTravelActual } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { Badge } from "@/components/ui/Badge";
import { when } from "@/lib/format";

interface Leg { id: string; business_id: string; kind: string; origin: string; destination: string; planned_depart: number; planned_arrive: number; actual_depart: number | null; actual_arrive: number | null; certainty: string; travellers: string }

const iso = (local: FormDataEntryValue | null) => (local ? new Date(String(local)).toISOString() : undefined);

export function TravelPanel({ visitId, legs, timezone, needsReason }: { visitId: string; legs: Leg[]; timezone: string; needsReason: boolean }) {
  const add = useAction(addTravelLeg);
  const act = useAction(recordTravelActual);
  return (
    <section className="card stack" aria-labelledby="h-travel">
      <h2 id="h-travel">Travel legs</h2>
      <p className="small muted">Shared itinerary for the visit team. Outstation occupancy runs from the first departure to the final return, so a conflicting local assignment is blocked even after site work ends. Hotel nights follow the itinerary, not the number of workdays.</p>
      {legs.length === 0 ? <p className="muted">No travel planned.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Leg</th><th>Route</th><th>Planned</th><th>Actual</th><th>Travellers</th><th>Status</th><th>Record actual</th></tr></thead>
          <tbody>{legs.map((l) => (
            <tr key={l.id}>
              <td>{l.business_id}<div className="small muted">{l.kind.replace("_", "-")}</div></td><td>{l.origin} → {l.destination}</td>
              <td className="small">{when(l.planned_depart, timezone)} → {when(l.planned_arrive, timezone)}</td>
              <td className="small">{l.actual_depart ? `${when(l.actual_depart, timezone)} → ${when(l.actual_arrive, timezone)}` : "—"}</td>
              <td className="small">{l.travellers}</td><td><Badge state={l.certainty === "confirmed" ? "confirmed" : "pending"} label={l.certainty} /></td>
              <td>
                <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act.run({ legId: l.id, actualDepart: iso(f.get("d")), actualArrive: iso(f.get("a")), certainty: "confirmed" }); }}>
                  <label className="sr-only" htmlFor={`ad-${l.id}`}>Actual departure</label><input id={`ad-${l.id}`} name="d" type="datetime-local" style={{ width: 190 }} />
                  <label className="sr-only" htmlFor={`aa-${l.id}`}>Actual arrival</label><input id={`aa-${l.id}`} name="a" type="datetime-local" style={{ width: 190 }} />
                  <button type="submit" disabled={act.pending}>Save</button>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <ResultNotice result={act.result} successText="Actual travel recorded." />
      <form className="form" onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        add.run({ visitId, kind: String(f.get("k")), origin: String(f.get("o")), destination: String(f.get("de")), plannedDepart: iso(f.get("pd")), plannedArrive: iso(f.get("pa")),
          certainty: String(f.get("c")), changeReason: String(f.get("r") || "") || undefined });
      }}>
        <h3>Add a leg (whole team)</h3>
        <div className="fields">
          <div className="field"><label htmlFor="tl-k">Type</label><select id="tl-k" name="k"><option value="outbound">Outbound</option><option value="inter_site">Inter-site</option><option value="return">Return</option></select></div>
          <div className="field"><label htmlFor="tl-o">From</label><input id="tl-o" name="o" required minLength={2} /></div>
          <div className="field"><label htmlFor="tl-de">To</label><input id="tl-de" name="de" required minLength={2} /></div>
          <div className="field"><label htmlFor="tl-pd">Departs (local)</label><input id="tl-pd" name="pd" type="datetime-local" required /></div>
          <div className="field"><label htmlFor="tl-pa">Arrives (local)</label><input id="tl-pa" name="pa" type="datetime-local" required /></div>
          <div className="field"><label htmlFor="tl-c">Certainty</label><select id="tl-c" name="c"><option value="tentative">Tentative</option><option value="confirmed">Confirmed (tickets held)</option></select></div>
        </div>
        {needsReason && <div className="field"><label htmlFor="tl-r">Change reason (may start a new revision)</label><input id="tl-r" name="r" /></div>}
        <button type="submit" disabled={add.pending}>Add leg</button>
        <ResultNotice result={add.result} successText="Travel leg added." />
      </form>
    </section>
  );
}
