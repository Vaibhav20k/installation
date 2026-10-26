/**
 * Admin-only employee skill cards: write side. Every operation checks the Admin permission first and then goes
 * through the existing services (skills, verification, staffing, booking, crew changes), so an administrator
 * gets no bypass of skill, scope, clearance, approval or double-booking rules. Attendance is never touched.
 */
import { z } from "zod";
import { audit } from "../audit";
import { requireAdmin } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { evaluateCoverage, type EmployeeSkillRecord, type Level } from "@/domain/skills";
import { datesBetween, localDateOf, zonedToUtc } from "@/lib/dates";
import { addEmployeeSkill, verifySkill } from "./master";
import { bookVisit, setVisitStaffing, visitRequirements } from "./booking";
import { updateVisitDates } from "./planning";
import { addCrewMember } from "./site";
import { latestRevision, loadVisit, visitSpan } from "./plan-support";
import { recordSkillChange } from "./skill-history";
import { one, parse, zDate, zId, zTime, type Ctx } from "./context";

const AREA = "employee skill cards";
const zLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const zReason = z.string().trim().min(3, "Give a reason for the change").max(300);

async function latestChange(ctx: Ctx, employeeSkillId: string) {
  const [c] = await ctx.db.query<{ id: string }>("select id from employee_skill_change where employee_skill_id = $1 order by at desc limit 1", [employeeSkillId]);
  return c?.id ?? null;
}

/** Add a claimed skill from the card. It starts unverified, as everywhere else. */
export async function addCardSkill(ctx: Ctx, input: unknown) {
  requireAdmin(ctx.actor, AREA);
  const d = parse(z.object({ employeeId: zId, skillId: zId, level: zLevel, validFrom: zDate.optional(), validTo: zDate.optional(), notes: z.string().trim().max(500).optional(), reason: zReason }), input);
  const r = await addEmployeeSkill(ctx, d);
  return { id: r.id, changeId: await latestChange(ctx, r.id) };
}

/**
 * Edit level, validity or notes. A changed level clears verification: the earlier verification was of a different
 * level, and editing must never silently mark (or keep) a skill verified. Stale edits are refused by version.
 */
export async function updateCardSkill(ctx: Ctx, input: unknown) {
  requireAdmin(ctx.actor, AREA);
  const d = parse(z.object({ employeeSkillId: zId, version: z.number().int().positive(), level: zLevel.optional(), validFrom: zDate.nullable().optional(), validTo: zDate.nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(), reason: zReason }), input);
  return ctx.db.tx(async (q) => {
    const s = await one<{ employee_id: string; level: number; verified: boolean; valid_from: string | null; valid_to: string | null; notes: string | null; version: number }>(q,
      "select employee_id, level, verified, valid_from::text, valid_to::text, notes, version from employee_skill where id = $1 for update", [d.employeeSkillId], "Skill record");
    if (s.version !== d.version) throw conflict("This skill was changed by someone else since you opened it. Reopen the card to see the latest values.");
    const next = { level: d.level ?? s.level, validFrom: d.validFrom !== undefined ? d.validFrom : s.valid_from, validTo: d.validTo !== undefined ? d.validTo : s.valid_to, notes: d.notes !== undefined ? d.notes : s.notes };
    if (next.validFrom && next.validTo && next.validTo < next.validFrom) throw validation("Valid-to date is before valid-from date.");
    const changes: Array<{ change: "level" | "validity" | "notes" | "unverified"; before: unknown; after: unknown }> = [];
    if (next.level !== s.level) changes.push({ change: "level", before: { level: s.level }, after: { level: next.level } });
    if (next.level !== s.level && s.verified) changes.push({ change: "unverified", before: { verified: true }, after: { verified: false, why: "level changed; needs fresh verification" } });
    if (next.validFrom !== s.valid_from || next.validTo !== s.valid_to) changes.push({ change: "validity", before: { validFrom: s.valid_from, validTo: s.valid_to }, after: { validFrom: next.validFrom, validTo: next.validTo } });
    if ((next.notes ?? null) !== (s.notes ?? null)) changes.push({ change: "notes", before: { notes: s.notes }, after: { notes: next.notes } });
    if (!changes.length) throw validation("Nothing changed.");
    const clearVerification = next.level !== s.level && s.verified;
    await q.query(
      `update employee_skill set level = $2, valid_from = $3, valid_to = $4, notes = $5, version = version + 1,
         verified = case when $6 then false else verified end, verified_by = case when $6 then null else verified_by end, verified_at = case when $6 then null else verified_at end
       where id = $1`, [d.employeeSkillId, next.level, next.validFrom, next.validTo, next.notes, clearVerification]);
    let changeId = "";
    for (const c of changes) changeId = await recordSkillChange(q, { employeeSkillId: d.employeeSkillId, employeeId: s.employee_id, ...c, reason: d.reason, actorId: ctx.actor.id });
    await audit(q, { actorId: ctx.actor.id, action: "card_update_skill", objectType: "employee_skill", objectId: d.employeeSkillId, before: s, after: next, reason: d.reason, correlationId: ctx.correlationId });
    return { changeId, verificationCleared: clearVerification };
  });
}

/** Verification from the card goes through the existing workflow: the skill-verify capability, never for oneself. */
export async function verifyCardSkill(ctx: Ctx, input: unknown) {
  requireAdmin(ctx.actor, AREA);
  const d = parse(z.object({ employeeSkillId: zId, verified: z.boolean(), validTo: zDate.nullable().optional(), note: zReason }), input);
  await verifySkill(ctx, d);
  return { changeId: await latestChange(ctx, d.employeeSkillId) };
}

/** A person added to a booked visit must hold any per-person skill their role needs, verified and valid for the remaining dates. */
async function perPersonProblems(ctx: Ctx, visitId: string, employeeId: string, from: number) {
  const v = await loadVisit(ctx.db, visitId);
  const span = visitSpan(v);
  if (!span) return ["The visit has no planned dates."];
  const [emp] = await ctx.db.query<{ name: string; job_role: string }>("select name, job_role from employee where id = $1", [employeeId]);
  const reqs = (await visitRequirements(ctx.db, visitId)).filter((r) => r.mode === "per_person" && (!r.appliesToRoles?.length || r.appliesToRoles.includes(emp!.job_role)));
  if (!reqs.length) return [];
  const skills = await ctx.db.query<{ code: string; level: number; verified: boolean; valid_from: string | null; valid_to: string | null }>(
    "select s.code, es.level, es.verified, es.valid_from::text, es.valid_to::text from employee_skill es join skill s on s.id = es.skill_id where es.employee_id = $1", [employeeId]);
  const records: EmployeeSkillRecord[] = skills.map((s) => ({ skillCode: s.code, level: s.level as Level, verified: s.verified, validFrom: s.valid_from, validTo: s.valid_to }));
  const dates = datesBetween(localDateOf(Math.max(from, span.start), v.timezone), localDateOf(span.end - 1, v.timezone));
  const cov = evaluateCoverage([{ id: employeeId, jobRole: emp!.job_role, skills: records }], reqs.map((r) => ({ ...r, headcount: 1 })), dates);
  return cov.results.filter((r) => !r.met).map((r) => `${emp!.name}: ${r.skillCode} ${r.message}`);
}

/**
 * Assign from a card. Unbooked visits: optional date change, then staffing as a draft (partial teams allowed, gaps
 * listed) or a confirmation (complete team, approved plan, clearance; booking re-checks coverage and capacity).
 * Booked visits: each person joins from the chosen moment through the crew-change service.
 */
export async function assignFromCard(ctx: Ctx, input: unknown) {
  requireAdmin(ctx.actor, AREA);
  const d = parse(z.object({
    employeeId: zId, visitId: zId, extraIds: z.array(zId).max(11).default([]), mode: z.enum(["draft", "confirm"]), reason: zReason,
    dates: z.object({ plannedStart: zDate, plannedEnd: zDate, departureAt: z.string().datetime({ offset: true }).nullable().optional(), returnAt: z.string().datetime({ offset: true }).nullable().optional() }).optional(),
    from: z.object({ date: zDate, time: zTime }).optional(), idempotencyKey: z.string().min(8).max(80).optional(),
  }), input);
  const [emp] = await ctx.db.query<{ active: boolean; name: string }>("select active, name from employee where id = $1", [d.employeeId]);
  if (!emp) throw validation("Employee not found.");
  if (!emp.active) throw validation(`${emp.name} is not active and cannot be assigned.`);
  const v = await loadVisit(ctx.db, d.visitId);
  if (["completed", "closed", "cancelled"].includes(v.exec_status)) throw conflict(`This visit is ${v.exec_status}.`);
  const team = await ctx.db.query<{ employee_id: string; state: string }>("select employee_id, state from reservation where visit_id = $1 and state in ('proposed','held','confirmed') and upper(span) > $2::timestamptz", [d.visitId, new Date(ctx.now).toISOString()]);
  const people = [...new Set([d.employeeId, ...d.extraIds])];
  const booked = v.exec_status === "in_progress" || team.some((t) => t.state !== "proposed");

  if (booked) {
    if (d.mode === "draft") throw conflict("This visit is already booked, so people join it directly. Use Confirm with the date and time they start.");
    if (!d.from) throw validation("Choose the date and time the person starts on this booked visit.");
    const from = zonedToUtc(d.from.date, d.from.time, v.timezone);
    // People already on the visit stay as they are; only newcomers join.
    const joining = people.filter((p) => !team.some((t) => t.employee_id === p));
    if (!joining.length) throw validation("Everyone selected is already on this visit. Choose someone to add.");
    people.splice(0, people.length, ...joining);
    const problems = (await Promise.all(people.map((p) => perPersonProblems(ctx, d.visitId, p, from)))).flat();
    if (problems.length) throw validation("These people do not hold the skills their role needs on this visit.", problems);
    const added: string[] = [];
    for (const p of people) {
      try { await addCrewMember(ctx, { visitId: d.visitId, employeeId: p, date: d.from.date, time: d.from.time, reason: d.reason }); added.push(p); }
      catch (e) { if (added.length) await audit(ctx.db, { actorId: ctx.actor.id, action: "card_assign", objectType: "visit", objectId: d.visitId, after: { added, failedAt: p }, reason: d.reason, correlationId: ctx.correlationId }); throw e; }
    }
    await audit(ctx.db, { actorId: ctx.actor.id, action: "card_assign", objectType: "visit", objectId: d.visitId, after: { mode: "join_booked", added, from: d.from }, reason: d.reason, correlationId: ctx.correlationId });
    return { status: "joined" as const, added: added.length };
  }

  if (d.dates && (d.dates.plannedStart !== v.planned_start || d.dates.plannedEnd !== v.planned_end || (d.dates.departureAt ?? null) !== (v.departure_at ? new Date(v.departure_at).toISOString() : null) || (d.dates.returnAt ?? null) !== (v.return_at ? new Date(v.return_at).toISOString() : null))) {
    await updateVisitDates(ctx, { visitId: d.visitId, ...d.dates, changeReason: d.reason });
  }
  const ids = [...new Set([...team.map((t) => t.employee_id), ...people])];
  const staffing = await setVisitStaffing(ctx, { visitId: d.visitId, employeeIds: ids, changeReason: d.reason, allowIncomplete: d.mode === "draft" });
  await audit(ctx.db, { actorId: ctx.actor.id, action: "card_assign", objectType: "visit", objectId: d.visitId, after: { mode: d.mode, employees: ids, complete: staffing.complete }, reason: d.reason, correlationId: ctx.correlationId });
  if (d.mode === "draft") return { status: "draft" as const, complete: staffing.complete, openItems: staffing.openItems };
  const rev = await latestRevision(ctx.db, v.plan_id);
  if (rev.approval_state !== "approved") return { status: "needs_approval" as const, revision: rev.revision_no, state: rev.approval_state };
  const booking = await bookVisit(ctx, { visitId: d.visitId, idempotencyKey: d.idempotencyKey });
  return { status: "confirmed" as const, confirmed: booking.confirmed };
}
