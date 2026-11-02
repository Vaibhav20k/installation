import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { myTasks } from "@/server/queries/work";
import { myPending } from "@/server/queries/dispatch";
import { flowFilter, loadDefinition } from "@/server/services/flow-core";
import { sitePlans, PLAN_LABELS } from "@/server/services/workforce";
import { reportsToDecide } from "@/server/services/site-mnd";
import { loadApprovals } from "@/components/approvals/waiting";
import { sortQueues } from "@/components/approvals/Queue";
import { qty, when } from "@/lib/format";
import { planLane, visitLane, type TaskLane } from "@/lib/task-guidance";
import { Badge } from "@/components/ui/Badge";

export const metadata = { title: "My tasks" };

interface TaskRow {
  id: string;
  lane: TaskLane;
  title: string;
  record: string;
  outcome: string;
  href: string;
  status?: string;
}

function TaskRows({ rows }: { rows: TaskRow[] }) {
  return <ul className="action-list">{rows.map(row => (
    <li key={row.id}>
      <Link className="action-row" href={row.href}>
        <div>
          <span className="code-tag">{row.record}</span>
          <strong className="action-title">{row.title}</strong>
          <p className="action-outcome">{row.outcome}</p>
          {row.status && <span className="small muted">{row.status}</span>}
        </div>
        <CaretRight size={18} aria-hidden />
      </Link>
    </li>
  ))}</ul>;
}

export default async function MyTasksPage() {
  const { db, actor } = await session();
  const now = Date.now();
  const [visits, pending, plans, approvals, reports, drafts] = await Promise.all([
    myTasks(db, actor, now), myPending(db, actor, now), sitePlans(db, actor),
    actor.role !== "employee" ? loadApprovals(db, actor, now) : Promise.resolve(null),
    reportsToDecide(db, actor),
    db.query<{ n: number }>("select count(*)::int n from time_entry where employee_id=$1 and is_current and state in ('draft','returned')", [actor.id]),
  ]);
  const [nextDispatches, regularizations, preventive, complaintSteps] = await Promise.all([
    (async () => {
      if (!pending.roles.some(role => ["factory", "factory_dispatch"].includes(role))) return [];
      const [scope, { def }] = await Promise.all([flowFilter(db, actor, "p", 1), loadDefinition(db, "dispatch")]);
      if (!pending.roles.includes(def.stages[0]!.owner)) return [];
      return db.query<{ id: string; business_id: string; order_id: string }>(`select d.id,d.business_id,d.order_id from dispatch d join sales_order o on o.id=d.order_id join project p on p.id=d.project_id where d.status='completed' and d.replacement_for is null and o.status not in ('closed','cancelled') and ${scope.sql} and not exists(select 1 from dispatch n where n.order_id=d.order_id and n.sequence_no>d.sequence_no and n.replacement_for is null and n.status<>'cancelled')`, scope.params);
    })(),
    db.query<{ plan_id: string }>("select distinct plan_id from plan_regularization where state='pending' and requested_by<>$1", [actor.id]),
    db.query<{ id: string; business_id: string; preventive_state: string; description: string; owner_id: string }>("select id,business_id,preventive_state,description,owner_id from issue where preventive_state in ('open','in_progress','done') and (owner_id=$1 or (preventive_state='done' and owner_id<>$1 and $2::boolean))", [actor.id, pending.roles.includes("qa")]),
    db.query<{ id: string; self_costed: boolean; handler: string }>(`select k.id,k.costed_by=$1 self_costed,s->>'handler' handler from complaint k join flow_config f on f.flow='complaint' and f.version=k.config_version cross join lateral jsonb_array_elements(f.definition->'stages') s where k.id=any($2::uuid[]) and s->>'code'=k.stage`, [actor.id, pending.items.filter(i => i.type === "complaint").map(i => i.id)]),
  ]);
  const rows: TaskRow[] = [];
  for (const q of sortQueues(approvals?.queues ?? [])) {
    if (q.mine > 0) rows.push({ id: `approval:${q.id}`, lane: "action", title: `Open ${q.title.toLowerCase()} for review`, record: `${q.mine} awaiting your review`, outcome: "Review the supporting details, then approve or return eligible requests on the next screen.", href: `/approvals#${q.id}` });
    if (q.items > q.mine) rows.push({ id: `approval-wait:${q.id}`, lane: "waiting", title: `View ${q.title.toLowerCase()}`, record: `${q.items - q.mine} awaiting another person`, outcome: "These records are visible to you but need another person's decision or information. Open the queue to see who is responsible.", href: `/approvals#${q.id}` });
  }
  for (const report of reports) rows.push({ id: `report:${report.id}`, lane: "action", title: "Open site report for confirmation", record: `${report.dispatch} · ${report.project}`, outcome: `Review ${report.quantity} × ${report.item} reported ${report.kind} by ${report.reporter}. Confirm or reject the report on the next screen.`, href: `/dispatch/${report.dispatch_id}#site-reports` });
  for (const item of pending.items) {
    const complaintStep = complaintSteps.find(step => step.id === item.id);
    const selfApproval = complaintStep?.handler === "approve_cost" && complaintStep.self_costed;
    const replacementWait = complaintStep?.handler === "await_replacement";
    rows.push({
    id: `${item.type}:${item.id}`, lane: item.hold_until || selfApproval || replacementWait ? "waiting" : "action",
    title: selfApproval ? "View complaint awaiting another approver" : replacementWait ? "View replacement progress" : item.hold_until ? "View dispatch hold" : `Open ${item.stage_label.toLowerCase()}`,
    record: `${item.business_id} · ${item.project}`,
    outcome: selfApproval ? "You recorded this cost, so another authorized person must approve it. Open the record to review its status." : replacementWait ? "Waiting for the replacement delivery and required installation checks. Open the record to track progress." : item.hold_until ? `Site readiness is on hold until ${item.hold_until}. Open the record to review readiness and update the hold if your role permits.` : `Your ${item.owner_name} role handles this step. Open the record to review its requirements and available actions.`,
    href: item.type === "dispatch" ? `/dispatch/${item.id}` : `/dispatch/complaints/${item.id}`,
    status: `${item.order} · ${item.customer} · ${item.title} · ${item.days_in_stage === 0 ? "Entered this step today" : `${item.days_in_stage} days in this step`}${item.overdue ? " · Overdue" : ""}${item.open_complaints ? ` · ${item.open_complaints} open complaints` : ""}${item.partial ? " · Partial delivery" : ""}`,
  });
  }
  for (const plan of plans) {
    const reviewRegularization = plan.operations_state === "active" && regularizations.some(r => r.plan_id === plan.id) && pending.roles.includes(plan.operations_policy.regularizationApprover);
    const lane = planLane(plan, actor.id, pending.roles, reviewRegularization);
    if (!lane) continue;
    const title = reviewRegularization ? "Open day-exclusion requests" : plan.operations_state === "pending_approval" ? lane === "action" ? "Open site plan for approval" : "View submitted site plan" : plan.operations_state === "draft" ? "Continue site plan" : plan.operations_state === "completed" ? "Review completed plan hours" : "View active site plan";
    const outcome = reviewRegularization ? "Review the requested exclusions and supporting reasons before deciding." : plan.operations_state === "pending_approval" ? lane === "action" ? "Review the team, dates and planned hours before making a decision." : "Another approver must review your plan. Open it to check its status." : plan.operations_state === "draft" ? "Open the draft to review dates, staffing and planned hours before submitting it." : plan.operations_state === "completed" ? "Review recorded punches and exclusions. Hours can be confirmed only after the checks pass." : "The team is carrying out this plan. Open it to monitor punches, progress and exceptions.";
    rows.push({ id: `plan:${plan.id}`, lane, title, outcome, record: `${plan.business_id} · ${plan.project}`, href: `/site-plans/${plan.id}`, status: PLAN_LABELS[plan.operations_state] });
  }
  for (const issue of preventive) {
    const waiting = issue.preventive_state === "done" && issue.owner_id === actor.id;
    rows.push({ id: `preventive:${issue.id}`, lane: waiting ? "waiting" : "action", title: waiting ? "View action awaiting QA" : issue.preventive_state === "done" ? "Open preventive action for verification" : "Open your preventive action", record: issue.business_id, outcome: `${issue.description}. ${waiting ? "Independent QA verification is still required." : issue.preventive_state === "done" ? "Review the completion evidence before verifying." : "Review the assigned steps and record your progress on the next screen."}`, href: `/preventive-actions/${issue.id}`, status: issue.preventive_state.replaceAll("_", " ") });
  }
  for (const dispatch of nextDispatches) rows.push({ id: `next:${dispatch.id}`, lane: "action", title: "Open next dispatch packaging", record: dispatch.business_id, outcome: "Installation is complete. Open a new dispatch form for this order to prepare the next delivery.", href: `/dispatch/new?order=${dispatch.order_id}` });
  if ((drafts[0]?.n ?? 0) > 0) rows.push({ id: "time-drafts", lane: "action", title: "Review your time entries", record: `${drafts[0]!.n} draft or returned entries`, outcome: "Open Timesheets to correct entries and submit them for review.", href: "/timesheets" });
  for (const visit of visits) {
    const lane = visitLane(visit, now);
    const active = lane === "action";
    rows.push({ id: `visit:${visit.id}`, lane, title: active ? "Open active visit" : lane === "upcoming" ? "View upcoming visit" : "View visit status", record: `${visit.business_id} · ${visit.project}`, outcome: active ? "Open this visit’s execution page to review its progress, readiness and available controls. Use My day for your daily recording tools." : visit.state === "held" ? "Your place is held, but the booking is not confirmed. Open the visit to check staffing and readiness." : lane === "upcoming" ? "Review the site, timing and assigned scope before the visit begins." : "This visit is not currently open for progress recording. Open it to check the status and readiness.", href: `/visits/${visit.id}?step=execution`, status: `${visit.site_address} · ${when(visit.start)} to ${when(visit.end)}` });
  }
  const action = rows.filter(r => r.lane === "action");
  const fieldCrew = actor.role === "employee" && actor.jobRole !== "department_staff";
  const first = action[0];
  const next = first ?? (fieldCrew ? { title: "Open attendance", outcome: "Open your clock-in and clock-out controls in My day. Nothing is recorded until you use those controls.", href: "/my-day#attendance" } : { title: "Open your overview", outcome: "No actions are listed for you here. Open the overview to review progress and the wider work queues.", href: "/?overview=1" });
  return (
    <div className="personal-home stack" style={{ gap: 24, maxWidth: 920, width: "100%" }}>
      <header className="personal-intro">
        <span className="section-label">Your workspace</span>
        <h1>My tasks</h1>
        <p>{actor.name} <span className="muted">· {actor.jobRole.replaceAll("_", " ")} · {actor.businessId}</span></p>
      </header>
      <section className="plate next-action" aria-labelledby="h-next-action">
        <span className="section-label">{first ? "Start here" : fieldCrew ? "Your daily controls" : "No listed actions"}</span>
        <h2 id="h-next-action">{next.title}</h2>
        {first && <p className="code-tag">{first.record}</p>}
        <p>{next.outcome}</p>
        <Link className="button primary" href={next.href}>{next.title}<CaretRight size={18} aria-hidden /></Link>
      </section>
      <nav className="quick-tools" aria-label="Your work shortcuts">
        <Link href="/my-day">Open My day</Link>
        <Link href="/timesheets">My time entries</Link>
        <Link href="/requests">My requests</Link>
        {actor.role !== "employee" && <Link href="/approvals">Approval queues</Link>}
        <Link href="/?overview=1">Full overview</Link>
      </nav>
      {([ ["action", "Needs your action", "Open an item to review it. Changes are made only when you submit a form or confirm an action."], ["waiting", "Waiting for others or readiness", "Track held work, active plans and records that need another person's input."], ["upcoming", "Upcoming visits", "Review your confirmed future bookings before work begins."] ] as const).map(([lane, title, description]) => {
        const items = rows.filter(r => r.lane === lane);
        if (lane === "upcoming" && !fieldCrew && items.length === 0) return null;
        return <section key={lane} className="plate" aria-labelledby={`h-queue-${lane}`}>
          <div className="queue-heading"><h2 id={`h-queue-${lane}`}>{title}</h2><span className="code-tag">{items.length} {items.length === 1 ? "item" : "items"}</span></div>
          {items.length ? <><p className="small muted">{description}</p><TaskRows rows={items} /></> : <p className="muted">{lane === "action" ? "No actions are listed for you right now. Your daily controls and other tools remain available above." : lane === "waiting" ? "No waiting items in your queue." : "No upcoming visits assigned to you."}</p>}
        </section>;
      })}
      {visits.length > 0 && <section className="plate" aria-labelledby="h-assigned-scope">
        <h2 id="h-assigned-scope">Assigned visit scope</h2>
        <p className="small muted">Expand a visit to see accepted quantities and remaining work.</p>
        {visits.map(v => <details key={v.id}>
          <summary>{v.business_id} · {v.project} · {v.tasks.length} tasks</summary>
          <p className="small muted">{v.site_address} · {when(v.start)} to {when(v.end)}</p>
          <Badge state={v.state === "held" ? "held" : v.exec_status} />
          {v.tasks.length === 0 ? <p className="small muted">No scope committed yet.</p> : <ul className="task-list">{v.tasks.map(t => {
            const percent = t.scoped ? Math.min(100, Math.round(t.accepted / t.scoped * 100)) : 0;
            return <li className="task-row" key={t.id}><span className="code-tag">{t.task}</span>{t.kind !== "original" && <Badge state="provisional" label={t.kind === "additional" ? "Additional scope" : "Rework"} />}<div className="callout-title">{t.component} · {t.activity}</div><div className="small muted">{qty(t.accepted)} of {qty(t.scoped)} {t.unit} accepted · {qty(Math.max(0, t.scoped - t.accepted))} remaining</div><div className="meter" role="img" aria-label={`${percent}% done`}><span style={{ transform: `scaleX(${percent / 100})` }} /></div></li>;
          })}</ul>}
        </details>)}
      </section>}
    </div>
  );
}
