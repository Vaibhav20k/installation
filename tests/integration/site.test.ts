import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { makeCtx } from "@/server/services/context";
import { addContact, addEffortDriver, exceptAppliance, saveAppliance, setQuantitySnapshot, substitute } from "@/server/services/site";
import { readinessGate } from "@/server/services/clearance";
import { AppError } from "@/server/errors";
import { actor, freshDb, idOf } from "./helpers";

const NOW = Date.parse("2026-10-16T06:00:00Z");
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };
let db: Db;
const as = async (bid: string) => makeCtx(db, await actor(db, bid), NOW);

beforeAll(async () => { db = await freshDb({ operational: true }); });
afterAll(async () => { await db.close(); });

describe("contacts and quantities", () => {
  it("one primary contact per account; adding a new primary demotes the old one", async () => {
    const p = await idOf(db, "project", "PRJ-004");
    await addContact(await as("EMP-001"), { projectId: p, name: "Ritu Kapoor", relationship: "Owner", isPrimary: true, phone: "+91 98100 00000" });
    await addContact(await as("EMP-001"), { projectId: p, name: "Amit Kapoor", relationship: "Spouse", isPrimary: true });
    const rows = await db.query<{ name: string; is_primary: boolean }>("select name, is_primary from customer_contact order by name");
    expect(rows).toEqual([{ name: "Amit Kapoor", is_primary: true }, { name: "Ritu Kapoor", is_primary: false }]);
  });

  it("net quantity must use the component's own kind and unit; gross is recorded separately (scenarios 36, 56)", async () => {
    const [c] = await db.query<{ id: string }>(`select c.id from component c join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id
      where o.business_id = 'ORD-005' and c.quantity_kind = 'counter_surface_area'`);
    expect(await kind(setQuantitySnapshot(await as("EMP-008"), { componentId: c!.id, basis: "net", quantity: "100", unit: "sqft", quantityKind: "kitchen_floor_area", source: "Drawing DRG-A" }))).toBe("validation");
    await setQuantitySnapshot(await as("EMP-008"), { componentId: c!.id, basis: "net", quantity: "100", unit: "sqft", quantityKind: "counter_surface_area", source: "Drawing DRG-A" });
    await setQuantitySnapshot(await as("EMP-008"), { componentId: c!.id, basis: "gross", quantity: "125", unit: "sqft", quantityKind: "counter_surface_area", wastageBasis: "Estimator sheet incl. wastage", source: "Estimator" });
    const s = await db.query<{ basis: string; quantity: string }>("select basis, quantity::float::text quantity from quantity_snapshot where component_id = $1 and is_current order by basis", [c!.id]);
    expect(s).toEqual([{ basis: "gross", quantity: "125" }, { basis: "net", quantity: "100" }]);
    await addEffortDriver(await as("EMP-008"), { componentId: c!.id, driver: "cutout", activity: "install", quantity: "2", unit: "count", quantityKind: "sink_cutout" });
    expect(await kind(addEffortDriver(await as("EMP-008"), { componentId: c!.id, driver: "cutout", activity: "install", quantity: "2", unit: "count", quantityKind: "sink_cutout" }))).toBe("conflict");
  });
});

describe("appliance readiness in the visit gate (scenario 57)", () => {
  it("a selected-only hob blocks the visit; a manager exception turns it into a recorded risk", async () => {
    const p = await idOf(db, "project", "PRJ-004");
    const v = await idOf(db, "visit", "VIS-006");
    const a = await saveAppliance(await as("EMP-008"), { projectId: p, appliance: "Hob", state: "selected", brandTechnician: "needed", dependsOn: "hob cut-out" });
    let g = await readinessGate(db, v, "2026-10-16");
    expect(g.blockers.some((b) => b.startsWith("Appliance: Hob"))).toBe(true);
    expect(await kind(exceptAppliance(await as("EMP-008"), { id: a.id, reason: "Customer installs later" }))).toBe("forbidden");
    await exceptAppliance(await as("EMP-001"), { id: a.id, reason: "Customer installs later with brand technician" });
    g = await readinessGate(db, v, "2026-10-16");
    expect(g.blockers.some((b) => b.startsWith("Appliance: Hob"))).toBe(false);
    expect(g.risks.some((b) => b.includes("Hob"))).toBe(true);
  });
});

describe("substitution (scenario 61)", () => {
  it("replacing a worker on day 4 keeps their first three days and books the replacement after checks", async () => {
    const v = await idOf(db, "visit", "VIS-006");
    const team = await db.query<{ employee_id: string; lo: number; hi: number }>("select employee_id, lower(span) lo, upper(span) hi from reservation where visit_id = $1 and state = 'confirmed' order by employee_id", [v]);
    const out = team[0]!;
    const [inc] = await db.query<{ id: string }>(`select e.id from employee e join employee_skill es on es.employee_id = e.id join skill s on s.id = es.skill_id
      where e.active and s.code = 'assembly' and es.verified and e.id <> all($1::uuid[])
        and not exists (select 1 from reservation r where r.employee_id = e.id and r.state in ('held','confirmed') and r.span && tstzrange('2026-10-17','2026-10-30'))
        and not exists (select 1 from leave_record l where l.employee_id = e.id) order by e.business_id limit 1`, [team.map((t) => t.employee_id)]);
    expect(await kind(substitute(await as("EMP-008"), { visitId: v, outgoingId: out.employee_id, incomingId: inc!.id, date: "2026-10-17", time: "09:00", reason: "Approved leave from day 4" }))).toBe("forbidden");
    // A colleague already booked on an overlapping visit cannot come in (database exclusion).
    const [busy] = await db.query<{ employee_id: string }>("select employee_id from reservation r join visit v on v.id = r.visit_id where v.business_id = 'VIS-005' and r.state = 'confirmed' limit 1");
    expect(await kind(substitute(await as("EMP-001"), { visitId: v, outgoingId: out.employee_id, incomingId: busy!.employee_id, date: "2026-10-21", time: "09:00", reason: "Trying an overlapping person" }))).toBe("conflict");
    const r = await substitute(await as("EMP-001"), { visitId: v, outgoingId: out.employee_id, incomingId: inc!.id, date: "2026-10-17", time: "09:00", reason: "Approved leave from day 4" });
    expect(r.id).toBeTruthy();
    const after = await db.query<{ employee_id: string; lo: number; hi: number }>("select employee_id, lower(span) lo, upper(span) hi from reservation where visit_id = $1 and employee_id = any($2::uuid[]) and state = 'confirmed'", [v, [out.employee_id, inc!.id]]);
    const o = after.find((x) => x.employee_id === out.employee_id)!, n = after.find((x) => x.employee_id === inc!.id)!;
    expect(Number(o.lo)).toBe(Number(out.lo));
    expect(Number(o.hi)).toBe(Date.parse("2026-10-17T09:00:00+05:30"));
    expect(Number(n.lo)).toBe(Date.parse("2026-10-17T09:00:00+05:30"));
    expect(Number(n.hi)).toBe(Number(out.hi));
    const progress = await db.query("select 1 from progress_event pe join visit_task vt on vt.id = pe.visit_task_id where vt.visit_id = $1", [v]);
    expect(progress.length).toBeGreaterThan(0);
  });
});
