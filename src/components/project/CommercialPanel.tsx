/** Commercial tab: customer charges and additional work beside internal estimate, budget and actual cost, never netted into "profit". */
import type { commercialSummary } from "@/server/services/commercial";
import { formatMoney, hours, when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Notice";
import { AdditionalWorkForm, ChargeForm, DecideAdditionalWork } from "./CommercialForms";

type Summary = Awaited<ReturnType<typeof commercialSummary>>;
const CHARGE: Record<string, string> = { chargeable: "Chargeable", free_of_charge: "Free of charge", waived: "Waived" };

export function CommercialPanel({ projectId, c, orders, actorId, isManager }: { projectId: string; c: Summary; orders: Array<{ id: string; label: string }>; actorId: string; isManager: boolean }) {
  const t = c.totals;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" aria-labelledby="h-money">
        <h2 id="h-money">Charges and costs, side by side</h2>
        <ul className="spec">
          {[["Quoted installation charge", formatMoney(t.quoted)], ["Waived", formatMoney(t.waived)], ["Charged after waivers", formatMoney(t.charged)],
            ["Approved additional work, chargeable", formatMoney(t.additionalChargeable)], ["Additional work free of charge or waived", `${t.freeOfCharge} item${t.freeOfCharge === 1 ? "" : "s"}`],
            ["Internal estimate (latest)", t.estimate === null ? "None" : formatMoney(t.estimate)], ["Approved budget", t.budget === null ? "None (not zero)" : formatMoney(t.budget)],
            ["Approved actual cost", t.actual === null ? "None" : formatMoney(t.actual)]].map(([l, v]) => (
            <li key={l}><div className="spec-row" style={{ gridTemplateColumns: "1fr auto" }}><span className="spec-label">{l}</span><span className="spec-text">{v}</span></div></li>
          ))}
        </ul>
        <p className="small muted" style={{ margin: 0 }}>These are kept apart on purpose. A zero customer charge never means zero effort, and no figure here is company profit; an operational contribution needs an approved cost allocation first.</p>
        {isManager && <details><summary className="button">Record the quoted installation charge</summary><ChargeForm projectId={projectId} orders={orders} /></details>}
      </section>

      <section className="card stack" aria-labelledby="h-aw">
        <h2 id="h-aw">Additional work ({c.work.length})</h2>
        {c.work.length === 0 ? <Empty>No additional work requested.</Empty> : (
          <ul className="req-list">
            {c.work.map((w) => (
              <li key={w.id}>
                <span className="code-tag">{w.business_id}</span>
                <span><strong>{w.description}</strong>
                  <span className="small muted" style={{ display: "block" }}>{w.order}{w.visit ? ` · ${w.visit}` : ""} · asked by {w.requested_by.replace("_", " ")} · {w.reason}{w.estimated_minutes ? ` · est. ${hours(w.estimated_minutes)}` : ""} · {w.created_by_name ?? "unknown"}, {when(w.created_at)}</span>
                  {w.status === "approved" && <span className="small" style={{ display: "block" }}>{CHARGE[w.charge_type ?? ""]}{w.quoted_amount_minor !== null ? ` · quoted ${formatMoney(w.quoted_amount_minor)}` : ""}{w.planned_cost_minor !== null ? ` · planned cost ${formatMoney(w.planned_cost_minor)}` : ""}{w.commercial_ref ? ` · ${w.commercial_ref}` : ""} · {w.decided_by_name}</span>}
                  {w.status === "requested" && isManager && w.created_by !== actorId && <details><summary className="small">Decide</summary><DecideAdditionalWork id={w.id} /></details>}</span>
                <Badge state={w.status === "requested" ? "pending" : w.status} />
              </li>
            ))}
          </ul>
        )}
        <details><summary className="button">Request additional work</summary><AdditionalWorkForm projectId={projectId} orders={orders} /></details>
      </section>
    </div>
  );
}
