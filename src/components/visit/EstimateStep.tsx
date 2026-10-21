import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { hours, qty } from "@/lib/format";

interface Line { visitTaskId: string; taskBusinessId: string; component: string; activity: string; quantity: string; unit: string; quantityKind: string; rateId: string | null; provisional: boolean; personMinutes: string | null; teamDays: string | null; personDays: string | null; issues: string[]; explanation: string[] }

export function EstimateStep({ estimate }: { estimate: { lines: Line[]; totalPersonMinutes: string; complete: boolean; provisional: boolean } }) {
  return (
    <section className="card stack" aria-labelledby="h-est">
      <h2 id="h-est">Effort estimate (server-calculated)</h2>
      {estimate.provisional && <Notice tone="warn">Uses illustrative or draft productivity rates, so the estimate is provisional. Only an authorized estimator can approve a rate version.</Notice>}
      {!estimate.complete && <Notice tone="warn">Some scope has no matching rate or has validation issues; those lines contribute no effort and are listed below.</Notice>}
      {estimate.lines.length === 0 ? <p className="muted">Add scope first.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Task</th><th>Quantity</th><th>Rate</th><th className="num">Team-days</th><th className="num">Person-days</th><th className="num">Person-hours</th><th>How it was calculated</th></tr></thead>
          <tbody>{estimate.lines.map((l) => (
            <tr key={l.visitTaskId}>
              <td>{l.taskBusinessId}<div className="small muted">{l.component} · {l.activity}</div></td>
              <td>{qty(l.quantity)} {l.unit}<div className="small muted">{l.quantityKind.replace(/_/g, " ")}</div></td>
              <td>{l.rateId ?? "—"} {l.rateId && <Badge state={l.provisional ? "illustrative" : "approved"} label={l.provisional ? "Provisional" : "Approved"} />}</td>
              <td className="num">{l.teamDays ? qty(l.teamDays) : "—"}</td>
              <td className="num">{l.personDays ? qty(l.personDays) : "—"}</td>
              <td className="num">{l.personMinutes ? hours(Number(l.personMinutes)) : "—"}</td>
              <td className="small">{[...l.explanation, ...l.issues].map((t) => <div key={t}>{t}</div>)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><th colSpan={5}>Total required effort</th><th className="num">{hours(Number(estimate.totalPersonMinutes))}</th><th /></tr></tfoot>
        </table></div>
      )}
      <p className="small muted">Team-days and person-days are different: person-days = team-days × crew attending the full interval. Rate-based effort and role templates are alternatives and are never added together. Scheduling against a shorter employee calendar adds calendar days; it never reduces estimated effort.</p>
    </section>
  );
}
