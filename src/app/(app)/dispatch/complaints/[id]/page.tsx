import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { complaintDetail } from "@/server/queries/dispatch";
import { stageOf } from "@/domain/flow";
import { formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { Stepper, Timeline } from "@/components/dispatch/FlowViews";
import { BackForm, StageForm } from "@/components/dispatch/StageForms";
import { PriorityTag, UnlistedTag } from "@/components/dispatch/PriorityTag";
import { priorityLabel, productTypeLabel } from "@/domain/unlisted-items";
import { PhaseStrip } from "@/components/dispatch/ComplaintTracker";

export const metadata = { title: "Installation complaint" };

const SOURCE: Record<string, string> = { fg_in_stock: "Finished good in stock", raw_material: "Raw material", to_purchase: "To be purchased" };

export default async function ComplaintDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Notice tone="warn" title="Not found">That complaint does not exist.</Notice>;
  const { db, actor } = await session();
  let k;
  try { k = await complaintDetail(db, actor, id, Date.now()); } catch { return <Notice tone="warn" title="Not permitted">This complaint is outside your scope.</Notice>; }
  if (!k) return <Notice tone="warn" title="Not found">That complaint does not exist.</Notice>;
  const s = k.step;
  const backTargets = (s?.backTo ?? []).map((c) => ({ code: c, label: stageOf(k.def, c)?.label ?? c }));
  const selfCosted = s?.handler === "approve_cost" && k.costed_by === actor.id;
  return (
    <div className="stack flow-page">
      <Link href="/dispatch" className="small back-link"><CaretLeft size={14} aria-hidden /> Dispatch</Link>
      <header className="flow-head">
        <div className="spread"><span className="code-tag">{k.business_id} · {k.order_no} · <Link href={`/dispatch/${k.dispatch_id}`}>{k.dispatch_no}</Link> · {k.factory}</span>
          {k.status === "open" ? <span className="flow-stage">{s?.label ?? k.stage}</span> : <Badge state="closed" label={k.outcome === "replaced" ? "Closed: replaced" : "Closed: follow-up"} />}</div>
        <h1>{k.kind === "missing" ? "Missing" : "Damaged"}: {k.quantity} {k.unit} × {k.item}</h1>
        <p className="small muted" style={{ margin: 0 }}>{k.customer} · {k.project}</p>
        {(k.unlisted || k.priority !== "normal") && <div className="flow-tags"><PriorityTag priority={k.priority} /><UnlistedTag unlisted={k.unlisted} /></div>}
        <p style={{ margin: 0 }}>{k.reason}</p>
        <dl className="flow-facts">
          <div><dt>Priority</dt><dd>{priorityLabel(k.priority)}</dd></div>
          {k.product_type && <div><dt>Product type</dt><dd>{productTypeLabel(k.product_type)}{k.unlisted ? " · reported on site, not on the factory list" : ""}</dd></div>}
          <div><dt>Cost</dt><dd>{k.cost ? `${formatMoney(Math.round(Number(k.cost) * 100))}${k.approved_by_name ? ` · approved by ${k.approved_by_name}` : " · not approved yet"}` : "Not costed yet"}</dd></div>
          {k.item_source && <div><dt>Item type</dt><dd>{SOURCE[k.item_source] ?? k.item_source}</dd></div>}
          {k.replacement_dispatch_id && <div><dt>Replacement</dt><dd><Link href={`/dispatch/${k.replacement_dispatch_id}`}>{k.replacement_no}</Link></dd></div>}
          {k.superseded_by && <div><dt>Follow-up</dt><dd><Link href={`/dispatch/complaints/${k.superseded_by}`}>{k.superseded_no}</Link></dd></div>}
        </dl>
      </header>
      <PhaseStrip k={k} />
      <Stepper def={k.def} current={k.stage} status={k.status} />

      {k.status === "open" && s && (
        <section className="plate flow-now" aria-labelledby="h-now">
          <div className="plate-head"><h2 id="h-now" className="flow-now-title">{s.label}</h2><span className="small muted flow-now-age">{k.days_in_stage ? `${k.days_in_stage} day${k.days_in_stage === 1 ? "" : "s"} in this step` : "since today"}</span></div>
          {s.handler === "await_replacement" ? <p className="muted" style={{ margin: 0 }}>Closes when replacement {k.replacement_no} is received OK on site.</p>
            : !k.canAct ? <p className="muted" style={{ margin: 0 }}>Waiting for {s.owner.replace(/_/g, " ")}.</p>
            : selfCosted ? <p className="notice" data-tone="warn" style={{ margin: 0 }}>You costed this complaint, so someone else in Management approves it.</p>
            : <StageForm key={`${k.stage}-${k.version}`} kind="complaint" id={k.id} version={k.version} stage={s} cta={s.handler === "create_replacement" ? "Create replacement dispatch" : undefined} />}
          {k.canBack && backTargets.length > 0 && <BackForm kind="complaint" id={k.id} version={k.version} stage={k.stage} targets={backTargets} />}
        </section>
      )}

      <section className="plate" aria-labelledby="h-hist">
        <h2 id="h-hist" className="flow-subhead">History</h2>
        <Timeline rows={k.history} def={k.def} />
      </section>
    </div>
  );
}
