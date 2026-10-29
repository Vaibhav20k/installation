/**
 * Customer contacts, quantity snapshots, effort drivers, site restrictions, appliance dependencies and
 * staff substitution. Every write checks project scope and leaves an audit record.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { zonedToUtc } from "@/lib/dates";
import { loadVisit, visitSpan } from "./plan-support";
import { visitCoverage } from "./booking";
import { bumpVersion, iso, one, parse, zDate, zId, zQty, zTime, zVersion, type Ctx } from "./context";

async function projectOfComponent(q: Queryable, componentId: string) {
  return (await one<{ project_id: string }>(q, `select o.project_id from component c join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id where c.id = $1`, [componentId], "Component")).project_id;
}

export async function addContact(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, name: z.string().min(2).max(120), relationship: z.string().min(2).max(60), isPrimary: z.boolean().default(false),
    phone: z.string().regex(/^[0-9+()\- ]{6,20}$/).optional(), email: z.string().email().optional(), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "customer contacts");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    const { customer_id } = await one<{ customer_id: string }>(q, "select customer_id from project where id = $1", [d.projectId], "Project");
    if (d.isPrimary) await q.query("update customer_contact set is_primary = false where customer_id = $1 and is_primary", [customer_id]);
    const [c] = await q.query<{ id: string }>("insert into customer_contact(customer_id, name, relationship, is_primary, phone, email, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [customer_id, d.name, d.relationship, d.isPrimary, d.phone ?? null, d.email ?? null, d.note ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "add_contact", objectType: "customer_contact", objectId: c!.id, after: { name: d.name, relationship: d.relationship, isPrimary: d.isPrimary }, correlationId: ctx.correlationId });
    return { id: c!.id };
  });
}

export async function setQuantitySnapshot(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ componentId: zId, basis: z.enum(["net", "gross"]), quantity: zQty, unit: z.string().min(1).max(20), quantityKind: z.string().min(2).max(60),
    wastageBasis: z.string().max(200).optional(), source: z.string().min(2).max(80), sourceRevision: z.string().max(40).optional() }), input);
  requireRole(ctx.actor, "supervisor", "quantity snapshots");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, await projectOfComponent(q, d.componentId));
    const comp = await one<{ quantity_kind: string; unit: string }>(q, "select quantity_kind, unit from component where id = $1", [d.componentId], "Component");
    if (d.basis === "net" && (comp.quantity_kind !== d.quantityKind || comp.unit !== d.unit)) {
      throw validation(`Net quantity must use the component's quantity kind and unit (${comp.quantity_kind}, ${comp.unit}). Same unit alone is not enough.`);
    }
    await q.query("update quantity_snapshot set is_current = false where component_id = $1 and basis = $2 and is_current", [d.componentId, d.basis]);
    const [s] = await q.query<{ id: string }>(`insert into quantity_snapshot(component_id, basis, quantity, unit, quantity_kind, wastage_basis, source, source_revision, recorded_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [d.componentId, d.basis, d.quantity, d.unit, d.quantityKind, d.wastageBasis ?? null, d.source, d.sourceRevision ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "quantity_snapshot", objectType: "component", objectId: d.componentId, after: d, correlationId: ctx.correlationId });
    return { id: s!.id };
  });
}

export async function addEffortDriver(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ componentId: zId, driver: z.enum(["area", "linear", "cutout", "joint", "trim", "island", "lighting", "drawer", "handling", "other"]),
    activity: z.string().min(2).max(40), quantity: zQty, unit: z.string().min(1).max(20), quantityKind: z.string().min(2).max(60), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "effort drivers");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, await projectOfComponent(q, d.componentId));
    const [dup] = await q.query("select 1 from effort_driver where component_id = $1 and driver = $2 and activity = $3", [d.componentId, d.driver, d.activity]);
    if (dup) throw conflict("This driver and activity are already recorded for the component; edit the existing one rather than adding the same work twice.");
    const [e] = await q.query<{ id: string }>("insert into effort_driver(component_id, driver, activity, quantity, unit, quantity_kind, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [d.componentId, d.driver, d.activity, d.quantity, d.unit, d.quantityKind, d.note ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "add_effort_driver", objectType: "component", objectId: d.componentId, after: d, correlationId: ctx.correlationId });
    return { id: e!.id };
  });
}

export async function setSiteRestriction(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, allowedWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), startTime: zTime, endTime: zTime,
    restrictedActivities: z.array(z.string().max(40)).max(10).default([]), validFrom: zDate.optional(), validTo: zDate.optional(), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "site restrictions");
  if (d.endTime <= d.startTime) throw validation("The permitted window must end after it starts.");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    await q.query("update site_restriction set active = false where project_id = $1 and active", [d.projectId]);
    const [r] = await q.query<{ id: string }>(`insert into site_restriction(project_id, allowed_weekdays, start_time, end_time, restricted_activities, valid_from, valid_to, note, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [d.projectId, d.allowedWeekdays, d.startTime, d.endTime, d.restrictedActivities, d.validFrom ?? null, d.validTo ?? null, d.note ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "site_restriction", objectType: "project", objectId: d.projectId, after: d, correlationId: ctx.correlationId });
    return { id: r!.id };
  });
}

export async function saveAppliance(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ id: zId.optional(), version: zVersion.optional(), projectId: zId, orderItemId: zId.optional(), appliance: z.string().min(2).max(80),
    state: z.enum(["selected", "spec_final", "on_site", "inspected"]), brandTechnician: z.enum(["not_needed", "needed", "booked", "unavailable"]),
    installScope: z.string().max(200).optional(), dependsOn: z.string().max(200).optional() }), input);
  requireRole(ctx.actor, "supervisor", "appliance readiness");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    if (d.orderItemId) await one(q, "select 1 from order_item oi join sales_order o on o.id = oi.order_id where oi.id = $1 and o.project_id = $2", [d.orderItemId, d.projectId], "Order item on this project");
    if (d.id) {
      await bumpVersion(q, "appliance_dependency", d.id, d.version ?? 0);
      await q.query(`update appliance_dependency set appliance = $2, state = $3, brand_technician = $4, install_scope = $5, depends_on = $6, order_item_id = $7, updated_at = now(), updated_by = $8 where id = $1 and project_id = $9`,
        [d.id, d.appliance, d.state, d.brandTechnician, d.installScope ?? null, d.dependsOn ?? null, d.orderItemId ?? null, ctx.actor.id, d.projectId]);
      await audit(q, { actorId: ctx.actor.id, action: "update_appliance", objectType: "appliance_dependency", objectId: d.id, after: d, correlationId: ctx.correlationId });
      return { id: d.id };
    }
    const [a] = await q.query<{ id: string }>(`insert into appliance_dependency(project_id, order_item_id, appliance, state, brand_technician, install_scope, depends_on, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [d.projectId, d.orderItemId ?? null, d.appliance, d.state, d.brandTechnician, d.installScope ?? null, d.dependsOn ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "add_appliance", objectType: "appliance_dependency", objectId: a!.id, after: d, correlationId: ctx.correlationId });
    return { id: a!.id };
  });
}

/** A manager may let work proceed despite an appliance gap; the dependency and its repeat-visit risk stay visible. */
export async function exceptAppliance(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ id: zId, reason: z.string().min(5).max(300) }), input);
  requireRole(ctx.actor, "manager", "appliance readiness exceptions");
  return ctx.db.tx(async (q) => {
    const a = await one<{ project_id: string }>(q, "select project_id from appliance_dependency where id = $1 for update", [d.id], "Appliance");
    await requireProjectScope(q, ctx.actor, a.project_id);
    await q.query("update appliance_dependency set exception_reason = $2, exception_by = $3, updated_at = now(), version = version + 1 where id = $1", [d.id, d.reason, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "appliance_exception", objectType: "appliance_dependency", objectId: d.id, reason: d.reason, correlationId: ctx.correlationId });
    return { id: d.id };
  });
}

/**
 * Replace one crew member from an effective moment. The outgoing person's reservation ends there (their earlier
 * days and time stay theirs); the incoming person's starts there, through the same booking checks: overlap
 * (database exclusion), approved leave, and the visit's skill coverage after the change.
 */
export async function substitute(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, outgoingId: zId, incomingId: zId, date: zDate, time: zTime, reason: z.string().min(5).max(300) }), input);
  requireRole(ctx.actor, "manager", "substitution");
  if (d.outgoingId === d.incomingId) throw validation("Choose a different incoming employee.");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId, true);
    await requireProjectScope(q, ctx.actor, v.project_id);
    if (!["scheduled", "in_progress", "on_hold"].includes(v.exec_status)) throw conflict(`Substitution applies to booked visits (this one is ${v.exec_status}).`);
    const requested = zonedToUtc(d.date, d.time, v.timezone);
    const out = await one<{ id: string; role: string; state: string; lo: number; hi: number }>(q,
      `select id, role, state, lower(span) lo, upper(span) hi from reservation where visit_id = $1 and employee_id = $2 and state in ('held','confirmed')
       order by upper(span) desc limit 1 for update`, [d.visitId, d.outgoingId], "Outgoing reservation");
    if (requested >= Number(out.hi)) throw validation("That time is after the outgoing person's booking ends; there is nothing left to replace.");
    // Before the booking starts (someone cannot join at all), the replacement takes the whole booking.
    const whole = requested <= Number(out.lo);
    const at = whole ? Number(out.lo) : requested;
    const [inc] = await q.query<{ active: boolean }>("select active from employee where id = $1", [d.incomingId]);
    if (!inc?.active) throw validation("The incoming employee is not active.");
    const leave = await q.query("select 1 from leave_record where employee_id = $1 and status = 'approved' and span && tstzrange($2::timestamptz,$3::timestamptz) limit 1", [d.incomingId, iso(at), iso(Number(out.hi))]);
    if (leave.length) throw conflict("The incoming employee has approved leave during the remaining booking.");
    if (whole) {
      await q.query("update reservation set state = 'released', version = version + 1 where id = $1", [out.id]);
    } else {
      await q.query("update reservation set span = tstzrange(lower(span), $2::timestamptz), version = version + 1 where id = $1", [out.id, iso(at)]);
      await q.query("update reservation_activity set span = tstzrange(lower(span), least(upper(span), $2::timestamptz)) where reservation_id = $1 and lower(span) < $2::timestamptz", [out.id, iso(at)]);
      await q.query("delete from reservation_activity where reservation_id = $1 and lower(span) >= $2::timestamptz", [out.id, iso(at)]);
    }
    const [r] = await q.query<{ id: string }>("insert into reservation(visit_id, employee_id, role, span, state, created_by) values ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz),$6,$7) returning id",
      [d.visitId, d.incomingId, out.role, iso(at), iso(Number(out.hi)), out.state, ctx.actor.id]);
    await q.query("insert into reservation_activity(reservation_id, kind, span) values ($1,'work',tstzrange($2::timestamptz,$3::timestamptz))", [r!.id, iso(at), iso(Number(out.hi))]);
    const cov = await visitCoverage(q, d.visitId, { activeAt: at });
    if (!cov.met) throw validation("After this change the team no longer meets the visit's skill requirements.", cov.problems);
    const [s] = await q.query<{ id: string }>(`insert into substitution(visit_id, outgoing_employee_id, incoming_employee_id, effective_at, reason, outgoing_reservation_id, incoming_reservation_id, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [d.visitId, d.outgoingId, d.incomingId, iso(at), d.reason, out.id, r!.id, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "substitute", objectType: "visit", objectId: d.visitId, after: { outgoing: d.outgoingId, incoming: d.incomingId, effective: iso(at) }, reason: d.reason, correlationId: ctx.correlationId });
    return { id: s!.id, effectiveAt: at, wholeBooking: whole };
  });
}

/**
 * Add a crew member to a visit (plans needing more than the planned headcount). Booked visits get a booking of
 * the same state from the chosen moment to the end, through the same overlap and leave checks; the visit's team
 * size grows to match. Unscheduled visits get a proposed (non-blocking) booking for the planned dates.
 */
export async function addCrewMember(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, employeeId: zId, date: zDate, time: zTime, reason: z.string().min(3).max(300) }), input);
  requireRole(ctx.actor, "manager", "adding crew");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId, true);
    await requireProjectScope(q, ctx.actor, v.project_id);
    if (["completed", "closed", "cancelled"].includes(v.exec_status)) throw conflict(`This visit is ${v.exec_status}.`);
    const span = visitSpan(v);
    if (!span) throw validation("Set the visit's planned dates first.");
    const [emp] = await q.query<{ active: boolean; job_role: string }>("select active, job_role from employee where id = $1", [d.employeeId]);
    if (!emp?.active) throw validation("That employee is not active.");
    const team = await q.query<{ employee_id: string; state: string }>("select employee_id, state from reservation where visit_id = $1 and state in ('proposed','held','confirmed') and upper(span) > $2::timestamptz", [d.visitId, iso(ctx.now)]);
    if (team.some((t) => t.employee_id === d.employeeId)) throw conflict("That person is already on this visit.");
    const booked = ["scheduled", "in_progress", "on_hold"].includes(v.exec_status);
    const start = booked ? Math.max(zonedToUtc(d.date, d.time, v.timezone), span.start) : span.start;
    if (start >= span.end) throw validation("That time is after the visit ends.");
    const leave = await q.query("select 1 from leave_record where employee_id = $1 and status = 'approved' and span && tstzrange($2::timestamptz,$3::timestamptz) limit 1", [d.employeeId, iso(start), iso(span.end)]);
    if (leave.length) throw conflict("That employee has approved leave during the visit.");
    const state = booked ? (team.find((t) => t.state === "confirmed") ? "confirmed" : "held") : "proposed";
    const [r] = await q.query<{ id: string }>(`insert into reservation(visit_id, employee_id, role, span, state, hold_expires_at, created_by) values ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz),$6,$7,$8) returning id`,
      [d.visitId, d.employeeId, emp.job_role, iso(start), iso(span.end), state, state === "held" ? iso(ctx.now + 48 * 3_600_000) : null, ctx.actor.id]);
    if (state === "confirmed") await q.query("insert into reservation_activity(reservation_id, kind, span) values ($1,'work',tstzrange($2::timestamptz,$3::timestamptz))", [r!.id, iso(start), iso(span.end)]);
    const size = team.length + 1;
    if (size > 12) throw validation("A visit team can have at most 12 people.");
    await q.query("update visit set team_size = greatest(team_size, $2), version = version + 1, updated_at = now() where id = $1", [d.visitId, size]);
    await audit(q, { actorId: ctx.actor.id, action: "add_crew", objectType: "visit", objectId: d.visitId, after: { employee: d.employeeId, from: iso(start), state }, reason: d.reason, correlationId: ctx.correlationId });
    return { id: r!.id, state, teamSize: Math.max(v.team_size, size) };
  });
}

/**
 * Pin a site on the installations map. Managers and above, for projects in their scope; the coordinates come from
 * the person (a click on the map, pasted coordinates or a map link), never from guessing the address. Null clears it.
 */
export async function setSiteLocation(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    projectId: zId,
    location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable(),
  }), input);
  requireRole(ctx.actor, "manager", "setting a site location");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    const before = await one<{ latitude: number | null; longitude: number | null }>(q, "select latitude::float, longitude::float from project where id = $1 for update", [d.projectId], "Project");
    const lat = d.location ? Math.round(d.location.latitude * 1e6) / 1e6 : null, lng = d.location ? Math.round(d.location.longitude * 1e6) / 1e6 : null;
    await q.query("update project set latitude = $2, longitude = $3, location_set_at = case when $2::numeric is null then null else now() end, location_set_by = case when $2::numeric is null then null else $4::uuid end, updated_at = now() where id = $1",
      [d.projectId, lat, lng, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "set_site_location", objectType: "project", objectId: d.projectId, before, after: { latitude: lat, longitude: lng }, correlationId: ctx.correlationId });
    return { latitude: lat, longitude: lng };
  });
}
