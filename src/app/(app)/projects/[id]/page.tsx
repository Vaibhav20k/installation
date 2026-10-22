import Link from "next/link";
import { session } from "@/server/session";
import { projectDetail } from "@/server/queries/projects";
import { expenseSummary } from "@/server/queries/dashboard";
import { AppError } from "@/server/errors";
import { formatMoney, hours, qty, when } from "@/lib/format";
import { Badge, DemoTag } from "@/components/ui/Badge";
import { Empty, Notice, PageHeader, Tabs } from "@/components/ui/Notice";
import { QualityPanel } from "@/components/project/QualityPanel";
import { ScopeForms } from "@/components/project/ScopeForms";
import { SitePanel } from "@/components/project/SitePanel";
import { siteDetail } from "@/server/queries/site";
import { CommercialPanel } from "@/components/project/CommercialPanel";
import { commercialSummary } from "@/server/services/commercial";
import { CustomerPanel } from "@/components/project/CustomerPanel";
import { customerDetail } from "@/server/services/customer";
import { PackagesPanel } from "@/components/project/PackagesPanel";
import { packageBoard } from "@/server/services/packages";
import { localDateOf } from "@/lib/dates";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, actor } = await session();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Notice tone="bad">Project not found.</Notice>;
  let d;
  try { d = await projectDetail(db, actor, id); } catch (e) {
    if (e instanceof AppError) return <Notice tone="warn" title="Not available">{e.message}</Notice>;
    throw e;
  }
  const tab = sp.tab ?? "scope";
  const p = d.project;
  const remaining = d.scope.filter((t) => Number(t.remaining) > 0).length;
  const tabs = [
    { id: "scope", label: `Orders & components (${remaining} open tasks)` }, { id: "visits", label: `Visits (${d.visits.length})` }, { id: "site", label: "Site & readiness" }, { id: "commercial", label: "Charges & extra work" }, { id: "customer", label: "Customer & design" }, { id: "packages", label: "Packages" }, { id: "team", label: "Team" },
    { id: "time", label: "Time" }, { id: "expenses", label: "Expenses" }, { id: "quality", label: `Quality & issues (${d.quality.length + d.issues.length})` }, { id: "history", label: "History" },
  ].map((t) => ({ ...t, href: `/projects/${id}?tab=${t.id}` }));
  const orders = [...new Map(d.scope.map((t) => [t.order_id, t])).values()];
  return (
    <>
      <PageHeader title={`${p.business_id} · ${p.name}`} subtitle={<>{p.customer} ({p.customer_bid}) · {p.site_address}, {p.city} · {p.timezone} {p.is_demo && <DemoTag />}</>}
        actions={actor.role !== "employee" ? <Link className="button primary" href={`/planning/new?project=${id}`}>Plan a visit</Link> : undefined} />
      <section className="card" aria-label="Project summary">
        <dl className="facts">
          <dt>Manager</dt><dd>{p.manager ?? "None"}</dd>
          <dt>Kitchen floor area</dt><dd>{p.kitchen_floor_area ? `${qty(p.kitchen_floor_area)} ${p.kitchen_floor_area_unit}` : "Not recorded"} <span className="muted small">(floor area; not the installed cabinet or stone surface quantity)</span></dd>
          <dt>Source</dt><dd>{p.source_system ?? "manual"}{p.lead_ref ? ` · lead ${p.lead_ref} (${p.lead_source ?? "source unknown"}), converted ${when(p.converted_at)}` : ""}</dd>
          <dt>Plans</dt><dd>{d.plans.map((pl) => <span key={pl.id} className="small" style={{ marginRight: 12 }}>{pl.business_id}: rev {pl.latest} <Badge state={pl.latest_state} />{pl.baseline ? ` · baseline r${pl.baseline}` : ""}</span>)}{d.plans.length === 0 && "None"}</dd>
        </dl>
      </section>
      <Tabs items={tabs} current={tab} />

      {tab === "scope" && (actor.role === "manager" || actor.role === "admin") && <ScopeForms projectId={id} orders={d.orderList} items={d.itemList} />}
      {tab === "scope" && d.orderList.filter((o) => !orders.some((x) => x.order_id === o.id)).map((o) => (
        <section key={o.id} className="card"><h2>{o.business_id} <Badge state="pending" label={o.status.replace("_", " ")} /></h2><p className="muted">No components yet. Add an order item and its components above.</p></section>
      ))}
      {tab === "scope" && orders.map((o) => (
        <section key={o.order_id} className="card stack" aria-labelledby={`o-${o.order_id}`}>
          <h2 id={`o-${o.order_id}`}>{o.order_bid} <Badge state={o.order_status === "dispatched" ? "confirmed" : "pending"} label={o.order_status.replace("_", " ")} /> <span className="small muted">{o.external_ref ? `source ref ${o.external_ref}` : ""}</span></h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Order item</th><th>Component</th><th>Task</th><th className="num">Required</th><th className="num">Available</th><th className="num">Committed to visits</th><th className="num">Accepted</th><th className="num">Remaining</th></tr></thead>
            <tbody>{d.scope.filter((t) => t.order_id === o.order_id).map((t) => (
              <tr key={t.task_id}>
                <td>{t.item_bid} · {t.item_name}<div className="small muted">{t.product_type}</div></td>
                <td>{t.component_bid} · {t.component}<div className="small muted">{t.quantity_kind.replace(/_/g, " ")}</div></td>
                <td>{t.task_bid} · {t.activity}</td>
                <td className="num">{qty(t.required)} {t.unit}</td><td className="num">{qty(t.available_quantity)}</td><td className="num">{qty(t.committed)}</td>
                <td className="num">{qty(t.accepted)}</td><td className="num">{Number(t.remaining) > 0 ? <strong>{qty(t.remaining)}</strong> : <Badge state="completed" label="Done" />}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="small muted">Partly dispatched orders can only release the component quantity that is available.</p>
        </section>
      ))}

      {tab === "visits" && (d.visits.length === 0 ? <Empty>No visits planned yet.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Visit</th><th>Type</th><th>Plan revision</th><th>Execution</th><th>Dates</th><th className="num">Staff</th><th>Repeat reason</th></tr></thead>
          <tbody>{d.visits.map((v) => (
            <tr key={v.id}><td><Link href={`/visits/${v.id}`}>{v.business_id}</Link></td><td>{v.visit_type.replace("_", "-")}</td><td>{v.plan_bid} r{v.revision_no} <Badge state={v.approval_state} /></td>
              <td><Badge state={v.exec_status} /></td><td>{v.planned_start ?? "None"} → {v.planned_end ?? "None"}</td><td className="num">{v.staff}/{v.team_size}</td><td>{v.repeat_reason?.replace(/_/g, " ") ?? "None"}</td></tr>
          ))}</tbody>
        </table></div>
      ))}

      {tab === "team" && (d.team.length === 0 ? <Empty>No staff assigned.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Visit</th><th>Employee</th><th>Role</th><th>Reservation</th><th>From</th><th>To</th></tr></thead>
          <tbody>{d.team.map((t, i) => <tr key={i}><td>{t.visit}</td><td><Link href={`/people/${t.employee_id}`}>{t.employee}</Link> <span className="muted small">{t.business_id}</span></td><td>{t.role.replace(/_/g, " ")}</td><td><Badge state={t.state} /></td><td>{when(t.start, p.timezone)}</td><td>{when(t.end, p.timezone)}</td></tr>)}</tbody>
        </table></div>
      ))}

      {tab === "time" && (d.time.length === 0 ? <Empty>No time recorded on this project.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Employee</th><th>Activity</th><th>From</th><th>To</th><th className="num">Net</th><th>State</th></tr></thead>
          <tbody>{d.time.map((t, i) => <tr key={i}><td>{t.employee}</td><td>{t.activity}</td><td>{when(t.start, p.timezone)}</td><td>{when(t.end, p.timezone)}</td><td className="num">{hours(t.minutes)}</td><td><Badge state={t.state} />{t.is_exception && <Badge state="pending" label="Exception" />}</td></tr>)}</tbody>
        </table></div>
      ))}

      {tab === "expenses" && await (async () => {
        const [e] = await expenseSummary(db, actor, { projectId: id });
        return e ? (
          <section className="card"><dl className="facts">
            <dt>Latest estimates</dt><dd>{formatMoney(e.estimate)}</dd><dt>Approved budget</dt><dd>{formatMoney(e.budget)}</dd>
            <dt>Approved actual</dt><dd>{formatMoney(e.actual)}</dd><dt>Submitted, awaiting approval</dt><dd>{formatMoney(e.submitted)}</dd>
            <dt>Variance vs budget</dt><dd>{e.budgetVarianceMinor === null ? "N/A (no approved budget)" : `${formatMoney(e.budgetVarianceMinor)} (${e.budgetVariancePercent ?? "N/A"}%)`}</dd>
          </dl><p><Link href={`/expenses?project=${id}`}>Open expenses for this project</Link></p></section>
        ) : null;
      })()}

      {tab === "site" && <SitePanel projectId={id} s={await siteDetail(db, actor, id)} canEdit={actor.role !== "employee"} canExcept={actor.role === "manager" || actor.role === "admin"} />}

      {tab === "commercial" && <CommercialPanel projectId={id} c={await commercialSummary(db, actor, id)} orders={d.orderList.map((o) => ({ id: o.id, label: o.business_id }))} actorId={actor.id} isManager={actor.role === "manager" || actor.role === "admin"} />}

      {tab === "customer" && <CustomerPanel projectId={id} c={await customerDetail(db, actor, id)} items={d.itemList}
        today={localDateOf(Date.now(), p.timezone)} canEdit={actor.role !== "employee"} isManager={actor.role === "manager" || actor.role === "admin"} actorId={actor.id} />}

      {tab === "packages" && <PackagesPanel projectId={id} b={await packageBoard(db, actor, id, Date.now())} orders={d.orderList.map((o) => ({ id: o.id, label: o.business_id }))}
        canEdit={actor.role !== "employee"} isManager={actor.role === "manager" || actor.role === "admin"} />}

      {tab === "quality" && <QualityPanel projectId={id} quality={d.quality} issues={d.issues} orders={orders.map((o) => ({ id: o.order_id, business_id: o.order_bid }))} actorId={actor.id} />}

      {tab === "history" && (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Object</th><th>Reason</th></tr></thead>
          <tbody>{d.history.map((h, i) => <tr key={i}><td>{when(h.at, p.timezone)}</td><td>{h.actor ?? "system"}</td><td>{h.action.replace(/_/g, " ")}</td><td>{h.object_type.replace(/_/g, " ")}</td><td className="small">{h.reason ?? "None"}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}
