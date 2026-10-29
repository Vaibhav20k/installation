import Link from "next/link";
import { CaretLeft, MapPin } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { installationDetail, teamCandidates } from "@/server/queries/installations";
import { dayDiff, localDateOf, weekday } from "@/lib/dates";
import { TZ, qty } from "@/lib/format";
import { customerText, shortDate } from "@/domain/install-schedule";
import { Badge } from "@/components/ui/Badge";
import { Empty, Notice } from "@/components/ui/Notice";
import { ApplySchedule, CustomerCopy, DayControls } from "@/components/install/ScheduleControls";
import { TeamManager } from "@/components/install/TeamManager";
import { HandoverFlag } from "@/components/install/HandoverFlag";
import { MidnightRefresh } from "@/components/install/MidnightRefresh";
import { SiteWorkforce } from "@/components/install/SiteWorkforce";
import { WorkPlanSection } from "@/components/install/WorkPlanSection";
import { siteWorkforce, workPlan } from "@/server/queries/site-ops";
import { handoverState } from "@/domain/handover";

export const metadata = { title: "Installation progress" };

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function InstallationDetail({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const { db, actor } = await session();
  if (actor.role === "employee") return <Notice tone="warn" title="Not permitted">Installation progress is for supervisors, managers and administrators.</Notice>;
  if (!/^[0-9a-f-]{36}$/i.test(visitId)) return <Notice tone="warn" title="Not found">That installation does not exist.</Notice>;
  const today = localDateOf(Date.now(), TZ);
  const { row: r, days, tasks, templates } = await installationDetail(db, actor, visitId, today);
  const work = days.filter((d) => d.kind === "work");
  const pct = work.length ? Math.round((r.done_days / work.length) * 100) : 0;
  const qtyPct = r.scoped ? Math.round((r.accepted / r.scoped) * 100) : 0;
  const start = r.schedule_start ?? r.planned_start, end = r.schedule_end ?? r.planned_end;
  const customerName = r.customer_name.replace(/^Demo Customer /, "");
  const editable = !["completed", "closed", "cancelled"].includes(r.exec_status);
  const canManage = (actor.role === "manager" || actor.role === "admin") && editable;
  const started = days.some((d) => d.status !== "planned");
  const [workforce, plan] = await Promise.all([siteWorkforce(db, actor, r.visit_id, Date.now()), workPlan(db, actor, r.visit_id)]);
  const siteToday = localDateOf(Date.now(), r.timezone);
  const team = r.team.filter((m) => Date.parse(m.until) > Date.now()).map((m) => ({ id: m.id, name: m.name }));
  const outside = !!(r.schedule_end && r.planned_end && r.schedule_end > r.planned_end) || !!(r.schedule_start && r.planned_start && r.schedule_start < r.planned_start);
  return (
    <>
      <Link className="back-link no-print" href="/installations"><CaretLeft size={16} aria-hidden /> All installations</Link>
      <section className="plate" aria-labelledby="h-site">
        <div className="plate-head">
          <span className="code-tag"><span className="nw">{r.customer}</span> · <span className="nw">{r.project}</span> · <span className="nw">{r.visit}</span></span>
          {r.behind_days > 0 ? <Badge state="fail" tone="bad" label={`Behind ${r.behind_days} day${r.behind_days > 1 ? "s" : ""}`} className="stamp-hero stamp-press" /> : <Badge state={r.exec_status} className="stamp-hero stamp-press" />}
        </div>
        <MidnightRefresh tz={r.timezone} />
        <HandoverFlag state={handoverState(r, Date.now())} />
        <h1 id="h-site" className="plate-title">{customerName}</h1>
        <p className="plate-sub" style={{ display: "flex", gap: 6, alignItems: "center" }}><MapPin size={16} aria-hidden /> {r.project_name}, {r.site_address}</p>
        <div className="progress-hero">
          <div><span className="progress-figure">{work.length ? pct : qtyPct}<small>%</small></span><span className="small muted">{work.length ? `${r.done_days} of ${work.length} schedule days done` : "of scoped quantity accepted"}</span></div>
          <div className="meter meter-lg" role="img" aria-label={`${work.length ? pct : qtyPct}% complete`}><span style={{ transform: `scaleX(${(work.length ? pct : qtyPct) / 100})` }} /></div>
        </div>
        <ul className="spec">
          <SpecRow label="Orders" value={r.orders.map((o) => `${o.business_id} ${o.product}`).join(", ") || "None linked"} />
          <SpecRow label="Plan" value={work.length ? `${work.length} working days` : start && end ? `${dayDiff(start, end) + 1} day${dayDiff(start, end) === 0 ? "" : "s"}` : "Not dated"} sub={start && end ? `${shortDate(start)} to ${shortDate(end)}${work.length ? `, ${dayDiff(start, end) + 1} calendar days` : ""}` : undefined} />
          <SpecRow label="Today" value={r.today_step ?? (start && today < start ? `Starts ${shortDate(start)}` : "Nothing scheduled")} />
          <SpecRow label="Behind" value={r.behind_days ? `${r.behind_days} day${r.behind_days > 1 ? "s" : ""}` : "On schedule"} tone={r.behind_days ? "bad" : undefined} />
          {r.scoped > 0 && <SpecRow label="Work accepted" value={`${qtyPct}%`} sub="quantity recorded and accepted on site" />}
          <SpecRow label="Manager" value={r.manager ?? "Not set"} />
        </ul>
      </section>

      <div className="grid cols-2">
        <section className="plate" aria-labelledby="h-team">
          <div className="plate-head"><h2 id="h-team" style={{ margin: 0 }}>Team</h2><span className="code-tag">{r.team.filter((m) => Date.parse(m.until) > Date.now()).length} people</span></div>
          <TeamManager visitId={r.visit_id} team={r.team} candidates={canManage ? await teamCandidates(db, r.visit_id, Date.now()) : []} canManage={canManage}
            booked={["scheduled", "in_progress", "on_hold"].includes(r.exec_status)} />
        </section>

        <section className="plate" aria-labelledby="h-work">
          <div className="plate-head"><h2 id="h-work" style={{ margin: 0 }}>Work on site</h2><Link className="code-tag" href={`/visits/${r.visit_id}`}>Open visit</Link></div>
          {tasks.length === 0 ? <Empty>No scope committed to this visit yet.</Empty> : (
            <ul className="task-list">
              {tasks.map((t) => {
                const p = t.scoped ? Math.min(100, Math.round((t.accepted / t.scoped) * 100)) : 0;
                return (
                  <li key={t.id} className="task-row">
                    <span className="code-tag">{t.task}</span>
                    <div className="callout-title" style={{ marginTop: 4 }}>{t.component} · {t.activity}</div>
                    <div className="small muted">{qty(t.accepted)} of {qty(t.scoped)} {t.unit} accepted</div>
                    <div className="meter" role="img" aria-label={`${p}% done`}><span style={{ transform: `scaleX(${p / 100})` }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="plate" aria-labelledby="h-wf">
        <div className="plate-head"><h2 id="h-wf" style={{ margin: 0 }}>Site workforce</h2><span className="code-tag">planned and recorded</span></div>
        <SiteWorkforce data={workforce} visitId={r.visit_id} canCorrect actorId={actor.id} />
      </section>

      <section className="plate" aria-labelledby="h-plan">
        <div className="plate-head"><h2 id="h-plan" style={{ margin: 0 }}>Work plan</h2><span className="code-tag">{plan.tasks.filter((t) => t.status === "open").length} tasks</span></div>
        <WorkPlanSection visitId={r.visit_id} plan={plan} team={team} today={siteToday} canManage={canManage} />
      </section>

      <section className="plate" aria-labelledby="h-sched">
        <div className="plate-head"><h2 id="h-sched" style={{ margin: 0 }}>Customer schedule</h2><span className="code-tag">{r.template ?? "not laid out"}</span></div>
        {outside && <Notice tone="warn" title="Schedule and booking differ">The team is booked {r.planned_start ? shortDate(r.planned_start) : "?"} to {r.planned_end ? shortDate(r.planned_end) : "?"}, but the customer schedule runs {shortDate(r.schedule_start!)} to {shortDate(r.schedule_end!)}. Rebook the team or lay the schedule out again.</Notice>}
        {days.length === 0 ? (
          editable ? <ApplySchedule visitId={r.visit_id} templates={templates} defaultStart={r.planned_start ?? today} replacing={false} /> : <Empty>No customer schedule for this visit.</Empty>
        ) : (
          <>
            <ol className="schedule">
              {days.map((d) => {
                const isToday = d.day_date === today;
                const behind = d.kind === "work" && d.status !== "done" && d.day_date < today;
                return (
                  <li key={d.id} className="sched-day" data-kind={d.kind} data-status={d.status} data-today={isToday || undefined} aria-current={isToday ? "date" : undefined}>
                    <span className="sched-date"><span className="code">{shortDate(d.day_date)}</span><span className="small muted">{WD[weekday(d.day_date)]}</span></span>
                    <span className="sched-body">
                      {d.kind === "off" ? <span className="muted">{d.off_reason === "Weekly off" ? "Weekly off" : `Off: ${d.off_reason}`}</span> : (
                        <>
                          <span className="sched-step"><span className="code">{String(d.step_no).padStart(2, "0")}</span> {d.step_name}</span>
                          {d.note && <span className="small muted">{d.note}</span>}
                          {d.status !== "planned" && d.updated_by && <span className="small muted">Marked by {d.updated_by}</span>}
                        </>
                      )}
                    </span>
                    <span className="sched-state">
                      {d.kind === "work" && (d.status === "done" ? <Badge state="completed" label="Done" /> : d.status === "delayed" ? <Badge state="fail" tone="bad" label="Slipped" /> : behind ? <Badge state="fail" tone="bad" label="Not ticked" /> : isToday ? <Badge state="in_progress" label="Today" /> : null)}
                      {d.kind === "work" && editable && (d.day_date <= today) && <DayControls dayId={d.id} status={d.status} />}
                    </span>
                  </li>
                );
              })}
            </ol>
            <details className="customer-share">
              <summary className="button">Share with the customer</summary>
              <CustomerCopy text={customerText(`${r.template ?? "Installation"} schedule, ${customerName}`, days.map((d) => ({ date: d.day_date, kind: d.kind, stepNo: d.step_no, stepName: d.step_name, offReason: d.off_reason })))} />
            </details>
            {editable && !started && (
              <details>
                <summary className="small">Change the start date or template</summary>
                <ApplySchedule visitId={r.visit_id} templates={templates} defaultStart={r.schedule_start ?? today} replacing />
              </details>
            )}
          </>
        )}
      </section>
    </>
  );
}

function SpecRow({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <li><div className="spec-row" style={{ gridTemplateColumns: "minmax(96px, auto) 1fr" }}>
      <span className="spec-label">{label}</span>
      <span style={{ textAlign: "right" }}><span className="spec-text" data-tone={tone}>{value}</span>{sub && <span className="small muted" style={{ display: "block" }}>{sub}</span>}</span>
    </div></li>
  );
}
