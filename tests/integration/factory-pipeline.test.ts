/**
 * The Factory home pipeline and the factory Complaints queue: each record sits in one tile and every tile's count
 * is its list, To send counts orders with quantity left, buttons appear only for the owning department, scope is
 * never wider than Dispatch, and the queue groups complaints by phase and detailed step with "Your step" first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createDispatch } from "@/server/services/dispatch";
import { dispatchableOrders } from "@/server/queries/dispatch";
import { FTILE_KEYS, factoryComplaints, factoryPipeline, groupQueue, queueCounts, type FTileKey } from "@/server/queries/factory-pipeline";
import { actor, freshDb, idOf } from "./helpers";
import { flowKit, NOW, PEOPLE } from "./flow-helpers";

const DAY = 86_400_000;
let db: Db;
const kit = flowKit(() => db);
const ids: Record<string, string> = {};
let complaintId = "";

async function pipeFor(bid: string, now = NOW) {
  const p = await factoryPipeline(db, await actor(db, bid), now);
  for (const t of p.tiles) {
    expect(t.n, t.key).toBe(p.rows[t.key].length);
    expect(t.overdue, t.key).toBe(p.rows[t.key].filter((r) => r.overdue).length);
    expect(t.mine, t.key).toBe(p.rows[t.key].filter((r) => r.action).length);
  }
  const all = FTILE_KEYS.filter((k) => k !== "send").flatMap((k) => p.rows[k].map((r) => r.key));
  expect(new Set(all).size).toBe(all.length);
  const where = (id: string) => FTILE_KEYS.find((k) => p.rows[k].some((r) => r.key === id)) as FTileKey | undefined;
  const row = (id: string) => FTILE_KEYS.flatMap((k) => p.rows[k]).find((r) => r.key === id);
  return { ...p, where, row };
}
const queueFor = async (bid: string, now = NOW) => factoryComplaints(db, await actor(db, bid), now);

beforeAll(async () => {
  db = await freshDb();
  const order = await idOf(db, "sales_order", "ORD-001");
  const o = (await dispatchableOrders(db, await actor(db, PEOPLE.factory_dispatch))).orders.find((x) => x.id === order)!;
  const line = (g: string) => o.lines.filter((l) => l.dispatch_group === g && Number(l.left) > 0).map((l) => ({ componentId: l.id, quantity: l.left }));
  const f = await kit.as(PEOPLE.factory_dispatch);
  for (const [type, group] of [["D1", "carcass"], ["D2", "shutters"], ["D3a", "countertop"], ["D3b", "backsplash"]] as const) {
    ids[type] = (await createDispatch(f, { orderId: order, types: [type], factory: "Main factory", items: line(group) })).dispatchId;
  }
  // D1 received with one damaged line (a complaint, and off the factory side); D2 on the truck; D3a at Accounts;
  // D3b waiting for the site check.
  await kit.toSite(ids.D1!);
  const lines = await kit.lines(ids.D1!);
  const got = await kit.receive(ids.D1!, { [lines[0]!.component_id]: { kind: "damaged", quantity: "1" } });
  complaintId = got.complaints[0]!.id;
  await kit.toSite(ids.D2!);
  await kit.step(PEOPLE.installation_manager, ids.D3a!, { status: "ready" });
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("Factory pipeline", () => {
  it("buckets each dispatch by the step it waits for; site work is off the factory side", async () => {
    const p = await pipeFor(PEOPLE.factory_dispatch);
    expect(p.where(ids.D3b!)).toBe("site");
    expect(p.where(ids.D3a!)).toBe("accounts");
    expect(p.where(ids.D2!)).toBe("truck");
    expect(p.where(ids.D1!)).toBeUndefined();
    expect(p.where(complaintId)).toBe("replace");
    expect(p.tiles.map((t) => t.key)).toEqual([...FTILE_KEYS]);
  });

  it("counts To send as orders with BOM quantity left, with the button only for Factory / Dispatch", async () => {
    const fd = await actor(db, PEOPLE.factory_dispatch);
    const expected = (await dispatchableOrders(db, fd)).orders.filter((o) => o.lines.some((l) => Number(l.left) > 0)).map((o) => o.id).sort();
    const p = await pipeFor(PEOPLE.factory_dispatch);
    expect(p.rows.send.map((r) => r.key).sort()).toEqual(expected);
    expect(p.tiles[0]!.n).toBe(expected.length);
    const r = p.rows.send[0]!;
    expect(r.action).toEqual({ label: "Mark ready for dispatch", href: `/dispatch/new?order=${r.key}` });
    const acc = await pipeFor(PEOPLE.accounts);
    expect(acc.rows.send.length).toBe(expected.length);
    expect(acc.rows.send.every((x) => x.action === null && x.href === null)).toBe(true);
  });

  it("gives Accounts their invoice button and Factory / Dispatch their dispatch button, nobody else's", async () => {
    let acc = await pipeFor(PEOPLE.accounts);
    expect(acc.row(ids.D3a!)!.action).toEqual({ label: "Add tax invoice", href: `/dispatch/${ids.D3a}#h-now` });
    expect(acc.row(ids.D3b!)!.action).toBeNull();
    expect(acc.row(ids.D3b!)!.waiting).toBe("Waiting for the Installation Manager");
    expect(acc.row(ids.D2!)!.waiting).toBe("Waiting for site");
    let fd = await pipeFor(PEOPLE.factory_dispatch);
    expect(fd.row(ids.D3a!)!.action).toBeNull();
    expect(fd.row(ids.D3a!)!.waiting).toBe("Waiting for accounts");

    await kit.step(PEOPLE.accounts, ids.D3a!, { invoice_no: "INV-7" }, { invoice_file: await kit.upload(PEOPLE.accounts, "document") });
    acc = await pipeFor(PEOPLE.accounts);
    expect(acc.row(ids.D3a!)!.action!.label).toBe("Add e-way bill");
    await kit.step(PEOPLE.accounts, ids.D3a!, { eway_no: "EWB-7" }, { eway_file: await kit.upload(PEOPLE.accounts, "document") });
    fd = await pipeFor(PEOPLE.factory_dispatch);
    expect(fd.where(ids.D3a!)).toBe("load");
    expect(fd.row(ids.D3a!)!.action).toEqual({ label: "Record dispatch", href: `/dispatch/${ids.D3a}#h-now` });
    expect((await pipeFor(PEOPLE.accounts)).row(ids.D3a!)!.action).toBeNull();
    // Management sees everything in scope but holds neither role, so gets no button on either.
    const mg = await pipeFor(PEOPLE.management);
    expect(mg.row(ids.D3a!)!.action).toBeNull();
    expect(mg.rows.send.every((x) => x.action === null)).toBe(true);
  });

  it("counts open complaints by phase and lists the viewer's own steps, without cost", async () => {
    const qc = await pipeFor(PEOPLE.qc);
    expect(qc.phases.map((x) => [x.code, x.label, x.n])).toEqual([["planning", "Planning", 1], ["purchase", "Purchase", 0], ["qc", "QC", 0], ["production", "Production", 0], ["dispatched", "Ready to send", 0]]);
    expect(qc.row(complaintId)!.action).toEqual({ label: "Review complaint", href: `/dispatch/complaints/${complaintId}#h-now` });
    expect(qc.row(complaintId)!.stage_label).toBe("Planning · QC review");
    expect(qc.yourSteps!.map((r) => r.key)).toEqual([complaintId]);
    expect(JSON.stringify(qc)).not.toContain("cost");
    const planning = await pipeFor(PEOPLE.planning);
    expect(planning.yourSteps).toEqual([]);
    expect(planning.row(complaintId)!.waiting).toBe("Waiting for QC");
    // An Installation Manager holds no factory department role: no "Your steps".
    expect((await pipeFor(PEOPLE.installation_manager)).yourSteps).toBeNull();
  });

  it("turns a tile red once something in it is past its step's SLA", async () => {
    const later = await pipeFor(PEOPLE.factory_dispatch, NOW + 20 * DAY);
    expect(later.tiles.find((t) => t.key === "truck")!.overdue).toBe(1);
    expect(later.tiles.find((t) => t.key === "replace")!.overdue).toBeGreaterThan(0);
    expect((await pipeFor(PEOPLE.factory_dispatch)).tiles.find((t) => t.key === "truck")!.overdue).toBe(0);
  });

  it("never widens scope: an installer sees nothing, another project's IM none of these", async () => {
    const inst = await pipeFor(PEOPLE.installer);
    expect(inst.tiles.every((t) => t.n === 0)).toBe(true);
    const other = await pipeFor(PEOPLE.otherIm);
    for (const id of [...Object.values(ids), complaintId]) expect(other.where(id)).toBeUndefined();
  });
});

describe("factory Complaints queue", () => {
  it("groups by phase and step, marks the viewer's step, and carries priority and the unlisted flag", async () => {
    const list = await queueFor(PEOPLE.qc);
    expect(list.map((c) => c.id)).toEqual([complaintId]);
    const c = list[0]!;
    expect(c).toMatchObject({ phase: "planning", stage: "qc_review", stage_label: "QC review", owner: "qc", mine: true, priority: "normal", unlisted: false });
    expect(c).not.toHaveProperty("cost");
    const g = groupQueue(list, "open", "planning");
    expect(g.map((x) => [x.stage, x.rows.length, x.mine])).toEqual([["qc_review", 1, 1]]);
    expect(groupQueue(list, "open", "purchase")).toEqual([]);
    expect(queueCounts(list).byPhase.planning).toBe(1);
  });

  it("moves the complaint to the next step and the next department's queue", async () => {
    await kit.cstep(PEOPLE.qc, complaintId, { review: "Confirmed damaged in transit" });
    const qc = (await queueFor(PEOPLE.qc))[0]!;
    expect(qc).toMatchObject({ stage: "planning_costing", mine: false });
    const planning = (await queueFor(PEOPLE.planning))[0]!;
    expect(planning).toMatchObject({ stage: "planning_costing", stage_label: "Costing", mine: true, owner_name: expect.any(String) });
    await db.query("update complaint set priority = 'urgent' where id = $1", [complaintId]);
    expect((await queueFor(PEOPLE.planning))[0]!.priority).toBe("urgent");
  });

  it("keeps to the Dispatch scope: installers and another project's IM see nothing; the project's IM sees it, not as theirs", async () => {
    expect(await queueFor(PEOPLE.installer)).toEqual([]);
    expect(await queueFor(PEOPLE.otherIm)).toEqual([]);
    const im = await queueFor(PEOPLE.installation_manager);
    expect(im.map((c) => c.id)).toEqual([complaintId]);
    expect(im[0]!.mine).toBe(false);
  });
});
