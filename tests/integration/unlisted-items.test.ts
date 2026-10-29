/**
 * Receipt with items that are not on the factory's list (owner request, 28 Oct 2026). The Installation Manager
 * reports a missing or damaged item by name, quantity, product type and priority; it is added to the order as an
 * unlisted BOM line on this dispatch and runs the same complaint flow, up to the replacement closing it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createDispatch, insertDispatch, receiveDispatch } from "@/server/services/dispatch";
import { loadDefinition } from "@/server/services/flow-core";
import { complaintDetail, dispatchDetail, dispatchableOrders } from "@/server/queries/dispatch";
import { UNLISTED_ORDER_ITEM } from "@/domain/unlisted-items";
import { actor, freshDb, idOf } from "./helpers";
import { NOW, PEOPLE, errKind, errText, flowKit } from "./flow-helpers";

let db: Db;
const k = flowKit(() => db);
let order = "", carcass = "", shutters = "", project = "";

beforeAll(async () => {
  db = await freshDb();
  order = await idOf(db, "sales_order", "ORD-001");
  carcass = await idOf(db, "component", "CMP-001");
  shutters = await idOf(db, "component", "CMP-002");
  project = (await db.query<{ project_id: string }>("select project_id from sales_order where id = $1", [order]))[0]!.project_id;
}, 240_000);
afterAll(async () => { await db?.close(); });

const create = async (items: Array<[string, string]>, types = ["D1"]) =>
  (await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId: order, types, factory: "Main factory", items: items.map(([componentId, quantity]) => ({ componentId, quantity })) })).dispatchId;

/** A dispatch the factory sent before adding its item list (no BOM lines). */
async function createWithoutList() {
  const ctx = await k.as(PEOPLE.factory_dispatch);
  const { def, version } = await loadDefinition(db, "dispatch");
  return (await insertDispatch(db, ctx, def, version, { orderId: order, projectId: project, types: ["D1"], factory: "Main factory", replacementFor: null, items: [] })).dispatchId;
}

async function item(over: Record<string, unknown> = {}) {
  return { name: "Soft-close hinge", quantity: "4", unit: "pcs", kind: "missing", priority: "high", productType: "hardware", reason: "Not in any box", photoDraftKey: await k.upload(PEOPLE.installation_manager), ...over };
}

async function receive(id: string, extra: Record<string, unknown>, bid: string = PEOPLE.installation_manager, allOk = true) {
  const s = await k.state(id);
  const ls = await k.lines(id);
  return receiveDispatch(await k.as(bid), { dispatchId: id, version: s.version, stage: s.stage, lines: allOk ? ls.map((l) => ({ itemId: l.id, ok: true })) : [], ...extra });
}

const count = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(sql, p))[0]!.n;

let unlistedComplaint = "", withList = "";
describe("an item not on the factory list", () => {
  it("is added to the order as an unlisted line on this dispatch and opens a complaint at QC review with its priority", async () => {
    withList = await create([[carcass, "4"]]);
    await k.toSite(withList);
    const r = await receive(withList, { unlisted: [await item()] });
    expect(r.complaints).toHaveLength(1);
    unlistedComplaint = r.complaints[0]!.id;

    const [c] = await db.query<{ unlisted: boolean; product_type: string; name: string; unit: string; quantity: string; dispatch_group: string; oi_type: string; oi_name: string; business_id: string; order_id: string }>(
      `select c.unlisted, c.product_type, c.name, c.unit, c.quantity::float::text quantity, c.dispatch_group, oi.product_type oi_type, oi.name oi_name, c.business_id, oi.order_id
       from complaint k join component c on c.id = k.component_id join order_item oi on oi.id = c.order_item_id where k.id = $1`, [unlistedComplaint]);
    expect(c).toMatchObject({ unlisted: true, product_type: "hardware", name: "Soft-close hinge", unit: "pcs", quantity: "4", dispatch_group: "other", oi_type: UNLISTED_ORDER_ITEM.productType, oi_name: UNLISTED_ORDER_ITEM.name, order_id: order });
    expect(c!.business_id).toMatch(/^CMP-\d{3,}$/);

    const [di] = await db.query<{ received_ok: boolean; quantity: string; dispatch_id: string }>(
      "select di.received_ok, di.quantity::float::text quantity, di.dispatch_id from complaint k join dispatch_item di on di.id = k.dispatch_item_id where k.id = $1", [unlistedComplaint]);
    expect(di).toEqual({ received_ok: false, quantity: "4", dispatch_id: withList });

    const cs = await k.cstate(unlistedComplaint);
    expect(cs.stage).toBe("qc_review");
    const [p] = await db.query<{ priority: string; kind: string }>("select priority, kind from complaint where id = $1", [unlistedComplaint]);
    expect(p).toEqual({ priority: "high", kind: "missing" });
    expect(await k.state(withList)).toMatchObject({ stage: "installation_started", partial: true });
    // QC is told, and the photo is on the complaint's opening record.
    const [n] = await db.query<{ n: number }>("select count(*)::int n from notification n join employee e on e.id = n.employee_id where e.business_id = $1 and n.href = $2", [PEOPLE.qc, `/dispatch/complaints/${unlistedComplaint}`]);
    expect(n!.n).toBe(1);
    expect(await count("select count(*)::int n from evidence_link l join stage_history h on h.id = l.parent_id where h.subject_id = $1", [unlistedComplaint])).toBe(1);
  });

  it("shows priority, product type and the not-on-list tag to the factory steps and on the dispatch", async () => {
    const kd = (await complaintDetail(db, await actor(db, PEOPLE.qc), unlistedComplaint, NOW))!;
    expect(kd).toMatchObject({ priority: "high", unlisted: true, product_type: "hardware", item: "Soft-close hinge" });
    const dd = (await dispatchDetail(db, await actor(db, PEOPLE.installation_manager), withList, NOW))!;
    expect(dd.items.find((i) => i.unlisted)).toMatchObject({ name: "Soft-close hinge", product_type: "hardware", received_ok: false });
    expect(dd.complaints[0]).toMatchObject({ priority: "high", unlisted: true });
  });

  it("is never offered to the factory as a line to dispatch", async () => {
    const o = await dispatchableOrders(db, await actor(db, PEOPLE.factory_dispatch));
    expect(o.orders.find((x) => x.id === order)!.lines.some((l) => l.name === "Soft-close hinge")).toBe(false);
  });

  it("takes an optional priority on a factory-list line too, and mixes both in one receipt", async () => {
    const d = await create([[shutters, "4"]], ["D2"]);
    await k.toSite(d);
    const s = await k.state(d);
    const [l] = await k.lines(d);
    const r = await receiveDispatch(await k.as(PEOPLE.installation_manager), {
      dispatchId: d, version: s.version, stage: s.stage,
      lines: [{ itemId: l!.id, ok: false, kind: "damaged", quantity: "1", reason: "Edge chipped", priority: "urgent", photoDraftKey: await k.upload(PEOPLE.installation_manager) }],
      unlisted: [await item({ name: "Handle set", productType: "accessory", priority: undefined, kind: "damaged", quantity: "2", unit: "set" })],
    });
    expect(r.complaints).toHaveLength(2);
    const rows = await db.query<{ priority: string; unlisted: boolean }>("select k.priority, c.unlisted from complaint k join component c on c.id = k.component_id where k.dispatch_id = $1 order by c.unlisted", [d]);
    expect(rows).toEqual([{ priority: "urgent", unlisted: false }, { priority: "normal", unlisted: true }]);
    // One "unlisted items" order item per order, reused.
    expect(await count("select count(*)::int n from order_item where order_id = $1 and product_type = $2", [order, UNLISTED_ORDER_ITEM.productType])).toBe(1);
  });
});

describe("a dispatch whose item list the factory has not added", () => {
  it("needs at least one reported item or an explicit 'nothing missing'", async () => {
    const d = await createWithoutList();
    await k.toSite(d);
    expect(await errText(receive(d, {}))).toMatch(/^validation: .*(nothing is missing|report)/i);
    expect((await k.state(d)).stage).toBe("received");
    await receive(d, { nothingMissing: true });
    expect(await k.state(d)).toMatchObject({ stage: "installation_started", partial: false });
  });

  it("opens a complaint for an item reported without a list", async () => {
    const d = await createWithoutList();
    await k.toSite(d);
    const r = await receive(d, { unlisted: [await item({ name: "Corner carcass", productType: "carcass", priority: "urgent", kind: "damaged", quantity: "1" })] });
    expect(r.complaints).toHaveLength(1);
    const [c] = await db.query<{ dispatch_group: string; priority: string; stage: string }>("select c.dispatch_group, k.priority, k.stage from complaint k join component c on c.id = k.component_id where k.id = $1", [r.complaints[0]!.id]);
    expect(c).toEqual({ dispatch_group: "carcass", priority: "urgent", stage: "qc_review" });
    expect(await k.state(d)).toMatchObject({ stage: "installation_started", partial: true });
  });
});

describe("validation, permission and stale screens", () => {
  let d = "";
  beforeAll(async () => { d = await create([[carcass, "2"]]); await k.toSite(d); });

  it("refuses an incomplete or invalid item and writes nothing", async () => {
    const before = await count("select count(*)::int n from component");
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ name: "" }, /name/i],
      [{ name: "x" }, /name/i],
      [{ name: "y".repeat(121) }, /name/i],
      [{ photoDraftKey: undefined }, /photo/i],
      [{ quantity: "0" }, /quantity/i],
      [{ quantity: "-1" }, /quantity/i],
      [{ priority: "asap" }, /priority/i],
      [{ productType: "spaceship" }, /productType|type/i],
      [{ kind: "lost" }, /kind|missing or damaged/i],
      [{ reason: "" }, /reason/i],
      [{ unit: "tons" }, /unit/i],
    ];
    for (const [over, msg] of cases) {
      const t = await errText(receive(d, { unlisted: [await item(over)] }));
      expect(t, JSON.stringify(over)).toMatch(/^validation/);
      expect(t, JSON.stringify(over)).toMatch(msg);
    }
    expect(await errText(receive(d, { unlisted: [await item(), await item()] }))).toMatch(/twice/);
    expect(await count("select count(*)::int n from component")).toBe(before);
    expect((await k.state(d)).stage).toBe("received");
  });

  it("is only for the project's Installation Manager", async () => {
    for (const bid of [PEOPLE.factory_dispatch, PEOPLE.qc, PEOPLE.otherIm, PEOPLE.installer]) {
      expect(await errKind(receive(d, { unlisted: [await item()] }, bid)), bid).toBe("forbidden");
    }
  });

  it("refuses a stale screen", async () => {
    const s = await k.state(d);
    const ls = await k.lines(d);
    expect(await errKind(receiveDispatch(await k.as(PEOPLE.installation_manager), {
      dispatchId: d, version: s.version - 1, stage: s.stage, lines: ls.map((l) => ({ itemId: l.id, ok: true })), unlisted: [await item()],
    }))).toBe("conflict");
    expect(await count("select count(*)::int n from component where unlisted and name = 'Soft-close hinge'")).toBe(1);
  });
});

describe("the replacement for an unlisted item", () => {
  it("runs the factory steps and closes the complaint when it is received OK", async () => {
    const c = unlistedComplaint;
    await k.cstep(PEOPLE.qc, c, { review: "Hinges were never packed" });
    await k.cstep(PEOPLE.planning, c, { cost: "400" });
    await k.cstep(PEOPLE.management, c, { decision: "approve" });
    await k.cstep(PEOPLE.planning, c, { plan: "From stock", target_date: "2026-11-01" });
    await k.cstep(PEOPLE.store, c, { item_source: "fg_in_stock" });
    expect((await k.cstate(c)).stage).toBe("ready_for_dispatch");
    const r = await k.cstep(PEOPLE.factory_dispatch, c, {});
    expect((await k.cstate(c)).stage).toBe("awaiting_replacement");
    const [rep] = await db.query<{ id: string; types: string[] }>("select id, types from dispatch where replacement_for = $1", [c]);
    expect(r.replacement).toBeTruthy();
    const lines = await k.lines(rep!.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: "Soft-close hinge", quantity: "4" });
    await k.toSite(rep!.id);
    await k.receive(rep!.id);
    expect(await k.cstate(c)).toMatchObject({ status: "closed", outcome: "replaced" });
  });
});
