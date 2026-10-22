/** Packages tab: manifest with derived receipt status, scans and exceptions. Counts use distinct packages. */
import type { packageBoard } from "@/server/services/packages";
import { when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Notice";
import { AddPackageForm, DecidePackage, PackageExceptionForm, ScanBox } from "./PackageForms";

type Board = Awaited<ReturnType<typeof packageBoard>>;
const STATUS: Record<string, [string, string]> = { expected: ["Expected", "neutral"], dispatched: ["Dispatched", "accent"], received: ["Received (box)", "ok"], receipt_unverified: ["Receipt unverified", "warn"] };

export function PackagesPanel({ projectId, b, orders, canEdit, isManager }: { projectId: string; b: Board; orders: Array<{ id: string; label: string }>; canEdit: boolean; isManager: boolean }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" aria-labelledby="h-pkg">
        <h2 id="h-pkg">Packages ({b.counts.received} of {b.counts.total} received)</h2>
        {b.counts.unverified > 0 && <p className="notice" data-tone="warn" role="status">{b.counts.unverified} dispatched package{b.counts.unverified === 1 ? " has" : "s have"} no receipt scan while the visit is under way. That means receipt is unverified, not that anything is lost; investigate before assigning fault.</p>}
        <ScanBox projectId={projectId} kinds={canEdit ? ["receipt", "damage", "dispatch"] : ["receipt", "damage"]} />
        {b.packages.length === 0 ? <Empty>No packages in the manifest.</Empty> : (
          <div className="table-wrap"><table className="rows-mobile">
            <thead><tr><th>Code</th><th>Order</th><th>Description</th><th>Dispatched</th><th>Received</th><th>Status</th></tr></thead>
            <tbody>{b.packages.map((p) => (
              <tr key={p.id}>
                <td data-label="Code" className="code">{p.code}{p.high_value && <div className="small">High value</div>}</td>
                <td data-label="Order">{p.order}{p.load_ref ? <div className="small muted">{p.load_ref}</div> : null}</td>
                <td data-label="Description">{p.description}{p.expected_contents && <div className="small muted">{p.expected_contents}</div>}{p.weight_kg && <div className="small muted">{p.weight_kg} kg (supporting signal only)</div>}</td>
                <td data-label="Dispatched">{p.dispatched_at ? when(p.dispatched_at) : "None"}</td>
                <td data-label="Received">{p.received_at ? when(p.received_at) : "None"}</td>
                <td data-label="Status"><Badge state={p.status} tone={STATUS[p.status]![1] as never} label={STATUS[p.status]![0]} />{p.damaged && <Badge state="fail" tone="bad" label="Damage" />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="small muted" style={{ margin: 0 }}>Receiving the outer box does not confirm every item inside; equal weight is not proof of contents. {b.counts.scanEvents} scan events recorded; repeat scans are not counted twice.</p>
        {canEdit && <details><summary className="button">Add a package to the manifest</summary><AddPackageForm projectId={projectId} orders={orders} /></details>}
      </section>

      <section className="card stack" aria-labelledby="h-px">
        <h2 id="h-px">Shortages, damage and unknown scans ({b.exceptions.length})</h2>
        {b.exceptions.length === 0 ? <Empty>No package exceptions.</Empty> : (
          <ul className="req-list">
            {b.exceptions.map((x) => (
              <li key={x.id}><span className="code-tag">{x.business_id}</span>
                <span><strong>{x.kind.replace(/_/g, " ")}{x.code ? ` · ${x.code}` : ""}</strong><span className="small muted" style={{ display: "block" }}>{x.description} · {x.by ?? "unknown"}, {when(x.created_at)}</span>
                  <span className="small" style={{ display: "block" }}>Responsibility: {x.responsible_function ?? "not assessed"} · replacement {x.replacement_status} · charge {x.charge_type?.replace(/_/g, " ") ?? "not decided"}</span>
                  {isManager && x.status === "open" && <details><summary className="small">Decide</summary><DecidePackage id={x.id} /></details>}</span>
                <Badge state={x.status === "open" ? "open" : "closed"} /></li>
            ))}
          </ul>
        )}
        <details><summary className="button">Report a missing or damaged item</summary><PackageExceptionForm projectId={projectId} packages={b.packages.map((p) => ({ id: p.id, code: p.code }))} /></details>
      </section>
    </div>
  );
}
