/**
 * Travel legs (outbound, inter-site, return) shared by participating employees (phase 5).
 * Legs must sit inside held/confirmed reservations; before staff are held they can set the itinerary.
 */
import { z } from "zod";
import { audit } from "../audit";
import { requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { ensureDraftRevision, loadVisit, visitSpan } from "./plan-support";
import { iso, one, parse, zId, type Ctx } from "./context";

const zTs = z.string().datetime({ offset: true });

export async function addTravelLeg(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    visitId: zId, kind: z.enum(["outbound", "inter_site", "return"]), origin: z.string().trim().min(2).max(120), destination: z.string().trim().min(2).max(120),
    plannedDepart: zTs, plannedArrive: zTs, certainty: z.enum(["tentative", "confirmed"]).default("tentative"), employeeIds: z.array(zId).max(12).optional(), changeReason: z.string().max(300).optional(),
  }), input);
  requireRole(ctx.actor, "supervisor", "travel planning");
  const dep = Date.parse(d.plannedDepart), arr = Date.parse(d.plannedArrive);
  if (!(arr > dep)) throw validation("Arrival must be after departure.");
  return ctx.db.tx(async (q) => {
    const v = await loadVisit(q, d.visitId, true);
    await requireProjectScope(q, ctx.actor, v.project_id);
    const staff = await q.query<{ employee_id: string; state: string; lo: number; hi: number }>(
      "select employee_id, state, lower(span) lo, upper(span) hi from reservation where visit_id = $1 and state in ('proposed','held','confirmed')", [d.visitId]);
    const participants = d.employeeIds?.length ? d.employeeIds : staff.map((s) => s.employee_id);
    if (!participants.length) throw validation("Choose the team before planning shared travel.");
    const unknown = participants.filter((p) => !staff.some((s) => s.employee_id === p));
    if (unknown.length) throw validation("Travellers must be staffed on this visit.");
    const live = staff.filter((s) => s.state !== "proposed");
    if (live.length) {
      // Booked occupancy already covers travel; a leg outside it needs a schedule revision so reservations move together.
      const outside = live.filter((s) => participants.includes(s.employee_id) && (dep < s.lo || arr > s.hi));
      if (outside.length) throw conflict("This leg falls outside the booked occupancy. Revise the visit schedule first so reservations move together.");
    } else {
      await ensureDraftRevision(q, ctx, v.plan_id, d.changeReason);
      const span = visitSpan(v);
      const start = Math.min(dep, v.departure_at ?? span?.start ?? dep), end = Math.max(arr, v.return_at ?? span?.end ?? arr);
      await q.query("update visit set departure_at = $2, return_at = $3, outstation = true, version = version + 1, updated_at = now() where id = $1", [d.visitId, iso(start), iso(end)]);
      await q.query("update reservation set span = tstzrange($2::timestamptz,$3::timestamptz) where visit_id = $1 and state = 'proposed'", [d.visitId, iso(start), iso(end)]);
    }
    const [n] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from travel_leg`);
    const bid = `TRV-${String(n!.n).padStart(3, "0")}`;
    const [leg] = await q.query<{ id: string }>(
      "insert into travel_leg(business_id, kind, origin, destination, planned_depart, planned_arrive, certainty) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [bid, d.kind, d.origin, d.destination, d.plannedDepart, d.plannedArrive, d.certainty]);
    for (const p of participants) await q.query("insert into travel_participant(leg_id, employee_id, visit_id) values ($1,$2,$3)", [leg!.id, p, d.visitId]);
    const res = await q.query<{ id: string }>("select id from reservation where visit_id = $1 and employee_id = any($2::uuid[]) and state in ('held','confirmed')", [d.visitId, participants]);
    for (const r of res) await q.query("insert into reservation_activity(reservation_id, kind, span) values ($1,'travel',tstzrange($2::timestamptz,$3::timestamptz))", [r.id, d.plannedDepart, d.plannedArrive]);
    await audit(q, { actorId: ctx.actor.id, action: "add_travel_leg", objectType: "travel_leg", objectId: leg!.id, after: { ...d, participants }, correlationId: ctx.correlationId });
    return { id: leg!.id, businessId: bid };
  });
}

export async function recordTravelActual(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ legId: zId, actualDepart: zTs.optional(), actualArrive: zTs.optional(), certainty: z.enum(["tentative", "confirmed"]).optional() }), input);
  requireRole(ctx.actor, "supervisor", "travel updates");
  if (d.actualDepart && d.actualArrive && Date.parse(d.actualArrive) <= Date.parse(d.actualDepart)) throw validation("Actual arrival must be after actual departure.");
  return ctx.db.tx(async (q) => {
    const leg = await one<{ project_id: string }>(q,
      "select v.project_id from travel_participant tp join visit v on v.id = tp.visit_id where tp.leg_id = $1 limit 1", [d.legId], "Travel leg");
    await requireProjectScope(q, ctx.actor, leg.project_id);
    await q.query("update travel_leg set actual_depart = coalesce($2, actual_depart), actual_arrive = coalesce($3, actual_arrive), certainty = coalesce($4, certainty) where id = $1",
      [d.legId, d.actualDepart ?? null, d.actualArrive ?? null, d.certainty ?? null]);
    await audit(q, { actorId: ctx.actor.id, action: "travel_actual", objectType: "travel_leg", objectId: d.legId, after: d, correlationId: ctx.correlationId });
  });
}
