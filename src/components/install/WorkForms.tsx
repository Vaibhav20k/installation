"use client";
/**
 * Work plan and checklist controls. Managers add dated tasks (a checklist line repeats on each task date) and
 * move unfinished items within a task; workers tick their items. Ticks are "worker reported": acceptance of
 * quantities and the customer's sign-off stay on the visit's own steps. Typed drafts survive a failed save.
 */
import { useState } from "react";
import { setWorkItemDone, createWorkTask, rescheduleWorkItem, updateWorkTask } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { shortDate } from "@/domain/install-schedule";

export function NewTaskForm({ visitId, team, plannedStart, plannedEnd, today }: { visitId: string; team: Array<{ id: string; name: string }>; plannedStart: string | null; plannedEnd: string | null; today: string }) {
  const create = useAction(createWorkTask);
  // Starts from today inside the plan (never a past day by default); the manager sets the real dates.
  const first = plannedStart && plannedStart > today ? plannedStart : today;
  const [start, setStart] = useState(first);
  const [due, setDue] = useState(first);
  const outside = !!(plannedStart && plannedEnd && start && due && (start < plannedStart || due > plannedEnd));
  return (
    <details>
      <summary className="button">Add a task</summary>
      <form className="form" style={{ marginTop: 10 }} onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        create.run({ visitId, title: String(f.get("t")), description: String(f.get("d") || "") || undefined, startDate: start, dueDate: due,
          assigneeIds: f.getAll("a").map(String), checklist: String(f.get("c") || "").split("\n").map((x) => x.trim()).filter(Boolean) });
      }}>
        <div className="field"><label htmlFor="wt-t">Task</label><input id="wt-t" name="t" required minLength={3} maxLength={120} placeholder="e.g. Base cabinet installation" /></div>
        <div className="field"><label htmlFor="wt-d">Details (optional)</label><textarea id="wt-d" name="d" rows={2} maxLength={1000} /></div>
        <div className="fields">
          <div className="field"><label htmlFor="wt-s">Start</label><input id="wt-s" type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></div>
          <div className="field"><label htmlFor="wt-e">Due</label><input id="wt-e" type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} required /></div>
        </div>
        {outside && <p className="notice" data-tone="warn" role="status" style={{ margin: 0 }}>These dates fall outside the visit&apos;s planned {shortDate(plannedStart!)} to {shortDate(plannedEnd!)}. The plan is not extended; change the visit dates separately if the work really runs longer.</p>}
        {!plannedStart && <p className="small muted" style={{ margin: 0 }}>This visit has no planned dates yet.</p>}
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small">Assigned to (people on this visit)</legend>
          {team.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nobody is on the team yet; you can assign people later.</p> : (
            <div className="row" style={{ flexWrap: "wrap", gap: "6px 14px" }}>{team.map((m) => <label key={m.id} className="small"><input type="checkbox" name="a" value={m.id} /> {m.name}</label>)}</div>
          )}
        </fieldset>
        <div className="field"><label htmlFor="wt-c">Daily checklist, one item per line (repeated on each date)</label><textarea id="wt-c" name="c" rows={3} maxLength={2400} /></div>
        <button type="submit" className="primary" disabled={create.pending}>{create.pending ? "Saving…" : "Save task"}</button>
        <ResultNotice result={create.result} successText="Task added to the plan." />
      </form>
    </details>
  );
}

export function TaskAssignees({ taskId, version, team, current }: { taskId: string; version: number; team: Array<{ id: string; name: string }>; current: string[] }) {
  const save = useAction(updateWorkTask);
  return (
    <details>
      <summary className="small">Change who is assigned</summary>
      <form className="stack" style={{ gap: 8, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); save.run({ taskId, version, assigneeIds: f.getAll("a").map(String), reason: String(f.get("r")) }); }}>
        <div className="row" style={{ flexWrap: "wrap", gap: "6px 14px" }}>{team.map((m) => <label key={m.id} className="small"><input type="checkbox" name="a" value={m.id} defaultChecked={current.includes(m.id)} /> {m.name}</label>)}</div>
        <div className="field"><label htmlFor={`ta-${taskId}`}>Reason</label><input id={`ta-${taskId}`} name="r" required minLength={3} maxLength={300} /></div>
        <button type="submit" disabled={save.pending}>Save</button>
        <ResultNotice result={save.result} />
      </form>
    </details>
  );
}

export function CancelTask({ taskId, version }: { taskId: string; version: number }) {
  const save = useAction(updateWorkTask);
  const [reason, setReason] = useState("");
  return (
    <details>
      <summary className="small">Cancel this task</summary>
      <form className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); save.run({ taskId, version, cancelled: true, reason }); }}>
        <label className="sr-only" htmlFor={`tc-${taskId}`}>Reason</label>
        <input id={`tc-${taskId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" required minLength={3} maxLength={300} />
        <button type="submit" className="danger" disabled={save.pending}>Cancel task</button>
      </form>
      <ResultNotice result={save.result} successText="Task cancelled. Its history stays." />
    </details>
  );
}

export function MoveItem({ itemId, version, min, max, date }: { itemId: string; version: number; min: string; max: string; date: string }) {
  const move = useAction(rescheduleWorkItem);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="link small" onClick={() => setOpen(true)}>Move</button>;
  return (
    <form className="row" style={{ gap: 6, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); move.run({ itemId, version, date: String(f.get("d")), reason: String(f.get("r")) }); }}>
      <label className="sr-only" htmlFor={`mv-${itemId}`}>New date</label>
      <input id={`mv-${itemId}`} name="d" type="date" min={min} max={max} defaultValue={date} required />
      <label className="sr-only" htmlFor={`mr-${itemId}`}>Reason</label>
      <input id={`mr-${itemId}`} name="r" placeholder="Reason" required minLength={3} maxLength={300} />
      <button type="submit" disabled={move.pending}>Move</button>
      <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      <ResultNotice result={move.result} successText="Moved. The original date is kept." />
    </form>
  );
}

export interface CheckItem { id: string; text: string; title: string; visit: string; item_date: string; original_date: string; done_at: number | null; done_by: string | null; shared: number }

/** One checklist row. Unticking asks why, so a correction keeps its reason. */
export function CheckRow({ item, overdue }: { item: CheckItem; overdue?: boolean }) {
  const tick = useAction(setWorkItemDone);
  const [why, setWhy] = useState<string | null>(null);
  const done = item.done_at !== null;
  const id = `ci-${item.id}`;
  return (
    <li className="check-item" data-done={done || undefined}>
      <input id={id} type="checkbox" checked={done} disabled={tick.pending} aria-describedby={`${id}-m`}
        onChange={(e) => (e.target.checked ? tick.run({ itemId: item.id, done: true }) : setWhy(""))} />
      <div className="stack" style={{ gap: 4 }}>
        <label htmlFor={id}><span>{item.text}</span></label>
        <span id={`${id}-m`} className="small muted">
          {item.title} · {item.visit}{item.shared > 1 ? ` · shared with ${item.shared - 1} other${item.shared > 2 ? "s" : ""}` : ""}
          {overdue && (done ? ` · planned for ${shortDate(item.item_date)}` : <strong style={{ color: "var(--signal)" }}> · not done on {shortDate(item.item_date)}</strong>)}
          {item.original_date !== item.item_date && ` · moved from ${shortDate(item.original_date)}`}
          {done && ` · reported done by ${item.done_by ?? "a team member"}`}
        </span>
        {why !== null && (
          <form className="row" style={{ gap: 6, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); tick.run({ itemId: item.id, done: false, reason: why }); setWhy(null); }}>
            <label className="sr-only" htmlFor={`${id}-w`}>Why is it not done?</label>
            <input id={`${id}-w`} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why is it not done?" required minLength={3} maxLength={300} autoFocus />
            <button type="submit">Untick</button>
            <button type="button" onClick={() => setWhy(null)}>Keep ticked</button>
          </form>
        )}
        <ResultNotice result={tick.result} successText={done ? "Reported done." : "Marked not done."} />
      </div>
    </li>
  );
}
