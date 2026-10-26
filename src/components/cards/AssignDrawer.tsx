"use client";
/**
 * "Assign plan" from a card: pick a visit, review its scope, team, skill coverage, availability and gates, add
 * people, then save a draft or confirm. The server re-runs every check (skills, leave, bookings, dates, approval,
 * clearance, capacity); this drawer only shows them early. A one-person draft never reads as a complete team.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { assignFromCard, cardAssignContext, cardAssignOptions } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { zonedToUtc } from "@/lib/dates";
import type { CardSummary, assignContext as contextQuery, assignOptions as optionsQuery } from "@/server/queries/skill-cards";
import { Drawer } from "./Drawer";
import { LEVEL_LABEL, roleLabel } from "./skill-meta";

type Options = Awaited<ReturnType<typeof optionsQuery>>;
type Context = Awaited<ReturnType<typeof contextQuery>>;
type Outcome = { status: "draft"; complete: boolean; openItems: string[] } | { status: "needs_approval"; revision: number; state: string } | { status: "confirmed"; confirmed: number } | { status: "joined"; added: number };

const fmt = (ms: number | null, tz: string) => (ms ? new Date(Number(ms)).toLocaleString("en-IN", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }) : "—");
const localInput = (ms: number | null, tz: string) => {
  if (!ms) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Number(ms)));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
};
const toIso = (v: string, tz: string) => (v ? new Date(zonedToUtc(v.slice(0, 10), v.slice(11, 16), tz)).toISOString() : null);

export function AssignDrawer({ card, onClose }: { card: CardSummary; onClose: () => void }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [visitId, setVisitId] = useState(card.current?.visit_id ?? "");
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => { void cardAssignOptions().then((r) => (r.ok ? setOptions(r.data as Options) : setError(r.message))); }, []);
  // A refresh after saving keeps the form (and its result message) on screen; choosing another visit clears it.
  const loadContext = useCallback(async (id: string, keep = false) => {
    if (!keep) setCtx(null);
    setError(null);
    if (!id) return;
    const r = await cardAssignContext({ employeeId: card.id, visitId: id });
    if (r.ok) setCtx(r.data as Context); else setError(r.message);
  }, [card.id]);
  useEffect(() => { void loadContext(visitId); }, [visitId, loadContext]);

  const byProject = useMemo(() => {
    const m = new Map<string, Options>();
    for (const o of options ?? []) m.set(o.project, [...(m.get(o.project) ?? []), o]);
    return [...m.entries()];
  }, [options]);

  return (
    <Drawer title={`Assign ${card.name}`} onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>{card.business_id} · {roleLabel(card.job_role)} · {card.base_city}. Assigning never changes attendance or recorded time.</p>
      <div className="field">
        <label htmlFor="as-visit">Project and visit</label>
        <select id="as-visit" value={visitId} onChange={(e) => setVisitId(e.target.value)} disabled={!options}>
          <option value="">{options ? "Choose a visit" : "Loading visits…"}</option>
          {byProject.map(([project, visits]) => (
            <optgroup key={project} label={project}>
              {visits.map((v) => <option key={v.visit_id} value={v.visit_id}>{v.visit} · {v.visit_type.replace("_", " ")} · {v.exec_status.replace("_", " ")} · {v.planned_start ?? "no dates"} · {v.staffed}/{v.team_size} staffed</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {error && <div className="notice" data-tone="bad" role="alert">{error}</div>}
      {visitId && !ctx && !error && <p className="small muted" role="status">Checking the visit…</p>}
      {ctx && <AssignForm key={ctx.visit.id} card={card} ctx={ctx} onDone={() => { void loadContext(visitId, true); router.refresh(); }} />}
    </Drawer>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <li data-ok={ok}>{ok ? <CheckCircle size={16} weight="fill" aria-hidden /> : <WarningCircle size={16} weight="fill" aria-hidden />}<span>{children}</span></li>;
}

function AssignForm({ card, ctx, onDone }: { card: CardSummary; ctx: Context; onDone: () => void }) {
  const v = ctx.visit, tz = v.timezone;
  const [extra, setExtra] = useState<string[]>([]);
  const [key] = useState(() => crypto.randomUUID());
  const a = useAction(assignFromCard, { onSuccess: () => onDone() });
  const outcome = a.result?.ok ? (a.result.data as Outcome) : null;
  // Already on this visit is fine (others can still be added); busy elsewhere or inactive blocks.
  const blocked = !!ctx.employee.busy && !ctx.employee.onTeam;
  const toggle = (id: string) => setExtra((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const planned = ctx.team.length + (ctx.employee.onTeam ? 0 : 1) + extra.length;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });

  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const mode = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "confirm" ? "confirm" : "draft";
      const base = { employeeId: card.id, visitId: v.id, extraIds: extra, mode: ctx.booked ? "confirm" : mode, reason: String(f.get("reason") ?? ""), idempotencyKey: key };
      a.run(ctx.booked
        ? { ...base, from: { date: String(f.get("fromDate")), time: String(f.get("fromTime")) } }
        : { ...base, dates: { plannedStart: String(f.get("start")), plannedEnd: String(f.get("end")), departureAt: toIso(String(f.get("dep") ?? ""), tz), returnAt: toIso(String(f.get("ret") ?? ""), tz) } });
    }}>
      <section className="assign-step" aria-labelledby="h-a1">
        <h3 id="h-a1" style={{ margin: 0 }}>{v.business_id} · {v.exec_status.replace("_", " ")}</h3>
        <p className="small" style={{ margin: 0 }}>Orders {v.orders.join(", ") || "none"} · plan revision {v.revision.no} ({v.revision.state}) · team size {v.team_size}{v.continuity !== "none" ? ` · continuity ${v.continuity}` : ""}</p>
        <ul className="assign-checks">
          <Check ok={!ctx.employee.busy || ctx.employee.onTeam}>{card.name}: {ctx.employee.busy ? ctx.employee.busy : "free for this visit's dates"}</Check>
          <Check ok={ctx.coverage.met}>{ctx.coverage.met ? "Current team meets the skill requirements" : `Team not complete yet: ${ctx.coverage.problems.slice(0, 3).join("; ")}${ctx.coverage.problems.length > 3 ? "…" : ""}`}</Check>
          <Check ok={ctx.gates.clearanceOk}>{ctx.gates.clearanceOk ? "Clearance allows firm booking" : `Clearance: ${ctx.gates.clearance.join("; ")}`}</Check>
          <Check ok={ctx.gates.readinessOk}>{ctx.gates.readinessOk ? "Readiness checks pass" : `Readiness (needed before work starts): ${ctx.gates.readiness.join("; ")}`}</Check>
          <Check ok={v.revision.state === "approved"}>{v.revision.state === "approved" ? "Plan approved" : v.revision.state === "submitted" ? `Plan revision ${v.revision.no} is awaiting review: staffing changes wait for the decision` : `Plan revision ${v.revision.no} is ${v.revision.state}; booking needs an approved plan`}</Check>
        </ul>
        {ctx.requirements.length > 0 && <p className="small muted" style={{ margin: 0 }}>Needs: {ctx.requirements.map((r) => `${r.headcount}× ${r.skill.replace(/_/g, " ")} ${LEVEL_LABEL[r.minLevel as 1 | 2 | 3]}+${r.mode === "per_person" ? " each" : ""}`).join(", ")}</p>}
        <details><summary className="small">Scope: {ctx.tasks.length} task{ctx.tasks.length === 1 ? "" : "s"}{ctx.legs.length ? ` · ${ctx.legs.length} travel leg${ctx.legs.length === 1 ? "" : "s"}` : ""}</summary>
          <ul className="history">
            {ctx.tasks.map((t) => <li key={t.id}><span>{t.task} · {t.component} · {t.activity}</span><time>{t.scoped} {t.unit}{t.depends_on ? ` · after ${t.depends_on} task${t.depends_on === 1 ? "" : "s"}` : ""}</time></li>)}
            {ctx.legs.map((l, i) => <li key={`l${i}`}><span>{l.kind.replace("_", " ")}: {l.origin} → {l.destination}</span><time>{fmt(l.depart, tz)} – {fmt(l.arrive, tz)} · {l.travellers} travelling</time></li>)}
          </ul>
          <p className="small"><Link href={`/visits/${v.id}`}>Open the visit</Link> to change scope, tasks or travel legs.</p>
        </details>
        {ctx.team.length > 0 && <p className="small" style={{ margin: 0 }}>On the team: {ctx.team.map((m) => `${m.name} (${m.state})`).join(", ")}</p>}
      </section>

      {ctx.booked ? (
        <div className="grid cols-2">
          <div className="field"><label htmlFor="as-fd">Starts on</label><input id="as-fd" name="fromDate" type="date" required defaultValue={v.planned_start && v.planned_start > today ? v.planned_start : today} /></div>
          <div className="field"><label htmlFor="as-ft">From</label><input id="as-ft" name="fromTime" type="time" required defaultValue="09:00" /></div>
        </div>
      ) : (
        <div className="grid cols-2">
          <div className="field"><label htmlFor="as-s">Work starts</label><input id="as-s" name="start" type="date" required defaultValue={v.planned_start ?? ""} /></div>
          <div className="field"><label htmlFor="as-e">Work ends</label><input id="as-e" name="end" type="date" required defaultValue={v.planned_end ?? ""} /></div>
          <div className="field"><label htmlFor="as-dp">Departure (optional)</label><input id="as-dp" name="dep" type="datetime-local" defaultValue={localInput(v.departure_at, tz)} /></div>
          <div className="field"><label htmlFor="as-rt">Return (optional)</label><input id="as-rt" name="ret" type="datetime-local" defaultValue={localInput(v.return_at, tz)} /></div>
        </div>
      )}

      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600 }}>Add others to complete the team ({planned} of {v.team_size} after this)</legend>
        <ul className="cand-list">
          {ctx.candidates.slice(0, 60).map((c) => (
            <li key={c.id}><label data-busy={c.busy ? "" : undefined}>
              <input type="checkbox" checked={extra.includes(c.id)} disabled={!!c.busy} onChange={() => toggle(c.id)} />
              <span>{c.name} · {roleLabel(c.job_role)}</span>
              <small>{c.busy ? `Unavailable: ${c.busy}` : c.skills || "No skill records"}</small>
            </label></li>
          ))}
        </ul>
      </fieldset>
      <div className="field"><label htmlFor="as-r">Reason</label><input id="as-r" name="reason" required minLength={3} maxLength={300} placeholder="For example: island needs a stone technician" /></div>
      <div className="row">
        {ctx.booked
          ? <button type="submit" className="primary" disabled={a.pending || blocked}>Add to booked visit</button>
          : <>
            <button type="submit" value="draft" disabled={a.pending || blocked}>Save draft</button>
            <button type="submit" value="confirm" className="primary" disabled={a.pending || blocked}>Confirm assignment</button>
          </>}
      </div>
      <ResultNotice result={a.result} successText={outcome ? outcomeText(outcome) : "Saved."} />
    </form>
  );
}

function outcomeText(o: Outcome) {
  if (o.status === "draft") return o.complete ? "Saved as a draft. The team is complete; confirm when ready." : `Saved as a draft. Not complete yet: ${o.openItems.join("; ")}.`;
  if (o.status === "needs_approval") return `Staffing saved in plan revision ${o.revision} (${o.state}). A different manager must approve it before it can be booked.`;
  if (o.status === "confirmed") return `Booked: ${o.confirmed} reservation${o.confirmed === 1 ? "" : "s"} confirmed.`;
  return `Added ${o.added} ${o.added === 1 ? "person" : "people"} to the booked visit.`;
}
