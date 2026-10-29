/**
 * The visit's work plan for heads: tasks over actual dates, their people and each day's checklist. A task is
 * "worker reported complete" only when every item on every date is ticked; one finished day does not finish it.
 * Dates outside the visit's planned dates are flagged, not silently absorbed.
 */
import type { WorkTask } from "@/server/queries/site-ops";
import { shortDate } from "@/domain/install-schedule";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Notice";
import { CancelTask, MoveItem, NewTaskForm, TaskAssignees } from "./WorkForms";

export function WorkPlanSection({ visitId, plan, team, today, canManage }: {
  visitId: string; plan: { plannedStart: string | null; plannedEnd: string | null; tasks: WorkTask[] }; team: Array<{ id: string; name: string }>; today: string; canManage: boolean;
}) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      {plan.tasks.length === 0 && <Empty>No tasks planned yet.{canManage ? " Break the work into dated tasks below." : ""}</Empty>}
      {plan.tasks.map((t) => {
        const done = t.items.filter((i) => i.done_at !== null).length;
        const late = t.items.filter((i) => i.done_at === null && i.item_date < today).length;
        const dates = [...new Set(t.items.map((i) => i.item_date))];
        const state = t.status === "cancelled" ? <Badge state="cancelled" label="Cancelled" />
          : t.items.length && done === t.items.length ? <Badge state="completed" label="Worker reported complete" />
          : late ? <Badge state="fail" tone="bad" label={`${late} item${late === 1 ? "" : "s"} overdue`} />
          : <Badge state="in_progress" label={`${done} of ${t.items.length} ticked`} />;
        return (
          <article key={t.id} className="task-plan" aria-labelledby={`wt-${t.id}`}>
            <div className="spread"><h3 id={`wt-${t.id}`} style={{ margin: 0, fontSize: 16 }}>{t.title}</h3>{state}</div>
            <div className="small muted">{shortDate(t.start_date)} to {shortDate(t.due_date)} · {t.assignees.length ? t.assignees.map((a) => a.name).join(", ") : "Nobody assigned"}{t.description ? ` · ${t.description}` : ""}</div>
            {t.outsidePlan && <p className="notice" data-tone="warn" style={{ margin: 0 }}>Outside the visit&apos;s planned dates{plan.plannedStart && plan.plannedEnd ? ` (${shortDate(plan.plannedStart)} to ${shortDate(plan.plannedEnd)})` : ""}.</p>}
            {t.items.length > 0 && (
              <details>
                <summary className="small">Daily checklist ({dates.length} day{dates.length === 1 ? "" : "s"})</summary>
                <ul className="item-days" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                  {t.items.map((i) => (
                    <li key={i.id}>
                      <span><span className="code">{shortDate(i.item_date)}</span> {i.text}{i.original_date !== i.item_date ? <span className="muted"> · planned {shortDate(i.original_date)}</span> : null}</span>
                      <span>
                        {i.done_at !== null ? <span style={{ color: "var(--ok)" }}>Reported by {i.done_by ?? "team"}</span> : i.item_date < today ? <strong style={{ color: "var(--signal)" }}>Not done</strong> : <span className="muted">Open</span>}
                        {canManage && t.status === "open" && i.done_at === null && <> <MoveItem itemId={i.id} version={i.version} min={t.start_date} max={t.due_date} date={i.item_date} /></>}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {canManage && t.status === "open" && <div className="row" style={{ gap: 16, flexWrap: "wrap" }}><TaskAssignees taskId={t.id} version={t.version} team={team} current={t.assignees.map((a) => a.id)} /><CancelTask taskId={t.id} version={t.version} /></div>}
          </article>
        );
      })}
      {canManage && <NewTaskForm visitId={visitId} team={team} plannedStart={plan.plannedStart} plannedEnd={plan.plannedEnd} today={today} />}
      <p className="small muted" style={{ margin: "8px 0 0" }}>Checklist items are shared by the task&apos;s team: one tick counts once. Ticks are worker reports; quantities are still accepted and the customer still signs off on the visit itself.</p>
    </div>
  );
}
