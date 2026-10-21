"use client";
import { commitScope } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { Badge } from "@/components/ui/Badge";
import { qty } from "@/lib/format";

interface ScopeRow { id: string; task: string; component: string; activity: string; unit: string; quantity_kind: string; scoped: string; kind: string; status: string; status_reason: string | null; accepted: string }
interface Task { id: string; business_id: string; component: string; activity: string; unit: string; required: string }

export function ScopeStep({ visitId, scope, tasks, orders, editable, needsReason }: { visitId: string; scope: ScopeRow[]; tasks: Task[]; orders: Array<{ business_id: string }>; editable: boolean; needsReason: boolean }) {
  const { run, pending, result } = useAction(commitScope);
  return (
    <div className="grid cols-2">
      <section className="card" aria-labelledby="h-scope">
        <h2 id="h-scope">Scoped work on this visit</h2>
        <p className="small muted">Orders: {orders.map((o) => o.business_id).join(", ")}. Quantities carry their unit and quantity kind; completion is never inferred from hours.</p>
        {scope.length === 0 ? <p className="muted">No scope yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Task</th><th>Component / step</th><th className="num">Scoped</th><th className="num">Accepted</th><th>Kind</th><th>Status</th></tr></thead>
            <tbody>{scope.map((s) => (
              <tr key={s.id}>
                <td>{s.task}</td><td>{s.component} · {s.activity}<div className="small muted">{s.quantity_kind.replace(/_/g, " ")}</div></td>
                <td className="num">{qty(s.scoped)} {s.unit}</td><td className="num">{qty(s.accepted)} {s.unit}</td>
                <td>{s.kind}</td><td><Badge state={s.status === "active" ? "scheduled" : s.status} label={s.status} />{s.status_reason && <div className="small muted">{s.status_reason}</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <section className="card" aria-labelledby="h-add">
        <h2 id="h-add">Add scope</h2>
        {!editable ? <p className="muted">This plan is awaiting review or closed.</p> : (
          <form className="form" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run({ visitId, taskId: String(f.get("taskId")), quantity: String(f.get("quantity")), kind: String(f.get("kind")), changeReason: f.get("changeReason") ? String(f.get("changeReason")) : undefined });
          }}>
            <div className="field"><label htmlFor="sc-task">Task</label>
              <select id="sc-task" name="taskId" required>{tasks.map((t) => <option key={t.id} value={t.id}>{t.business_id} · {t.component} · {t.activity} (required {qty(t.required)} {t.unit})</option>)}</select></div>
            <div className="fields">
              <div className="field"><label htmlFor="sc-q">Quantity</label><input id="sc-q" name="quantity" inputMode="decimal" pattern="\d+(\.\d{1,6})?" required /></div>
              <div className="field"><label htmlFor="sc-k">Kind</label>
                <select id="sc-k" name="kind" defaultValue="original"><option value="original">Original scope</option><option value="rework">Rework (needs reason)</option><option value="additional">Authorized additional scope</option></select></div>
            </div>
            <div className="field"><label htmlFor="sc-r">Reason {needsReason ? "(required: starts a new revision)" : "(required for rework or additional scope)"}</label><input id="sc-r" name="changeReason" /></div>
            <p className="small muted">Original scope is limited to quantity not yet accepted or committed to another active visit. Completed work returns only as rework. Additional scope recorded here is the dated approval that later overtime reviews rely on.</p>
            <button type="submit" className="primary" disabled={pending}>{pending ? "Saving…" : "Add to visit"}</button>
            <ResultNotice result={result} successText="Scope added." />
          </form>
        )}
      </section>
    </div>
  );
}
