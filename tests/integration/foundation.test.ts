import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { toAppError } from "@/server/errors";
import { freshDb } from "./helpers";

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db?.close(); });

describe("seed and schema", () => {
  it("has 40 demo employees, 3 managers, every job role and multiple cities", async () => {
    const [c] = await db.query<{ n: number; m: number; roles: number; cities: number; demo: number }>(
      `select count(*)::int n, count(*) filter (where permission_role='manager')::int m, count(distinct job_role)::int roles,
              count(distinct base_city)::int cities, count(*) filter (where is_demo)::int demo from employee where job_role <> 'department_staff'`);
    expect(c).toEqual({ n: 40, m: 3, roles: 10, cities: 5, demo: 40 });
    // Plus the demo department staff of the dispatch flow (factory, accounts, QC ...), never on crew lists.
    const [d] = await db.query<{ n: number }>("select count(*)::int n from employee where job_role = 'department_staff' and is_demo");
    expect(d!.n).toBe(9);
  });

  it("scenario 1: one customer has two projects and one project has two orders", async () => {
    const rows = await db.query<{ projects: number }>(`select count(*)::int projects from project p join customer c on c.id = p.customer_id where c.business_id = 'CUS-001'`);
    expect(rows[0]!.projects).toBe(2);
    const [o] = await db.query<{ n: number }>(`select count(*)::int n from sales_order o join project p on p.id = o.project_id where p.business_id = 'PRJ-001'`);
    expect(o!.n).toBe(2);
  });

  it("keeps kitchen floor area separate from component installation quantity", async () => {
    const [p] = await db.query<{ kitchen_floor_area: string }>(`select kitchen_floor_area from project where business_id='PRJ-001'`);
    const [c] = await db.query<{ quantity: string; quantity_kind: string }>(`select quantity, quantity_kind from component where name = 'Cabinet surface'`);
    expect(p!.kitchen_floor_area).toBe("620.000000");
    expect(c!.quantity_kind).toBe("cabinet_surface_area");
  });

  it("rejects invalid relationships and values at the database", async () => {
    const bad = async (sql: string) => {
      try { await db.query(sql); return null; } catch (e) { return toAppError(e).kind; }
    };
    expect(await bad(`insert into productivity_rate(business_id, version, activity, quantity_kind, unit, basis, value, status, effective_from, net_day_minutes) values ('X',1,'a','k','u','employee_day',0,'draft','2026-01-01',480)`)).toBe("validation");
    expect(await bad(`insert into component(business_id, order_item_id, name, quantity, unit, quantity_kind) values ('C-X', gen_random_uuid(), 'x', 1, 'u', 'k')`)).toBe("validation");
    expect(await bad(`insert into component(business_id, order_item_id, name, quantity, unit, quantity_kind) select 'C-Y', id, 'x', -1, 'u', 'k' from order_item limit 1`)).toBe("validation");
  });

  it("audit events are append-only", async () => {
    await db.query(`insert into audit_event(action, object_type, object_id, correlation_id) values ('test','x','1','c')`);
    await expect(db.query(`update audit_event set action = 'changed'`)).rejects.toThrow();
    await expect(db.query(`delete from audit_event`)).rejects.toThrow();
  });

  it("returns dates as local date strings and timestamps as epoch ms", async () => {
    const [r] = await db.query<{ d: string; t: number; n: string; big: number }>(`select '2026-10-25'::date d, '2026-10-25T04:30:00Z'::timestamptz t, 1.5::numeric n, 9000000000::bigint big`);
    expect(r).toEqual({ d: "2026-10-25", t: Date.UTC(2026, 9, 25, 4, 30), n: "1.5", big: 9000000000 });
  });
});
