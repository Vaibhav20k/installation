/** Site and readiness view for one project: contacts, quantities, effort drivers, permitted window, appliances. */
import type { Queryable } from "../db/client";
import { requireProjectScope, type Actor } from "../auth/permissions";
import { applianceBlockers, driverEffort, effortQuantity, siteCapacity } from "@/domain/site";
import type { ProductivityRate } from "@/domain/effort";

export async function siteDetail(q: Queryable, actor: Actor, projectId: string, crewSize = 3) {
  await requireProjectScope(q, actor, projectId);
  const [contacts, components, snaps, drivers, rates, restriction, appliances, items, subs] = await Promise.all([
    q.query<{ id: string; name: string; relationship: string; is_primary: boolean; phone: string | null; email: string | null; note: string | null }>(
      "select c.id, c.name, c.relationship, c.is_primary, c.phone, c.email, c.note from customer_contact c join project p on p.customer_id = c.customer_id where p.id = $1 and c.active order by c.is_primary desc, c.name", [projectId]),
    q.query<{ id: string; business_id: string; name: string; quantity: string; unit: string; quantity_kind: string; item: string }>(
      `select c.id, c.business_id, c.name, c.quantity::text, c.unit, c.quantity_kind, oi.name item from component c join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id
       where o.project_id = $1 order by c.business_id`, [projectId]),
    q.query<{ component_id: string; basis: "net" | "gross"; quantity: string; unit: string; quantity_kind: string; wastage_basis: string | null; source: string; source_revision: string | null }>(
      `select s.component_id, s.basis, s.quantity::text, s.unit, s.quantity_kind, s.wastage_basis, s.source, s.source_revision from quantity_snapshot s join component c on c.id = s.component_id
       join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id where o.project_id = $1 and s.is_current`, [projectId]),
    q.query<{ id: string; component_id: string; driver: string; activity: string; quantity: string; unit: string; quantity_kind: string; note: string | null }>(
      `select d.id, d.component_id, d.driver, d.activity, d.quantity::text, d.unit, d.quantity_kind, d.note from effort_driver d join component c on c.id = d.component_id
       join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id where o.project_id = $1 order by d.created_at`, [projectId]),
    q.query<{ id: string; activity: string; quantity_kind: string; unit: string; basis: ProductivityRate["basis"]; value: string; crew_size: number | null; net_day_minutes: number | null; status: ProductivityRate["status"]; version: number; business_id: string }>(
      "select id, business_id, activity, quantity_kind, unit, basis, value::text, crew_size, net_day_minutes, status, version from productivity_rate where effective_to is null"),
    q.query<{ allowed_weekdays: number[]; start_time: string; end_time: string; restricted_activities: string[]; valid_from: string | null; valid_to: string | null; note: string | null }>(
      "select allowed_weekdays, start_time::text, end_time::text, restricted_activities, valid_from::text, valid_to::text, note from site_restriction where project_id = $1 and active limit 1", [projectId]),
    q.query<{ id: string; appliance: string; state: string; brand_technician: string; install_scope: string | null; depends_on: string | null; exception_reason: string | null; item: string | null; version: number }>(
      "select a.id, a.appliance, a.state, a.brand_technician, a.install_scope, a.depends_on, a.exception_reason, oi.name item, a.version from appliance_dependency a left join order_item oi on oi.id = a.order_item_id where a.project_id = $1 order by a.appliance", [projectId]),
    q.query<{ id: string; label: string }>("select oi.id, o.business_id || ' · ' || oi.name label from order_item oi join sales_order o on o.id = oi.order_id where o.project_id = $1 order by o.business_id", [projectId]),
    q.query<{ id: string; visit: string; outgoing: string; incoming: string; effective_at: number; reason: string; by: string }>(
      `select s.id, v.business_id visit, eo.name outgoing, ei.name incoming, s.effective_at, s.reason, e.name by from substitution s join visit v on v.id = s.visit_id join employee eo on eo.id = s.outgoing_employee_id
       join employee ei on ei.id = s.incoming_employee_id join employee e on e.id = s.created_by where v.project_id = $1 order by s.effective_at desc`, [projectId]),
  ]);
  const rateList: ProductivityRate[] = rates.map((r) => ({ id: `${r.business_id} v${r.version}`, activity: r.activity, quantityKind: r.quantity_kind, unit: r.unit, basis: r.basis, value: r.value,
    crewSize: r.crew_size, netDayMinutes: r.net_day_minutes, status: r.status, version: r.version }));
  const perComponent = components.map((c) => {
    const s = snaps.filter((x) => x.component_id === c.id).map((x) => ({ basis: x.basis, quantity: x.quantity, unit: x.unit, quantityKind: x.quantity_kind, wastage: x.wastage_basis, source: x.source, revision: x.source_revision }));
    const effortBasis = effortQuantity(s);
    const drv = drivers.filter((x) => x.component_id === c.id).map((x) => ({ id: x.id, driver: x.driver, activity: x.activity, quantity: x.quantity, unit: x.unit, quantityKind: x.quantity_kind }));
    return { ...c, snapshots: s, effortBasis, drivers: drv, effort: driverEffort(drv, rateList) };
  });
  const r = restriction[0];
  const totalDriverMinutes = perComponent.reduce((n, c) => n + c.effort.knownMinutes, 0);
  const capacity = siteCapacity(r ? { allowedWeekdays: r.allowed_weekdays, startTime: r.start_time, endTime: r.end_time, restrictedActivities: r.restricted_activities } : null, totalDriverMinutes, crewSize);
  const ap = applianceBlockers(appliances.map((a) => ({ appliance: a.appliance, state: a.state, brandTechnician: a.brand_technician, exceptionReason: a.exception_reason, dependsOn: a.depends_on })));
  return { contacts, components: perComponent, restriction: r ?? null, capacity, crewSize, totalDriverMinutes, appliances, applianceBlockers: ap, items, substitutions: subs };
}
