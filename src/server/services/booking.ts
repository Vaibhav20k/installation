/**
 * Team suggestion, staffing and reservations: suggestTeams, setVisitStaffing, holdCapacity,
 * bookVisit, releaseReservation (phase 5). A suggestion is not a reservation; booking revalidates
 * inside a transaction and the exclusion constraint rejects double booking under concurrency.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { requireProjectScope, requireRole, type PermissionRole } from "../auth/permissions";
import { conflict, forbidden, validation } from "../errors";
import { addDays, dayDiff, localDateOf, datesBetween, startOfLocalDay } from "@/lib/dates";
import { durationMinutes, intersect, type Interval } from "@/domain/intervals";
import { coverageByPeriod, type EmployeeSkillRecord, type Level, type SkillRequirement } from "@/domain/skills";
import { evaluateTeam, suggestTeams, type Candidate, type SuggestInput } from "@/domain/team-suggest";
import { clearanceGate, clearancePolicy } from "./clearance";
import { siteWeekdays } from "./schedule";
import { latestRevision, loadVisit, spanDayCount, visitSpan, type VisitRow } from "./plan-support";
import { getSetting, idempotent, iso, one, parse, zDate, zId, type Ctx } from "./context";

const FIELD_ROLES = ["site_supervisor", "carpenter", "helper", "senior_technician", "technician", "junior_technician", "assistant_technician", "stone_technician"];
const DAY = 86_400_000;

/** Releases held reservations whose expiry has passed (run on booking and read paths; no background job needed). */
export async function expireHolds(q: Queryable, now: number) {
  const rows = await q.query<{ id: string }>("update reservation set state = 'released' where state = 'held' and hold_expires_at <= $1 returning id", [iso(now)]);
  return rows.length;
}

export async function visitRequirements(q: Queryable, visitId: string): Promise<SkillRequirement[]> {
  const rows = await q.query<{ id: string; code: string; min_level: number; headcount: number; mode: "collective" | "per_person"; applies_to_roles: string[]; concurrency_group: string | null }>(
    "select r.id, s.code, r.min_level, r.headcount, r.mode, r.applies_to_roles, r.concurrency_group from skill_requirement r join skill s on s.id = r.skill_id where r.visit_id = $1", [visitId]);
  return rows.map((r) => ({ id: r.id, skillCode: r.code, minLevel: r.min_level as Level, headcount: r.headcount, mode: r.mode, appliesToRoles: r.applies_to_roles, concurrencyGroup: r.concurrency_group ?? undefined }));
}

async function skillsByEmployee(q: Queryable, ids: string[] | null) {
  const rows = await q.query<{ employee_id: string; code: string; level: number; verified: boolean; valid_from: string | null; valid_to: string | null }>(
    `select es.employee_id, s.code, es.level, es.verified, es.valid_from::text, es.valid_to::text from employee_skill es join skill s on s.id = es.skill_id
     ${ids ? "where es.employee_id = any($1::uuid[])" : ""}`, ids ? [ids] : []);
  const map = new Map<string, EmployeeSkillRecord[]>();
  for (const r of rows) map.set(r.employee_id, [...(map.get(r.employee_id) ?? []), { skillCode: r.code, level: r.level as Level, verified: r.verified, validFrom: r.valid_from, validTo: r.valid_to }]);
  return map;
}

/** Candidates with blocking intervals (held/confirmed elsewhere, approved leave) and workload in the window. */
export async function loadCandidates(q: Queryable, excludeVisitId: string, window: Interval, now: number): Promise<Candidate[]> {
  const emps = await q.query<{ id: string; business_id: string; name: string; job_role: string; active: boolean }>(
    "select id, business_id, name, job_role, active from employee where job_role = any($1) order by business_id", [FIELD_ROLES]);
  const skills = await skillsByEmployee(q, null);
  const res = await q.query<{ employee_id: string; s: number; e: number }>(
    `select employee_id, lower(span) s, upper(span) e from reservation
     where visit_id <> $1 and (state = 'confirmed' or (state = 'held' and hold_expires_at > $2))`, [excludeVisitId, iso(now)]);
  const leave = await q.query<{ employee_id: string; s: number; e: number }>("select employee_id, lower(span) s, upper(span) e from leave_record where status = 'approved'");
  return emps.map((e) => {
    const own = res.filter((r) => r.employee_id === e.id).map((r) => ({ start: r.s, end: r.e }));
    const lv = leave.filter((r) => r.employee_id === e.id).map((r) => ({ start: r.s, end: r.e }));
    return {
      id: e.id, name: `${e.name} (${e.business_id})`, jobRole: e.job_role, active: e.active, skills: skills.get(e.id) ?? [],
      blocking: [...own, ...lv], workloadMinutes: durationMinutes(intersect(own, [window])),
    };
  });
}

async function preferredMembers(q: Queryable, v: VisitRow, onDate: string) {
  if (!v.preferred_team_id) {
    // Repeat visits default to the previous visit's staffing in the same plan.
    const prev = await q.query<{ employee_id: string }>(
      `select distinct r.employee_id from reservation r join visit pv on pv.id = r.visit_id
       where pv.plan_id = $1 and pv.sequence < $2 and r.state in ('confirmed','released') order by 1`, [v.plan_id, v.sequence]);
    return prev.map((p) => p.employee_id);
  }
  const rows = await q.query<{ employee_id: string }>(
    "select employee_id from team_membership where team_id = $1 and valid_from <= $2 and (valid_to is null or valid_to >= $2) order by 1", [v.preferred_team_id, onDate]);
  return rows.map((r) => r.employee_id);
}

async function suggestionInput(q: Queryable, v: VisitRow, now: number, opts: { earliestStart?: string; horizonDays?: number; teamSize?: number; durationDays?: number }): Promise<SuggestInput> {
  const span = visitSpan(v);
  const anchorDate = span ? localDateOf(span.start, v.timezone) : opts.earliestStart;
  if (!anchorDate) throw validation("Set planned dates (or give a start and duration) before asking for team options.");
  const spanDays = span ? spanDayCount(span, v.timezone) : opts.durationDays;
  if (!spanDays) throw validation("Give a duration in days for an undated visit.");
  const horizonDays = opts.horizonDays ?? (await getSetting(q, "search_horizon_days", 30));
  const earliestStart = opts.earliestStart ?? anchorDate;
  const base = span ?? { start: startOfLocalDay(anchorDate, v.timezone), end: startOfLocalDay(addDays(anchorDate, spanDays), v.timezone) };
  const window = { start: base.start, end: base.end + horizonDays * DAY };
  const calendar = await q.query<{ week_pattern: Record<string, unknown> }>("select week_pattern from work_calendar order by created_at limit 1");
  // A recorded site window (society rules) narrows the company calendar; it never widens it.
  const siteDays = await siteWeekdays(q, v.project_id);
  const working = Object.keys(calendar[0]?.week_pattern ?? { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }).map(Number).filter((w) => !siteDays || siteDays.includes(w));
  const holidays = (await q.query<{ date: string }>("select date::text from holiday")).map((h) => h.date);
  return {
    candidates: await loadCandidates(q, v.id, window, now),
    requirements: await visitRequirements(q, v.id),
    teamSize: opts.teamSize ?? v.team_size,
    spanDays,
    earliestStart,
    horizonDays,
    workingWeekdays: working,
    holidays,
    // Shifts the whole itinerary (travel included) to a candidate start date.
    spanFor: (start: string) => {
      const offset = dayDiff(anchorDate, start) * DAY;
      return { start: base.start + offset, end: base.end + offset };
    },
    preferredTeam: await preferredMembers(q, v, earliestStart),
    continuity: v.continuity,
  };
}

export async function suggestTeamsForVisit(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, earliestStart: zDate.optional(), horizonDays: z.number().int().min(1).max(120).optional(), teamSize: z.number().int().min(1).max(12).optional(), durationDays: z.number().int().min(1).max(60).optional() }), input);
  requireRole(ctx.actor, "supervisor", "team suggestions");
  const q = ctx.db;
  const v = await loadVisit(q, d.visitId);
  await requireProjectScope(q, ctx.actor, v.project_id);
  const si = await suggestionInput(q, v, ctx.now, d);
  const result = suggestTeams(si);
  const names = new Map(si.candidates.map((c) => [c.id, { name: c.name, jobRole: c.jobRole }]));
  const describe = (o: (typeof result.options)[number] | null) => o && {
    ...o, members: o.memberIds.map((id) => ({ id, ...names.get(id)! })),
    crewPresence: datesBetween(o.start, addDays(o.start, si.spanDays - 1)).map((date) => ({ date, present: o.memberIds.length })),
  };
  return {
    ...result,
    options: result.options.map(describe),
    earliest: describe(result.earliest),
    strongestContinuity: describe(result.strongestContinuity),
    preferredTeam: (si.preferredTeam ?? []).map((id) => ({ id, ...names.get(id) })),
    teamSize: si.teamSize, spanDays: si.spanDays, continuity: si.continuity,
    requirements: si.requirements,
  };
}

/**
 * Coverage of the visit's current staffing (proposed, held or confirmed) over its dates. With `activeAt`,
 * only bookings running at that moment count, over the remaining dates (used after a substitution).
 */
export async function visitCoverage(q: Queryable, visitId: string, opts: { activeAt?: number } = {}) {
  const v = await loadVisit(q, visitId);
  const span = visitSpan(v);
  const members = await q.query<{ employee_id: string; job_role: string; lo: number; hi: number }>(
    `select r.employee_id, e.job_role, lower(r.span) lo, upper(r.span) hi from reservation r join employee e on e.id = r.employee_id
     where r.visit_id = $1 and r.state in ('proposed','held','confirmed')`, [visitId]);
  if (!span) return { met: false, problems: ["Visit has no planned dates"], memberCount: members.length };
  const skills = await skillsByEmployee(q, members.map((m) => m.employee_id));
  const requirements = await visitRequirements(q, visitId);
  const from = opts.activeAt && opts.activeAt > span.start ? opts.activeAt : span.start;
  const cov = coverageByPeriod(members.map((m) => ({ id: m.employee_id, jobRole: m.job_role, skills: skills.get(m.employee_id) ?? [], from: Number(m.lo), until: Number(m.hi) })),
    requirements, from, span.end, v.team_size, (a, b) => datesBetween(localDateOf(a, v.timezone), localDateOf(b - 1, v.timezone)));
  return { met: cov.met, problems: cov.problems, memberCount: cov.periods[0]?.present.length ?? 0, results: cov.periods[0]?.results ?? [] };
}

/** Manual selection passes the same checks as suggestions; it creates proposed (nonblocking) reservations. */
export async function setVisitStaffing(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, employeeIds: z.array(zId).min(1).max(12), changeReason: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "staffing visits");
  return ctx.db.tx(async (q) => {
    await expireHolds(q, ctx.now);
    const v = await loadVisit(q, d.visitId, true);
    await requireProjectScope(q, ctx.actor, v.project_id);
    if (!["unscheduled", "scheduled", "on_hold"].includes(v.exec_status)) throw conflict(`Staffing of a ${v.exec_status} visit changes through a schedule revision.`);
    const span = visitSpan(v);
    if (!span) throw validation("Set planned dates before staffing.");
    const si = await suggestionInput(q, v, ctx.now, {});
    const check = evaluateTeam(si, d.employeeIds, localDateOf(span.start, v.timezone));
    if (!check.ok) throw validation("This team does not pass the staffing checks.", check.problems);
    const { ensureDraftRevision } = await import("./plan-support");
    await ensureDraftRevision(q, ctx, v.plan_id, d.changeReason);
    const existing = await q.query<{ id: string; employee_id: string; state: string }>("select id, employee_id, state from reservation where visit_id = $1 and state in ('proposed','held','confirmed')", [d.visitId]);
    const removing = existing.filter((r) => !d.employeeIds.includes(r.employee_id));
    if (removing.some((r) => r.state === "confirmed")) requireRole(ctx.actor, "manager", "removing booked staff");
    for (const r of removing) {
      await q.query("update reservation set state = $2 where id = $1", [r.id, r.state === "proposed" ? "cancelled" : "released"]);
    }
    const roles = new Map(si.candidates.map((c) => [c.id, c.jobRole]));
    for (const emp of d.employeeIds.filter((id) => !existing.some((r) => r.employee_id === id))) {
      await q.query("insert into reservation(visit_id, employee_id, role, span, state, created_by) values ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz),'proposed',$6)",
        [d.visitId, emp, roles.get(emp) ?? "technician", iso(span.start), iso(span.end), ctx.actor.id]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "set_staffing", objectType: "visit", objectId: d.visitId, before: existing.map((e) => e.employee_id), after: d.employeeIds, correlationId: ctx.correlationId });
    return { coverage: check.coverage };
  });
}

/** Proposed -> Held (blocking with expiry). A hold does not authorize deployment. */
export async function holdCapacity(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId }), input);
  return ctx.db.tx(async (q) => {
    const policy = await clearancePolicy(q);
    await expireHolds(q, ctx.now);
    const v = await loadVisit(q, d.visitId, true);
    await requireProjectScope(q, ctx.actor, v.project_id);
    const gate = await clearanceGate(q, d.visitId, v.planned_start ?? localDateOf(ctx.now, v.timezone));
    requireRole(ctx.actor, gate.ok ? "supervisor" : (policy.holdBeforeClearance as PermissionRole), "holding capacity before clearance");
    const hours = await getSetting(q, "hold_hours", 48);
    const rows = await q.query<{ id: string }>(
      "update reservation set state = 'held', hold_expires_at = $2, version = version + 1 where visit_id = $1 and state = 'proposed' returning id", [d.visitId, iso(ctx.now + hours * 3_600_000)]);
    if (!rows.length) throw conflict("There is no proposed staffing to hold.");
    await audit(q, { actorId: ctx.actor.id, action: "hold", objectType: "visit", objectId: d.visitId, after: { reservations: rows.length, hours }, correlationId: ctx.correlationId });
    return { held: rows.length, expiresAt: ctx.now + hours * 3_600_000, clearanceBlockers: gate.blockers };
  });
}

/** Firm booking: approved plan, valid clearance (or exception), full coverage; confirms all staffing atomically. */
export async function bookVisit(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, idempotencyKey: z.string().min(8).max(80).optional() }), input);
  requireRole(ctx.actor, "manager", "firm booking");
  return ctx.db.tx((q) => idempotent(q, ctx.actor.id, d.idempotencyKey, `bookVisit:${d.visitId}`, async () => {
    await expireHolds(q, ctx.now);
    const v = await loadVisit(q, d.visitId, true);
    await requireProjectScope(q, ctx.actor, v.project_id);
    if (!["unscheduled", "scheduled"].includes(v.exec_status)) throw conflict(`A ${v.exec_status} visit cannot be booked.`);
    const rev = await latestRevision(q, v.plan_id);
    if (rev.approval_state !== "approved") throw conflict(`Plan revision ${rev.revision_no} is ${rev.approval_state}; firm booking needs an approved plan.`);
    const span = visitSpan(v)!;
    const gate = await clearanceGate(q, d.visitId, v.planned_start!);
    if (!gate.ok) throw forbidden(`Booking is blocked: ${gate.blockers.join("; ")}.`);
    const cov = await visitCoverage(q, d.visitId);
    if (!cov.met) throw validation("Staffing no longer meets the requirements.", cov.problems);
    // Updating to confirmed re-checks the exclusion constraint against every other held/confirmed booking.
    const rows = await q.query<{ id: string }>(
      `update reservation set state = 'confirmed', hold_expires_at = null, span = tstzrange($2::timestamptz,$3::timestamptz), version = version + 1
       where visit_id = $1 and state in ('proposed','held') returning id`, [d.visitId, iso(span.start), iso(span.end)]);
    for (const r of rows) {
      await q.query("delete from reservation_activity where reservation_id = $1", [r.id]);
      await q.query("insert into reservation_activity(reservation_id, kind, span) values ($1,'work',tstzrange($2::timestamptz,$3::timestamptz))", [r.id, iso(span.start), iso(span.end)]);
    }
    await q.query("update visit set exec_status = 'scheduled', version = version + 1, updated_at = now() where id = $1 and exec_status = 'unscheduled'", [d.visitId]);
    await audit(q, { actorId: ctx.actor.id, action: "book", objectType: "visit", objectId: d.visitId, after: { confirmed: rows.length, exceptions: gate.exceptions }, correlationId: ctx.correlationId });
    return { confirmed: rows.length, exceptionsUsed: gate.exceptions };
  }));
}

export async function releaseReservation(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ reservationId: zId, reason: z.string().min(3).max(300) }), input);
  requireRole(ctx.actor, "manager", "releasing reservations");
  return ctx.db.tx(async (q) => {
    const r = await one<{ visit_id: string; state: string; project_id: string; exec_status: string; outstation: boolean; upper: number }>(q,
      `select r.visit_id, r.state, v.project_id, v.exec_status, v.outstation, upper(r.span) "upper" from reservation r join visit v on v.id = r.visit_id where r.id = $1 for update of r`, [d.reservationId], "Reservation");
    await requireProjectScope(q, ctx.actor, r.project_id);
    if (!["proposed", "held", "confirmed"].includes(r.state)) throw conflict(`This reservation is already ${r.state}.`);
    if (r.outstation && r.exec_status === "in_progress" && r.upper > ctx.now) throw forbidden("An outstation employee is released only after return or an explicit visit schedule revision.");
    await q.query("update reservation set state = $2, version = version + 1 where id = $1", [d.reservationId, r.state === "proposed" ? "cancelled" : "released"]);
    await audit(q, { actorId: ctx.actor.id, action: "release", objectType: "reservation", objectId: d.reservationId, before: { state: r.state }, reason: d.reason, correlationId: ctx.correlationId });
  });
}
