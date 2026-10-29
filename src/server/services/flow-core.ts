/**
 * Shared machinery for the dispatch and complaint flows: loading the versioned definition, department roles,
 * the append-only stage history, stage attachments, owner notifications and reminders. Each flow service
 * decides what a stage does; this module enforces "no skipping, back only with a reason, owner role only".
 */
import type { Db, Queryable } from "../db/client";
import { audit } from "../audit";
import { requireProjectScope, projectScopeSql, type Actor } from "../auth/permissions";
import { conflict, forbidden, notFound, validation } from "../errors";
import { checkDefinition, checkData, resolveMove, stageIndex, stageOf, zFlowDefinition, type FlowData, type FlowDefinition, type StageSpec } from "@/domain/flow";
import { DEFAULT_FLOWS } from "@/domain/flow-defaults";
import { addDays, startOfLocalDay } from "@/lib/dates";
import { iso, type Ctx } from "./context";

export type FlowName = "dispatch" | "complaint";
export type SubjectType = FlowName;

const TABLE: Record<SubjectType, string> = { dispatch: "dispatch", complaint: "complaint" };
export const HREF = (t: SubjectType, id: string) => (t === "dispatch" ? `/dispatch/${id}` : `/dispatch/complaints/${id}`);

/** The definition a record runs on: its pinned version, or the active one (version 1 is written on first use). */
export async function loadDefinition(q: Queryable, flow: FlowName, version?: number): Promise<{ def: FlowDefinition; version: number }> {
  if (version) {
    const [r] = await q.query<{ definition: FlowDefinition }>("select definition from flow_config where flow = $1 and version = $2", [flow, version]);
    if (!r) throw notFound(`Flow ${flow} version ${version}`);
    return { def: zFlowDefinition.parse(r.definition), version };
  }
  let [r] = await q.query<{ definition: FlowDefinition; version: number }>("select definition, version from flow_config where flow = $1 and active", [flow]);
  if (!r) {
    await q.query("insert into flow_config(flow, version, definition, active, note) values ($1, 1, $2, true, 'Initial version') on conflict do nothing", [flow, JSON.stringify(DEFAULT_FLOWS[flow])]);
    [r] = await q.query<{ definition: FlowDefinition; version: number }>("select definition, version from flow_config where flow = $1 and active", [flow]);
  }
  return { def: zFlowDefinition.parse(r!.definition), version: r!.version };
}

export async function roleCodes(q: Queryable) {
  return (await q.query<{ code: string }>("select code from flow_role order by sort")).map((r) => r.code);
}

export async function actorRoles(q: Queryable, actorId: string): Promise<string[]> {
  return (await q.query<{ role_code: string }>("select role_code from flow_role_member where employee_id = $1", [actorId])).map((r) => r.role_code);
}

/**
 * Who may see a flow record: administrators and any factory-side department see every order (their work is
 * cross-project); Installation Managers, managers and supervisors see their own projects.
 */
export async function flowVisibility(q: Queryable, actor: Actor): Promise<{ all: boolean; roles: string[] }> {
  const roles = await actorRoles(q, actor.id);
  return { all: actor.role === "admin" || roles.some((r) => r !== "installation_manager"), roles };
}

export async function requireFlowView(q: Queryable, actor: Actor, projectId: string) {
  const v = await flowVisibility(q, actor);
  if (v.all) return v;
  if (!v.roles.length && actor.role === "employee") throw forbidden("Dispatches and complaints are for department staff and installation managers.");
  await requireProjectScope(q, actor, projectId);
  return v;
}

/** Whether the actor's own scope (manager chain, Installation Manager) covers this project. */
async function inProjectScope(q: Queryable, actor: Actor, projectId: string) {
  if (actor.role === "employee") return false;
  try { await requireProjectScope(q, actor, projectId); return true; } catch { return false; }
}

/**
 * Least privilege inside the hub (break-it finding F1): complaint cost is for Planning, Management, admins and
 * the project's own managers; tax invoices and e-way bills (files on Accounts-owned steps) are for Accounts,
 * Factory / Dispatch, Management, admins and the project's managers. Seeing a record is not seeing its money.
 */
export async function canSeeCost(q: Queryable, actor: Actor, projectId: string | null) {
  const roles = await actorRoles(q, actor.id);
  if (actor.role === "admin" || roles.includes("management") || roles.includes("planning")) return true;
  return projectId ? inProjectScope(q, actor, projectId) : false;
}

export async function canSeeFinanceFiles(q: Queryable, actor: Actor, projectId: string) {
  const roles = await actorRoles(q, actor.id);
  if (actor.role === "admin" || roles.some((r) => r === "accounts" || r === "factory_dispatch" || r === "management")) return true;
  return inProjectScope(q, actor, projectId);
}

/** Read check for a stage attachment: the record must be visible, and finance files need the finance right. */
export async function requireStageFileView(q: Queryable, actor: Actor, historyId: string) {
  const [h] = await q.query<{ subject_type: SubjectType; from_stage: string | null; project_id: string | null; config_version: number | null }>(
    `select h.subject_type, h.from_stage, coalesce(d.project_id, c.project_id) project_id, coalesce(d.config_version, c.config_version) config_version
     from stage_history h left join dispatch d on h.subject_type = 'dispatch' and d.id = h.subject_id
     left join complaint c on h.subject_type = 'complaint' and c.id = h.subject_id where h.id = $1`, [historyId]);
  if (!h?.project_id) throw notFound("Record");
  await requireFlowView(q, actor, h.project_id);
  if (await isFinanceStage(q, h.subject_type, h.config_version, h.from_stage) && !(await canSeeFinanceFiles(q, actor, h.project_id))) {
    throw forbidden("Tax invoices and e-way bills are for Accounts, Factory / Dispatch, Management and the project's managers.");
  }
}

/** A step owned by Accounts carries finance documents. Read from the record's own flow version. */
export async function isFinanceStage(q: Queryable, type: SubjectType, version: number | null, stage: string | null) {
  if (type !== "dispatch" || !stage || !version) return false;
  return stageOf((await loadDefinition(q, "dispatch", version)).def, stage)?.owner === "accounts";
}

/** SQL filter for lists, matching requireFlowView. */
export async function flowFilter(q: Queryable, actor: Actor, alias: string, param: number) {
  const v = await flowVisibility(q, actor);
  if (v.all) return { sql: "true", params: [] as unknown[], ...v };
  if (!v.roles.length && actor.role === "employee") return { sql: "false", params: [] as unknown[], ...v };
  const s = projectScopeSql(actor, alias, `$${param}`);
  return { sql: s.sql, params: s.all ? [] : [actor.id], ...v };
}

/** The current stage's owner role, held by the actor; the Installation Manager also needs the project in scope. */
export async function requireStageOwner(q: Queryable, actor: Actor, stage: StageSpec, projectId: string) {
  if (stage.owner === "system") throw conflict(`"${stage.label}" moves on by itself; nobody completes it by hand.`);
  const roles = await actorRoles(q, actor.id);
  if (!roles.includes(stage.owner)) {
    const [r] = await q.query<{ name: string }>("select name from flow_role where code = $1", [stage.owner]);
    throw forbidden(`"${stage.label}" is done by ${r?.name ?? stage.owner}. You do not hold that role.`);
  }
  if (stage.owner === "installation_manager") await requireProjectScope(q, actor, projectId);
}

export interface SubjectRow { id: string; business_id: string; project_id: string; stage: string; stage_entered_at: number; config_version: number; status: string; version: number }

export async function lockSubject<T extends SubjectRow>(q: Queryable, type: SubjectType, id: string): Promise<T> {
  const [r] = await q.query<T>(`select * from ${TABLE[type]} where id = $1 for update`, [id]);
  if (!r) throw notFound(type === "dispatch" ? "Dispatch" : "Complaint");
  return r;
}

/** Guards against double taps and stale screens: the record must still be on the stage and version shown. */
export function expectState(row: SubjectRow, stage: string, version: number) {
  if (row.status !== "open") throw conflict(`${row.business_id} is ${row.status}.`);
  if (row.stage !== stage) throw conflict(`${row.business_id} has already moved past this step. Refresh to see where it is now.`);
  if (row.version !== version) throw conflict(`${row.business_id} changed since you opened it. Refresh and try again.`);
}

export async function writeHistory(q: Queryable, h: { type: SubjectType; id: string; from: string | null; to: string; kind: "create" | "forward" | "back" | "hold" | "close"; data?: unknown; reason?: string | null; actorId: string | null; at: number }) {
  const [r] = await q.query<{ id: string }>(
    "insert into stage_history(subject_type, subject_id, from_stage, to_stage, kind, data, reason, actor_id, at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [h.type, h.id, h.from, h.to, h.kind, JSON.stringify(h.data ?? {}), h.reason ?? null, h.actorId, iso(h.at)]);
  return r!.id;
}

/** Moves the record's pointer to a new stage. The history row is written by the caller. */
export async function setStage(q: Queryable, type: SubjectType, id: string, to: string, now: number, extraSql = "", extraParams: unknown[] = []) {
  await q.query(`update ${TABLE[type]} set stage = $2, stage_entered_at = $3, version = version + 1, updated_at = $3${extraSql} where id = $1`, [id, to, iso(now), ...extraParams]);
}

const MEDIA: Record<string, string[]> = { photo: ["image"], document: ["document"], photo_or_document: ["image", "document"] };

/** Ready, unlinked uploads under a draft key, of the media the field accepts. */
export async function readyFiles(q: Queryable, actorId: string, draftKey: string | undefined, accept: string | undefined): Promise<string[]> {
  if (!draftKey) return [];
  const rows = await q.query<{ asset_id: string }>(
    `select s.asset_id from upload_session s join evidence_asset a on a.id = s.asset_id
     where s.actor_id = $1 and s.draft_key = $2 and a.state = 'ready' and a.media_type = any($3::text[])
       and not exists (select 1 from evidence_link l where l.asset_id = s.asset_id and l.status = 'active')`, [actorId, draftKey, MEDIA[accept ?? "photo"] ?? ["image"]]);
  return rows.map((r) => r.asset_id);
}

export async function linkFiles(q: Queryable, assetIds: string[], historyId: string, context: string, actorId: string) {
  for (const a of assetIds) {
    await q.query("insert into evidence_link(asset_id, parent_type, parent_id, context, actor_id) values ($1,'stage_history',$2,$3,$4) on conflict do nothing", [a, historyId, context, actorId]);
  }
}

/** Validates a stage submission (values plus files) and returns the move it makes. */
export async function prepareStage(q: Queryable, actor: Actor, stage: StageSpec, values: Record<string, unknown>, files: Record<string, string>, reason: string | undefined) {
  const found: Record<string, string[]> = {};
  for (const f of stage.fields) if (f.type === "files") found[f.key] = await readyFiles(q, actor.id, files[f.key], f.accept);
  const { data, problems } = checkData(stage, values, Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length])));
  if (problems.length) throw validation(`${stage.label} is not complete.`, problems);
  const move = resolveMove(stage, data);
  const why = (reason ?? data.reason ?? "").trim();
  if (move.kind === "back" && why.length < 3) throw validation("Sending a step back needs a reason.", ["reason: required"]);
  return { data, move, found, reason: why || null };
}

/** Saves the history row for a completed stage and links its files. */
export async function recordStage(q: Queryable, ctx: Ctx, type: SubjectType, row: SubjectRow, p: { data: FlowData; found: Record<string, string[]>; reason: string | null }, kind: "forward" | "back" | "hold", to: string, extra: Record<string, unknown> = {}) {
  const hid = await writeHistory(q, { type, id: row.id, from: row.stage, to, kind, data: { ...p.data, ...extra, files: Object.fromEntries(Object.entries(p.found).map(([k, v]) => [k, v.length])) }, reason: p.reason, actorId: ctx.actor.id, at: ctx.now });
  for (const [key, ids] of Object.entries(p.found)) await linkFiles(q, ids, hid, `flow.${key}`, ctx.actor.id);
  await audit(q, { actorId: ctx.actor.id, action: `${type}_${kind}`, objectType: type, objectId: row.id, before: { stage: row.stage }, after: { stage: to, ...p.data }, reason: p.reason, correlationId: ctx.correlationId });
  return hid;
}

/** Generic backward move: only to a stage the current stage lists, always with a reason. */
export function checkBack(def: FlowDefinition, current: string, to: string, reason: string) {
  const s = stageOf(def, current);
  if (!s) throw conflict("This record is on a stage the flow no longer has.");
  if (!(s.backTo ?? []).includes(to)) throw validation(`From "${s.label}" you can go back only to: ${(s.backTo ?? []).map((c) => stageOf(def, c)?.label ?? c).join(", ") || "nowhere"}.`);
  if (reason.trim().length < 3) throw validation("Going back needs a reason.", ["reason: required"]);
  if (stageIndex(def, to) >= stageIndex(def, current)) throw validation("That is not an earlier stage.");
  return s;
}

/* ---------- Notifications: in-app today; another channel adds an adapter here, the callers do not change. ---------- */

export interface FlowMessage { employeeId: string; kind: string; title: string; body: string; href: string; dedupeKey: string; at: number }
interface Channel { name: string; send(q: Queryable, m: FlowMessage): Promise<void> }
const inApp: Channel = {
  name: "in_app",
  async send(q, m) {
    await q.query("insert into notification(employee_id, kind, title, body, dedupe_key, effective_at, href) values ($1,$2,$3,$4,$5,$6,$7) on conflict (dedupe_key) do nothing",
      [m.employeeId, m.kind, m.title, m.body, m.dedupeKey, iso(m.at), m.href]);
  },
};
// WhatsApp and email adapters plug in here once an approved provider and templates exist.
const CHANNELS: Channel[] = [inApp];

/** People who should hear about a stage: members of its owner role (Installation Managers: those for this project). */
export async function stageRecipients(q: Queryable, role: string, projectId: string): Promise<string[]> {
  const all = await q.query<{ id: string; scoped: boolean }>(
    `select e.id, (e.permission_role = 'admin' or p.manager_id = e.id or (e.permission_role = 'supervisor' and p.manager_id = e.manager_id)) scoped
     from flow_role_member m join employee e on e.id = m.employee_id and e.active, project p where m.role_code = $1 and p.id = $2`, [role, projectId]);
  // Installation Managers hear only about their own projects; with none scoped, nobody outside is told (F4).
  return (role === "installation_manager" ? all.filter((r) => r.scoped) : all).map((r) => r.id);
}

export async function notifyStage(q: Queryable, n: { type: SubjectType; id: string; businessId: string; projectId: string; stage: StageSpec; historyId: string; at: number; detail: string }) {
  if (n.stage.owner === "system" || n.stage.terminal) return;
  for (const emp of await stageRecipients(q, n.stage.owner, n.projectId)) {
    const m: FlowMessage = { employeeId: emp, kind: "flow_task", title: `${n.businessId}: ${n.stage.label}`, body: n.detail, href: HREF(n.type, n.id), dedupeKey: `flow:${n.historyId}:${emp}`, at: n.at };
    for (const c of CHANNELS) await c.send(q, m);
  }
}

/* ---------- Reminders ---------- */

/** Reminder at 09:00 site time, `daysBefore` days before the date (now, if that has passed). */
export async function scheduleReminder(q: Queryable, type: SubjectType, id: string, kind: string, date: string, daysBefore: number, tz: string, now: number) {
  await q.query("update flow_reminder set status = 'cancelled' where subject_type = $1 and subject_id = $2 and kind = $3 and status = 'pending'", [type, id, kind]);
  const due = Math.max(now, startOfLocalDay(addDays(date, -daysBefore), tz) + 9 * 3_600_000);
  await q.query("insert into flow_reminder(subject_type, subject_id, kind, due_at) values ($1,$2,$3,$4) on conflict do nothing", [type, id, kind, iso(due)]);
}

export async function cancelReminders(q: Queryable, type: SubjectType, id: string) {
  await q.query("update flow_reminder set status = 'cancelled' where subject_type = $1 and subject_id = $2 and status = 'pending'", [type, id]);
}

/** Sends due reminders once. Called by the job runner and on task-list reads, so a late runner never loses one. */
export async function processFlowReminders(db: Db | Queryable, now: number) {
  const due = await db.query<{ id: string; subject_id: string; kind: string }>("select id, subject_id, kind from flow_reminder where status = 'pending' and due_at <= $1 order by due_at limit 50", [iso(now)]);
  for (const r of due) {
    const [d] = await db.query<{ id: string; business_id: string; project_id: string; stage: string; status: string; hold_until: string | null; hold_reason: string | null }>(
      "select id, business_id, project_id, stage, status, hold_until::text, hold_reason from dispatch where id = $1", [r.subject_id]);
    if (r.kind === "site_ready_check" && d && d.status === "open" && d.stage === "site_readiness" && d.hold_until) {
      for (const emp of await stageRecipients(db, "installation_manager", d.project_id)) {
        await inApp.send(db, { employeeId: emp, kind: "flow_reminder", title: `${d.business_id}: check site readiness`, body: `Expected ready on ${d.hold_until}. Last reason: ${d.hold_reason}`, href: HREF("dispatch", d.id), dedupeKey: `flow-reminder:${r.id}:${emp}`, at: now });
      }
    }
    await db.query("update flow_reminder set status = 'sent', sent_at = $2 where id = $1 and status = 'pending'", [r.id, iso(now)]);
  }
  return due.length;
}

/** Validates a full definition before it is saved as a new version. */
export async function validateDefinition(q: Queryable, raw: unknown) {
  const parsed = zFlowDefinition.safeParse(raw);
  if (!parsed.success) throw validation("The flow definition is not in the expected shape.", parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "definition"}: ${i.message}`));
  const problems = checkDefinition(parsed.data, await roleCodes(q));
  if (problems.length) throw validation("The flow definition has problems.", problems.slice(0, 12));
  return parsed.data;
}
