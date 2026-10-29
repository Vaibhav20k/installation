/**
 * Site check-in and check-out. A worker records being at one site they are booked on; the server stamps the
 * time. Presence is linked to the daily attendance session but never starts, resets or ends it. Repeats are
 * idempotent; overlapping or second open sessions are refused (and prevented by the database). Mistakes and
 * missing punches are fixed by a supervisor through an audited correction, never by inventing a check-out.
 */
import { z } from "zod";
import { audit } from "../audit";
import { forbidSelfApproval, requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, forbidden, validation } from "../errors";
import { localDateOf, startOfLocalDay, addDays, zonedToUtc, formatDateTime } from "@/lib/dates";
import { iso, one, parse, zDate, zId, zTime, zVersion, type Ctx } from "./context";
import type { Queryable } from "../db/client";

interface PresenceRow { id: string; employee_id: string; visit_id: string; project_id: string; check_in_at: number; check_out_at: number | null; voided: boolean; missed_checkout: boolean; version: number }
const SELECT = "select id, employee_id, visit_id, project_id, check_in_at, check_out_at, voided, missed_checkout, version from site_presence";

async function record(q: Queryable, presenceId: string, change: string, before: unknown, after: unknown, reason: string | null, actorId: string) {
  await q.query("insert into site_presence_change(presence_id, change, before, after, reason, actor_id) values ($1,$2,$3,$4,$5,$6)",
    [presenceId, change, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), reason, actorId]);
}

/** Sites the employee may check in at on the site-local date of `now`: a held or confirmed booking that day. */
export async function checkInSites(q: Queryable, employeeId: string, now: number) {
  const rows = await q.query<{ visit_id: string; visit: string; project: string; site_address: string; timezone: string; lo: number; hi: number }>(
    `select v.id visit_id, v.business_id visit, p.name project, p.site_address, p.timezone, min(lower(r.span)) lo, max(upper(r.span)) hi
     from reservation r join visit v on v.id = r.visit_id join project p on p.id = v.project_id
     where r.employee_id = $1 and r.state in ('held','confirmed') and v.exec_status not in ('completed','closed','cancelled')
       and r.span && tstzrange($2::timestamptz - interval '1 day', $2::timestamptz + interval '1 day')
     group by v.id, v.business_id, p.name, p.site_address, p.timezone order by min(lower(r.span))`, [employeeId, iso(now)]);
  // The booking must touch the site's own local date today.
  return rows.filter((r) => {
    const day = localDateOf(now, r.timezone);
    const dayStart = startOfLocalDay(day, r.timezone), dayEnd = startOfLocalDay(addDays(day, 1), r.timezone);
    return Number(r.lo) < dayEnd && Number(r.hi) > dayStart;
  });
}

export async function openPresence(q: Queryable, employeeId: string) {
  const [r] = await q.query<PresenceRow & { visit: string; project: string; timezone: string }>(
    `select s.id, s.employee_id, s.visit_id, s.project_id, s.check_in_at, s.check_out_at, s.voided, s.missed_checkout, s.version, v.business_id visit, p.name project, p.timezone
     from site_presence s join visit v on v.id = s.visit_id join project p on p.id = s.project_id
     where s.employee_id = $1 and s.check_out_at is null and not s.voided and not s.missed_checkout`, [employeeId]);
  return r ?? null;
}

export async function siteCheckIn(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId }), input);
  const me = ctx.actor.id;
  return ctx.db.tx(async (q) => {
    // Serialises double taps and retries from the same person.
    await q.query("select id from employee where id = $1 for update", [me]);
    let open = await openPresence(q, me);
    if (open && localDateOf(Number(open.check_in_at), open.timezone) < localDateOf(ctx.now, open.timezone)) {
      // Never closed on its own date: flag it for correction and keep it uncounted; do not invent an end.
      await q.query("update site_presence set missed_checkout = true, version = version + 1 where id = $1", [open.id]);
      await record(q, open.id, "missed_checkout", null, { flaggedAt: iso(ctx.now) }, null, me);
      open = null;
    }
    if (open) {
      if (open.visit_id === d.visitId) return { presenceId: open.id, already: true, checkInAt: Number(open.check_in_at) };
      throw conflict(`You are still checked in at ${open.visit} (${open.project}) since ${formatDateTime(Number(open.check_in_at), open.timezone)}. Check out there first; if you forgot, ask your supervisor to correct it.`);
    }
    const site = (await checkInSites(q, me, ctx.now)).find((s) => s.visit_id === d.visitId);
    if (!site) throw forbidden("You can only check in at a site you are booked on today.");
    const [v] = await q.query<{ project_id: string }>("select project_id from visit where id = $1", [d.visitId]);
    const [shift] = await q.query<{ id: string }>("select id from shift_instance where employee_id = $1 and work_date = $2", [me, localDateOf(ctx.now, site.timezone)]);
    const [s] = await q.query<{ id: string }>(
      "insert into site_presence(employee_id, visit_id, project_id, check_in_at, shift_id, source, created_by) values ($1,$2,$3,$4,$5,'live',$1) returning id",
      [me, d.visitId, v!.project_id, iso(ctx.now), shift?.id ?? null]);
    await record(q, s!.id, "check_in", null, { at: iso(ctx.now) }, null, me);
    await audit(q, { actorId: me, action: "site_check_in", objectType: "site_presence", objectId: s!.id, after: { visitId: d.visitId }, correlationId: ctx.correlationId });
    return { presenceId: s!.id, already: false, checkInAt: ctx.now };
  });
}

export async function siteCheckOut(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ presenceId: zId }), input);
  const me = ctx.actor.id;
  return ctx.db.tx(async (q) => {
    const s = await one<PresenceRow>(q, `${SELECT} where id = $1 for update`, [d.presenceId], "Site session");
    if (s.employee_id !== me) throw forbidden("You can only check yourself out.");
    if (s.voided) throw conflict("This site session was removed by a correction.");
    // A repeated tap returns the check-out already recorded.
    if (s.check_out_at !== null) return { presenceId: s.id, already: true, checkOutAt: Number(s.check_out_at) };
    if (s.missed_checkout) throw conflict("This session was left open on an earlier day. Your supervisor enters the real check-out time.");
    const [p] = await q.query<{ timezone: string }>("select timezone from project where id = $1", [s.project_id]);
    if (localDateOf(Number(s.check_in_at), p!.timezone) < localDateOf(ctx.now, p!.timezone)) {
      throw conflict(`You checked in on ${localDateOf(Number(s.check_in_at), p!.timezone)} and did not check out. Checking out now would count the whole night, so ask your supervisor to enter the real check-out time. You can check in again today.`);
    }
    if (ctx.now <= Number(s.check_in_at)) throw validation("Check-out must be after check-in.");
    await q.query("update site_presence set check_out_at = $2, version = version + 1 where id = $1", [s.id, iso(ctx.now)]);
    await record(q, s.id, "check_out", null, { at: iso(ctx.now) }, null, me);
    await audit(q, { actorId: me, action: "site_check_out", objectType: "site_presence", objectId: s.id, correlationId: ctx.correlationId });
    return { presenceId: s.id, already: false, checkOutAt: ctx.now };
  });
}

const zLocal = z.object({ date: zDate, time: zTime });
const zReason = z.string().trim().min(3, "Give a reason for the correction").max(300);

/** Supervisor correction of a site session: change either time, close a missed check-out, or remove a wrong session. */
export async function correctPresence(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ presenceId: zId, version: zVersion, checkIn: zLocal.optional(), checkOut: zLocal.nullable().optional(), voided: z.boolean().optional(), reason: zReason }), input);
  requireRole(ctx.actor, "supervisor", "site attendance corrections");
  return ctx.db.tx(async (q) => {
    const s = await one<PresenceRow>(q, `${SELECT} where id = $1 for update`, [d.presenceId], "Site session");
    await requireProjectScope(q, ctx.actor, s.project_id);
    forbidSelfApproval(ctx.actor, s.employee_id, "site attendance");
    if (s.version !== d.version) throw conflict("This site session changed since you opened it. Reload and try again.");
    const [p] = await q.query<{ timezone: string }>("select timezone from project where id = $1", [s.project_id]);
    const tz = p!.timezone;
    const inAt = d.checkIn ? zonedToUtc(d.checkIn.date, d.checkIn.time, tz) : Number(s.check_in_at);
    const outAt = d.checkOut === undefined ? (s.check_out_at === null ? null : Number(s.check_out_at)) : d.checkOut === null ? null : zonedToUtc(d.checkOut.date, d.checkOut.time, tz);
    if (outAt !== null && outAt <= inAt) throw validation("Check-out must be after check-in.");
    if (outAt !== null && outAt > ctx.now) throw validation("Check-out cannot be in the future.");
    const voided = d.voided ?? s.voided;
    const before = { checkIn: iso(Number(s.check_in_at)), checkOut: s.check_out_at === null ? null : iso(Number(s.check_out_at)), voided: s.voided };
    const after = { checkIn: iso(inAt), checkOut: outAt === null ? null : iso(outAt), voided };
    if (JSON.stringify(before) === JSON.stringify(after)) throw validation("Nothing changed.");
    // Entering the real check-out resolves a missed one; the session then counts like any other.
    await q.query("update site_presence set check_in_at = $2, check_out_at = $3, voided = $4, missed_checkout = case when $3::timestamptz is null then missed_checkout else false end, version = version + 1 where id = $1",
      [s.id, iso(inAt), outAt === null ? null : iso(outAt), voided]);
    await record(q, s.id, voided && !s.voided ? "voided" : "corrected", before, after, d.reason, ctx.actor.id);
    await audit(q, { actorId: ctx.actor.id, action: "correct_site_presence", objectType: "site_presence", objectId: s.id, before, after, reason: d.reason, correlationId: ctx.correlationId });
    return { presenceId: s.id };
  });
}

/** Supervisor adds a session that was never punched (both times required, in the past, booked on the visit). */
export async function addPresence(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ employeeId: zId, visitId: zId, checkIn: zLocal, checkOut: zLocal, reason: zReason }), input);
  requireRole(ctx.actor, "supervisor", "site attendance corrections");
  forbidSelfApproval(ctx.actor, d.employeeId, "site attendance");
  return ctx.db.tx(async (q) => {
    const v = await one<{ project_id: string; timezone: string }>(q, "select v.project_id, p.timezone from visit v join project p on p.id = v.project_id where v.id = $1", [d.visitId], "Visit");
    await requireProjectScope(q, ctx.actor, v.project_id);
    const inAt = zonedToUtc(d.checkIn.date, d.checkIn.time, v.timezone), outAt = zonedToUtc(d.checkOut.date, d.checkOut.time, v.timezone);
    if (outAt <= inAt) throw validation("Check-out must be after check-in.");
    if (outAt > ctx.now) throw validation("A missing session can only be added for time that has passed.");
    const [booked] = await q.query("select 1 from reservation where visit_id = $1 and employee_id = $2 and state in ('held','confirmed','released') and span && tstzrange($3::timestamptz, $4::timestamptz) limit 1",
      [d.visitId, d.employeeId, iso(inAt), iso(outAt)]);
    if (!booked) throw validation("That person was not booked on this visit at that time.");
    const [s] = await q.query<{ id: string }>("insert into site_presence(employee_id, visit_id, project_id, check_in_at, check_out_at, source, created_by) values ($1,$2,$3,$4,$5,'correction',$6) returning id",
      [d.employeeId, d.visitId, v.project_id, iso(inAt), iso(outAt), ctx.actor.id]);
    await record(q, s!.id, "added", null, { checkIn: iso(inAt), checkOut: iso(outAt) }, d.reason, ctx.actor.id);
    await audit(q, { actorId: ctx.actor.id, action: "add_site_presence", objectType: "site_presence", objectId: s!.id, after: d, reason: d.reason, correlationId: ctx.correlationId });
    return { presenceId: s!.id };
  });
}
