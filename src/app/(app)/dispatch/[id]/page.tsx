import Link from "next/link";
import { CaretLeft, CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { dispatchDetail } from "@/server/queries/dispatch";
import { stageOf } from "@/domain/flow";
import { shortDate } from "@/domain/install-schedule";
import { Badge } from "@/components/ui/Badge";
import { Empty, Notice } from "@/components/ui/Notice";
import { Stepper, Timeline } from "@/components/dispatch/FlowViews";
import { BackForm, StageForm } from "@/components/dispatch/StageForms";
import { ReceiveForm } from "@/components/dispatch/ReceiveForm";
import { SiteReports } from "@/components/dispatch/SiteReports";
import { PriorityTag, UnlistedTag } from "@/components/dispatch/PriorityTag";
import { siteReports } from "@/server/services/site-mnd";
import { stageRecipients } from "@/server/services/flow-core";

export const metadata = { title: "Dispatch" };

export default async function DispatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Notice tone="warn" title="Not found">That dispatch does not exist.</Notice>;
  const { db, actor } = await session();
  let d;
  try { d = await dispatchDetail(db, actor, id, Date.now()); } catch { return <Notice tone="warn" title="Not permitted">This dispatch is outside your scope.</Notice>; }
  if (!d) return <Notice tone="warn" title="Not found">That dispatch does not exist.</Notice>;
  const s = d.step;
  const reports = await siteReports(db, actor, d.id);
  const canDecide = d.roles.includes("installation_manager") && (await stageRecipients(db, "installation_manager", d.project_id)).includes(actor.id);
  const owner = s?.owner === "installation_manager" ? "the Installation Manager" : s?.owner?.replace(/_/g, " ");
  // Complaints can't be overlooked: a red banner under the stepper and the list right after the current step.
  const open = d.complaints.filter((k) => k.status === "open");
  const missing = open.filter((k) => k.kind === "missing").length;
  const backTargets = (s?.backTo ?? []).map((c) => ({ code: c, label: stageOf(d.def, c)?.label ?? c }));
  return (
    <div className="stack flow-page">
      <Link href="/dispatch" className="small back-link"><CaretLeft size={14} aria-hidden /> Dispatch</Link>
      <header className="flow-head">
        <div className="spread"><span className="code-tag">{d.business_id} · {d.order_no} · {d.factory}</span>
          {d.status === "open" ? <span className="flow-stage">{s?.label ?? d.stage}</span> : <Badge state={d.status} />}</div>
        <h1>{d.customer} · {d.project}</h1>
        <p className="small muted" style={{ margin: 0 }}>{d.types.join(" + ")} · {d.items.length} BOM line{d.items.length === 1 ? "" : "s"} · {d.city}</p>
        {(d.replacement_for || d.partial || d.hold_until) && <div className="flow-tags">
          {d.replacement_for && <span className="flow-tag" data-tone="warn">Replacement – Complaint <Link href={`/dispatch/complaints/${d.replacement_for}`}>{d.replacement_no}</Link></span>}
          {d.partial && <span className="flow-tag" data-tone="warn">Partial: complaint open</span>}
          {d.hold_until && <span className="flow-tag" data-tone="bad">Site not ready until {shortDate(d.hold_until)}: {d.hold_reason}</span>}
        </div>}
      </header>
      <Stepper def={d.def} current={d.stage} status={d.status} />
      {open.length > 0 && (
        <a href="#complaints" className="complaint-banner" role="alert">
          <WarningCircle size={22} weight="fill" aria-hidden />
          <span><strong>{open.length} open complaint{open.length === 1 ? "" : "s"}</strong>
            <span className="small">{[missing && `${missing} missing`, open.length - missing && `${open.length - missing} damaged`].filter(Boolean).join(", ")}</span></span>
          <span className="complaint-banner-go">View</span>
        </a>
      )}

      {d.status === "open" && s && (
        <section className="plate flow-now" aria-labelledby="h-now">
          <div className="plate-head"><h2 id="h-now" className="flow-now-title">{s.label}</h2><span className="small muted flow-now-age">{d.days_in_stage ? `${d.days_in_stage} day${d.days_in_stage === 1 ? "" : "s"} in this step` : "since today"}</span></div>
          {!d.canAct ? <p className="muted" style={{ margin: 0 }}>Waiting for {owner}.</p>
            : s.handler === "receive_mnd" ? <ReceiveForm key={d.version} dispatchId={d.id} version={d.version} stage={d.stage} lines={d.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unit: i.unit }))} />
            : <StageForm key={`${d.stage}-${d.version}`} kind="dispatch" id={d.id} version={d.version} stage={s} cta={d.hold_until && s.code === "site_readiness" ? "Update site readiness" : undefined} />}
          {d.canBack && backTargets.length > 0 && <BackForm kind="dispatch" id={d.id} version={d.version} stage={d.stage} targets={backTargets} />}
        </section>
      )}

      <section className="plate flow-complaints" id="complaints" aria-labelledby="h-comp" data-open={open.length > 0 || undefined}>
        <h2 id="h-comp" className="flow-subhead">Complaints from this dispatch ({open.length} open of {d.complaints.length})</h2>
        {d.complaints.length === 0 ? <Empty>None.</Empty> : (
          <ul className="flow-cards compact">{d.complaints.map((k) => (
            <li key={k.id} className="flow-card" data-complaint={k.status === "open" ? "open" : undefined}><Link href={`/dispatch/complaints/${k.id}`}>
              <span className="spread"><span className="code-tag">{k.business_id}</span><span className="flow-stage">{k.status === "open" ? k.stage_label : k.outcome === "replaced" ? "Closed: replaced" : "Closed: follow-up complaint"}</span></span>
              <span className="small">{k.kind === "missing" ? "Missing" : "Damaged"}: {k.quantity} × {k.item}</span>
              {(k.unlisted || k.priority !== "normal") && <span className="flow-tags"><PriorityTag priority={k.priority} /><UnlistedTag unlisted={k.unlisted} /></span>}</Link></li>
          ))}</ul>
        )}
      </section>

      <section className="plate" aria-labelledby="h-items">
        <h2 id="h-items" className="flow-subhead">BOM on this dispatch</h2>
        {d.items.length === 0 ? <Empty>The factory hasn&apos;t added the item list yet.</Empty> : <ul className="bom-list">
          {d.items.map((i) => (
            <li key={i.id} data-unlisted={i.unlisted || undefined}><span className="bom-name">{i.name}
              {i.unlisted ? <span className="flow-tags"><UnlistedTag unlisted productType={i.product_type} /></span> : <span className="small muted">{i.dispatch_group ?? "no type"}</span>}</span>
              <span className="bom-qty">{i.quantity} {i.unit}</span>
              {i.received_ok === true && <CheckCircle size={18} weight="fill" className="receive-ok" aria-label="Received OK" />}
              {i.received_ok === false && <WarningCircle size={18} weight="fill" className="receive-bad" aria-label="Missing or damaged" />}</li>
          ))}
        </ul>}
      </section>

      {reports.length > 0 && (
        <section className="plate" id="site-reports" aria-labelledby="h-rep">
          <h2 id="h-rep" className="flow-subhead">Reports from the site ({reports.filter((r) => r.status === "pending").length} waiting)</h2>
          <SiteReports reports={reports} canDecide={canDecide} />
        </section>
      )}

      <section className="plate" aria-labelledby="h-hist">
        <h2 id="h-hist" className="flow-subhead">History</h2>
        <Timeline rows={d.history} def={d.def} />
      </section>
    </div>
  );
}
