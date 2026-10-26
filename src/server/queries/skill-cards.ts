/**
 * Admin-only employee skill cards: read side. Cards read the existing employee, skill, leave, reservation and
 * calendar records. Availability is derived here on every read; summaries load first, history and evidence on demand.
 */
import type { Queryable } from "../db/client";
import { requireAdmin, type Actor } from "../auth/permissions";
import { notFound } from "../errors";
import { nextAvailableDate, type Availability } from "@/domain/availability";
import { paging, type Paged } from "./common";
import { teamCandidates } from "./installations";

const AREA = "employee skill cards";
const HORIZON_DAYS = 90;

export interface CardSkill { id: string; code: string; name: string; level: 1 | 2 | 3; verified: boolean; valid_from: string | null; valid_to: string | null; expired: boolean; not_yet: boolean }
export interface CardSummary {
  id: string; business_id: string; name: string; job_role: string; base_city: string; active: boolean; availability: Availability;
  current: { visit_id: string; visit: string; project: string } | null; next_available: string | null; portrait: string | null;
  skills: CardSkill[]; experience: { completed_visits: number; visits: number; projects: number; since: string | null };
}
export interface CardFilters { q?: string; role?: string; skill?: string; minLevel?: number; verification?: "verified" | "unverified" | "expired"; city?: string; availability?: Availability; page?: number }

/** Derived status at `now`: leave, then travel inside a booking, then a booking, else the calendar decides. */
const AVAILABILITY_SQL = `case
  when not e.active then 'unknown'
  when exists (select 1 from leave_record l where l.employee_id = e.id and l.status = 'approved' and l.span @> $1::timestamptz) then 'on_leave'
  when exists (select 1 from reservation r join reservation_activity ra on ra.reservation_id = r.id
    where r.employee_id = e.id and r.state in ('held','confirmed') and ra.kind = 'travel' and ra.span @> $1::timestamptz) then 'travelling'
  when exists (select 1 from reservation r where r.employee_id = e.id and r.state in ('held','confirmed') and r.span @> $1::timestamptz) then 'assigned'
  when e.calendar_id is null then 'unknown'
  else 'available' end`;

export async function listCards(q: Queryable, actor: Actor, f: CardFilters, now: number): Promise<Paged<CardSummary> & { cities: string[]; skills: Array<{ code: string; name: string }> }> {
  requireAdmin(actor, AREA);
  const pg = paging(f.page, 24);
  const params: unknown[] = [new Date(now).toISOString()];
  const where: string[] = ["true"];
  const add = (sql: (n: string) => string, v: unknown) => { params.push(v); where.push(sql(`$${params.length}`)); };
  if (f.q) add((n) => `(e.name ilike ${n} or e.business_id ilike ${n})`, `%${f.q.replace(/[%_]/g, "")}%`);
  if (f.role) add((n) => `e.job_role = ${n}`, f.role);
  if (f.city) add((n) => `e.base_city = ${n}`, f.city);
  if (f.skill || f.minLevel || f.verification) {
    const cond: string[] = [];
    if (f.skill) { params.push(f.skill); cond.push(`s.code = $${params.length}`); }
    if (f.minLevel) { params.push(f.minLevel); cond.push(`es.level >= $${params.length}`); }
    if (f.verification === "verified") cond.push("es.verified and (es.valid_to is null or es.valid_to >= ($1::timestamptz at time zone 'Asia/Kolkata')::date)");
    if (f.verification === "unverified") cond.push("not es.verified");
    if (f.verification === "expired") cond.push("es.valid_to < ($1::timestamptz at time zone 'Asia/Kolkata')::date");
    where.push(`exists (select 1 from employee_skill es join skill s on s.id = es.skill_id where es.employee_id = e.id and ${cond.join(" and ") || "true"})`);
  }
  const availFilter = f.availability ? (params.push(f.availability), `where c.availability = $${params.length}`) : "";
  const rows = await q.query<Omit<CardSummary, "next_available"> & { total: number; tz: string }>(
    `select c.*, count(*) over ()::int total from (
       select e.id, e.business_id, e.name, e.job_role, e.base_city, e.active, coalesce(cal.timezone, 'Asia/Kolkata') tz, ${AVAILABILITY_SQL} availability
       from employee e left join work_calendar cal on cal.id = e.calendar_id where ${where.join(" and ")}
     ) c ${availFilter} order by c.active desc, c.name limit ${pg.pageSize} offset ${pg.offset}`, params);
  const ids = rows.map((r) => r.id);
  const [details, cities, skills] = await Promise.all([
    ids.length ? cardExtras(q, ids, now) : Promise.resolve(new Map<string, Extras>()),
    q.query<{ base_city: string }>("select distinct base_city from employee order by base_city"),
    q.query<{ code: string; name: string }>("select code, name from skill order by name"),
  ]);
  const cal = await calendarFacts(q);
  const out = rows.map(({ total: _t, tz, ...r }) => {
    const x = details.get(r.id)!;
    // Next available is shown only when the status is known; Unknown stays unknown.
    const next = r.availability === "unknown" ? null : r.availability === "available" ? null : nextAvailableDate(x.blocks, now, tz, cal.working, cal.holidays, HORIZON_DAYS);
    return { ...r, current: x.current, portrait: x.portrait, skills: x.skills, experience: x.experience, next_available: next };
  });
  return { rows: out, total: rows[0]?.total ?? 0, page: pg.page, pageSize: pg.pageSize, cities: cities.map((c) => c.base_city), skills };
}

interface Extras { skills: CardSkill[]; current: CardSummary["current"]; portrait: string | null; experience: CardSummary["experience"]; blocks: Array<{ start: number; end: number }> }

/** Everything a page of cards needs, in one bounded round of queries for just those people. */
async function cardExtras(q: Queryable, ids: string[], now: number): Promise<Map<string, Extras>> {
  const at = new Date(now).toISOString(), until = new Date(now + HORIZON_DAYS * 86_400_000).toISOString();
  const [skills, current, portraits, experience, blocks] = await Promise.all([
    q.query<CardSkill & { employee_id: string }>(
      `select es.employee_id, es.id, s.code, s.name, es.level, es.verified, es.valid_from::text, es.valid_to::text,
         coalesce(es.valid_to < ($2::timestamptz at time zone 'Asia/Kolkata')::date, false) expired, coalesce(es.valid_from > ($2::timestamptz at time zone 'Asia/Kolkata')::date, false) not_yet
       from employee_skill es join skill s on s.id = es.skill_id where es.employee_id = any($1::uuid[]) order by es.level desc, s.name`, [ids, at]),
    q.query<{ employee_id: string; visit_id: string; visit: string; project: string }>(
      `select distinct on (r.employee_id) r.employee_id, v.id visit_id, v.business_id visit, p.name project
       from reservation r join visit v on v.id = r.visit_id join project p on p.id = v.project_id
       where r.employee_id = any($1::uuid[]) and r.state in ('held','confirmed') and r.span @> $2::timestamptz order by r.employee_id, lower(r.span)`, [ids, at]),
    q.query<{ parent_id: string; asset_id: string }>(
      `select distinct on (l.parent_id) l.parent_id, l.asset_id from evidence_link l join evidence_asset a on a.id = l.asset_id
       where l.parent_type = 'employee_portrait' and l.parent_id = any($1::uuid[]) and l.status = 'active' and a.state = 'ready' order by l.parent_id, l.created_at desc`, [ids]),
    q.query<{ employee_id: string; completed_visits: number; visits: number; projects: number; since: string | null }>(
      `select r.employee_id, count(distinct r.visit_id) filter (where v.exec_status in ('completed','closed'))::int completed_visits,
         count(distinct r.visit_id)::int visits, count(distinct v.project_id)::int projects, min(lower(r.span))::date::text since
       from reservation r join visit v on v.id = r.visit_id where r.employee_id = any($1::uuid[]) and r.state in ('confirmed','released') and lower(r.span) <= $2::timestamptz group by r.employee_id`, [ids, at]),
    q.query<{ employee_id: string; lo: number; hi: number }>(
      `select employee_id, lower(span) lo, upper(span) hi from leave_record where employee_id = any($1::uuid[]) and status = 'approved' and span && tstzrange($2::timestamptz, $3::timestamptz)
       union all select employee_id, lower(span), upper(span) from reservation where employee_id = any($1::uuid[]) and state in ('held','confirmed') and span && tstzrange($2::timestamptz, $3::timestamptz)`, [ids, at, until]),
  ]);
  const map = new Map<string, Extras>(ids.map((id) => [id, { skills: [], current: null, portrait: null, experience: { completed_visits: 0, visits: 0, projects: 0, since: null }, blocks: [] }]));
  for (const { employee_id, ...s } of skills) map.get(employee_id)!.skills.push(s);
  for (const c of current) map.get(c.employee_id)!.current = { visit_id: c.visit_id, visit: c.visit, project: c.project };
  for (const p of portraits) map.get(p.parent_id)!.portrait = p.asset_id;
  for (const { employee_id, ...e } of experience) map.get(employee_id)!.experience = e;
  for (const b of blocks) map.get(b.employee_id)!.blocks.push({ start: Number(b.lo), end: Number(b.hi) });
  return map;
}

async function calendarFacts(q: Queryable) {
  const [cal] = await q.query<{ week_pattern: Record<string, unknown> }>("select week_pattern from work_calendar order by created_at limit 1");
  const holidays = (await q.query<{ date: string }>("select date::text from holiday")).map((h) => h.date);
  return { working: cal ? Object.keys(cal.week_pattern).map(Number) : [], holidays };
}

/** One card's detail, loaded when the drawer opens: skill records with their recent history and evidence counts. */
const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

export async function cardDetail(q: Queryable, actor: Actor, employeeId: string, now: number) {
  requireAdmin(actor, AREA);
  if (!isId(employeeId)) throw notFound("Employee");
  const [emp] = await q.query<{ id: string; business_id: string; name: string; job_role: string; base_city: string; active: boolean; manager: string | null }>(
    "select e.id, e.business_id, e.name, e.job_role, e.base_city, e.active, m.name manager from employee e left join employee m on m.id = e.manager_id where e.id = $1", [employeeId]);
  if (!emp) throw notFound("Employee");
  const at = new Date(now).toISOString();
  const [skills, history, assignments, catalog] = await Promise.all([
    q.query<{ id: string; skill_id: string; code: string; name: string; level: number; verified: boolean; verifier: string | null; verified_at: number | null; valid_from: string | null; valid_to: string | null; notes: string | null; version: number; expired: boolean }>(
      `select es.id, s.id skill_id, s.code, s.name, es.level, es.verified, v.name verifier, es.verified_at, es.valid_from::text, es.valid_to::text, es.notes, es.version,
         coalesce(es.valid_to < ($2::timestamptz at time zone 'Asia/Kolkata')::date, false) expired
       from employee_skill es join skill s on s.id = es.skill_id left join employee v on v.id = es.verified_by where es.employee_id = $1 order by s.name`, [employeeId, at]),
    q.query<{ id: string; employee_skill_id: string; change: string; before: unknown; after: unknown; reason: string | null; actor: string | null; at: number; evidence: number }>(
      `select * from (select c.id, c.employee_skill_id, c.change, c.before, c.after, c.reason, a.name actor, c.at,
         (select count(*)::int from evidence_link l where l.parent_type = 'employee_skill_change' and l.parent_id = c.id and l.status = 'active') evidence,
         row_number() over (partition by c.employee_skill_id order by c.at desc) n
       from employee_skill_change c left join employee a on a.id = c.actor_id where c.employee_id = $1) h where n <= 12 order by at desc`, [employeeId]),
    q.query<{ visit_id: string; visit: string; project: string; state: string; from: number; until: number; exec_status: string }>(
      `select v.id visit_id, v.business_id visit, p.name project, r.state, lower(r.span) "from", upper(r.span) "until", v.exec_status
       from reservation r join visit v on v.id = r.visit_id join project p on p.id = v.project_id
       where r.employee_id = $1 and r.state in ('proposed','held','confirmed','released') order by lower(r.span) desc limit 8`, [employeeId]),
    q.query<{ id: string; code: string; name: string }>("select id, code, name from skill order by name"),
  ]);
  return { employee: emp, skills: skills.map((s) => ({ ...s, history: history.filter((h) => h.employee_skill_id === s.id) })), assignments, catalog };
}

/** Projects with visits that can still take people: the first step of "Assign plan". */
export async function assignOptions(q: Queryable, actor: Actor) {
  requireAdmin(actor, AREA);
  return q.query<{ visit_id: string; visit: string; visit_type: string; exec_status: string; project_id: string; project: string; planned_start: string | null; planned_end: string | null; staffed: number; team_size: number }>(
    `select v.id visit_id, v.business_id visit, v.visit_type, v.exec_status, p.id project_id, p.business_id || ' · ' || p.name project, v.planned_start::text, v.planned_end::text,
       (select count(*)::int from reservation r where r.visit_id = v.id and r.state in ('proposed','held','confirmed') and upper(r.span) > now()) staffed, v.team_size
     from visit v join project p on p.id = v.project_id
     where v.exec_status in ('unscheduled','scheduled','on_hold','in_progress') order by p.business_id, coalesce(v.planned_start, '9999-12-31'), v.business_id limit 200`);
}

/** Everything the assign drawer shows for one visit, with the chosen person's own checks. */
export async function assignContext(q: Queryable, actor: Actor, employeeId: string, visitId: string, now: number) {
  requireAdmin(actor, AREA);
  if (!isId(employeeId) || !isId(visitId)) throw notFound("Visit");
  const { loadVisit, latestRevision } = await import("../services/plan-support");
  const { clearanceGate, readinessGate } = await import("../services/clearance");
  const { visitCoverage, visitRequirements } = await import("../services/booking");
  const v = await loadVisit(q, visitId);
  const [emp] = await q.query<{ id: string; name: string; business_id: string; job_role: string; active: boolean }>("select id, name, business_id, job_role, active from employee where id = $1", [employeeId]);
  if (!emp) throw notFound("Employee");
  const rev = await latestRevision(q, v.plan_id);
  const today = v.planned_start ?? new Date(now).toISOString().slice(0, 10);
  const [team, orders, tasks, legs, requirements, candidates, clearance, readiness, coverage] = await Promise.all([
    q.query<{ employee_id: string; name: string; business_id: string; role: string; state: string; from: number; until: number }>(
      `select r.employee_id, e.name, e.business_id, r.role, r.state, lower(r.span) "from", upper(r.span) "until" from reservation r join employee e on e.id = r.employee_id
       where r.visit_id = $1 and r.state in ('proposed','held','confirmed') and upper(r.span) > $2::timestamptz order by r.state, e.name`, [visitId, new Date(now).toISOString()]),
    q.query<{ business_id: string }>("select o.business_id from visit_order vo join sales_order o on o.id = vo.order_id where vo.visit_id = $1 order by o.business_id", [visitId]),
    q.query<{ id: string; task: string; component: string; activity: string; unit: string; scoped: number; depends_on: number }>(
      `select vt.id, t.business_id task, c.name component, t.activity, t.unit, vt.scoped_quantity::float scoped,
         (select count(*)::int from task_dependency d where d.task_id = t.id) depends_on
       from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id
       where vt.visit_id = $1 and vt.status = 'active' order by c.business_id, t.step_order limit 50`, [visitId]),
    q.query<{ kind: string; origin: string; destination: string; depart: number; arrive: number; travellers: number }>(
      `select l.kind, l.origin, l.destination, l.planned_depart depart, l.planned_arrive arrive, count(tp.employee_id)::int travellers
       from travel_leg l join travel_participant tp on tp.leg_id = l.id where tp.visit_id = $1 group by l.id order by l.planned_depart`, [visitId]),
    visitRequirements(q, visitId),
    teamCandidates(q, visitId, now),
    clearanceGate(q, visitId, today),
    readinessGate(q, visitId, today),
    visitCoverage(q, visitId),
  ]);
  const booked = v.exec_status === "in_progress" || team.some((m) => m.state !== "proposed");
  const me = candidates.find((c) => c.id === employeeId);
  const onTeam = team.some((m) => m.employee_id === employeeId);
  return {
    visit: { id: v.id, business_id: v.business_id, exec_status: v.exec_status, planned_start: v.planned_start, planned_end: v.planned_end, departure_at: v.departure_at, return_at: v.return_at,
      team_size: v.team_size, continuity: v.continuity, timezone: v.timezone, revision: { no: rev.revision_no, state: rev.approval_state }, orders: orders.map((o) => o.business_id) },
    employee: { ...emp, onTeam, busy: onTeam ? "already on this visit" : me?.busy ?? (emp.active ? null : "inactive") },
    booked, team, tasks, legs, coverage,
    requirements: requirements.map((r) => ({ skill: r.skillCode, minLevel: r.minLevel, headcount: r.headcount, mode: r.mode })),
    candidates: candidates.filter((c) => c.id !== employeeId),
    gates: { clearance: clearance.blockers.concat(clearance.exceptions.map((x) => `Exception in use: ${x}`)), clearanceOk: clearance.ok, readiness: readiness.blockers, readinessOk: readiness.ok },
  };
}
