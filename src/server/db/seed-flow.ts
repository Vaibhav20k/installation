/**
 * Demo department staff for the dispatch and complaint flows, and the demo kitchen's backsplash line (so the
 * D3a / D3b split can be tried). Fictional people, flagged is_demo. Idempotent: runs on every start of a demo
 * database, so an existing local database gains them too. Does nothing on a database without demo data.
 */
import type { Queryable } from "./client";

const STAFF: Array<[string, string, string, string]> = [
  // business id, name, permission role, department roles
  ["HUB-005", "Sunita M.", "manager", "management"],
  ["HUB-001", "Meena F.", "employee", "factory_dispatch"],
  ["HUB-002", "Arvind A.", "employee", "accounts"],
  ["HUB-003", "Kavita Q.", "employee", "qc"],
  ["HUB-004", "Rohit P.", "employee", "planning"],
  ["HUB-006", "Farhan S.", "employee", "store"],
  ["HUB-007", "Geeta P.", "employee", "purchase"],
  ["HUB-008", "Lokesh R.", "employee", "production"],
  ["HUB-009", "Tara K.", "employee", "packaging"],
];

export async function seedFlowDemo(q: Queryable) {
  const [demo] = await q.query<{ n: number }>("select count(*)::int n from employee where is_demo and business_id like 'EMP-%'");
  if (!demo?.n) return;
  const [cal] = await q.query<{ id: string }>("select id from work_calendar order by name limit 1");
  for (const [bid, name, perm] of STAFF) {
    await q.query(`insert into employee(business_id, name, job_role, permission_role, base_city, calendar_id, is_demo) values ($1,$2,'department_staff',$3,'Delhi',$4,true) on conflict (business_id) do nothing`,
      [bid, name, perm, cal?.id ?? null]);
  }
  // The management head is the reporting manager of the other department staff (team view).
  await q.query("update employee set manager_id = (select id from employee where business_id = 'HUB-005') where business_id like 'HUB-%' and business_id <> 'HUB-005' and manager_id is null and is_demo");
  for (const [bid, , , role] of STAFF) {
    await q.query("insert into flow_role_member(role_code, employee_id) select $1, id from employee where business_id = $2 and is_demo on conflict do nothing", [role, bid]);
  }
  // Installation Managers: the two demo project managers (each acts on the projects they manage).
  await q.query("insert into flow_role_member(role_code, employee_id) select 'installation_manager', id from employee where business_id in ('EMP-001','EMP-002') and is_demo on conflict do nothing");
  // Demo BOM lines get their dispatch group from the quantity kind (a real BOM import sets it from the factory).
  await q.query(`update component c set dispatch_group = case c.quantity_kind when 'carcass_count' then 'carcass' when 'shutter_count' then 'shutters' when 'counter_surface_area' then 'countertop' end
    from order_item oi join sales_order o on o.id = oi.order_id where oi.id = c.order_item_id and o.source_system = 'demo_fixture' and c.dispatch_group is null and c.quantity_kind in ('carcass_count','shutter_count','counter_surface_area')`);
  await q.query(`insert into component(business_id, order_item_id, name, quantity, unit, quantity_kind, drawing_version, dispatch_group)
    select 'CMP-BSP-001', oi.id, 'Backsplash', 18, 'sqft', 'counter_surface_area', 'DRG-A', 'backsplash'
    from order_item oi join sales_order o on o.id = oi.order_id where o.business_id = 'ORD-001' and o.source_system = 'demo_fixture' and oi.product_type = 'kitchen'
    on conflict (business_id) do nothing`);
}
