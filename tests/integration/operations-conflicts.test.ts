/**
 * The earlier screens against a published revised process, on a real database: dispatches stay in the tiles at every
 * step, and the owner's decision of 28 Oct 2026 still holds that the factory may send before the item list exists.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { activateOperations } from "@/server/services/flow-admin";
import { saveOperationsPolicy } from "@/server/services/operations-policy";
import { createDispatch, receiveDispatch } from "@/server/services/dispatch";
import { imPipeline } from "@/server/queries/im-pipeline";
import { factoryPipeline } from "@/server/queries/factory-pipeline";
import { complaintTracker } from "@/server/queries/complaint-tracker";
import { canSeeFinanceFiles } from "@/server/services/flow-core";
import { freshDb } from "./helpers";
import { flowKit, PEOPLE, testPolicy } from "./flow-helpers";

let db: Db;
const k = flowKit(() => db);
let orderId = "", managerId = "", componentId = "";

beforeAll(async () => {
  db = await freshDb();
  for (const [role, bid] of [["factory", PEOPLE.factory_dispatch], ["dispatch_department", PEOPLE.factory_dispatch], ["finance", PEOPLE.accounts], ["qa", PEOPLE.qc], ["installation_head", PEOPLE.management]] as const)
    await db.query("insert into flow_role_member(role_code,employee_id) select $1,id from employee where business_id=$2 on conflict do nothing", [role, bid]);
  await saveOperationsPolicy(await k.as(PEOPLE.admin), testPolicy);
  await activateOperations(await k.as(PEOPLE.admin), {});
  const [line] = await db.query<{ id: string; order_id: string; manager_id: string }>(
    `select c.id, oi.order_id, p.manager_id from component c join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id
     join project p on p.id = o.project_id join flow_role_member m on m.employee_id = p.manager_id and m.role_code = 'installation_manager'
     join employee e on e.id = p.manager_id where e.business_id = $1 and c.dispatch_group = 'carcass' limit 1`, [PEOPLE.installation_manager]);
  orderId = line!.order_id; managerId = line!.manager_id; componentId = line!.id;
}, 240_000);
afterAll(async () => { await db?.close(); });

const imTile = async (id: string) => {
  const p = (await imPipeline(db, (await k.as(PEOPLE.installation_manager)).actor, Date.now()))!;
  return Object.entries(p.rows).find(([, rows]) => rows.some((r) => r.key === id))?.[0] ?? null;
};
const factoryTile = async (id: string) => {
  const p = await factoryPipeline(db, (await k.as(PEOPLE.factory_dispatch)).actor, Date.now());
  return Object.entries(p.rows).find(([, rows]) => rows.some((r) => r.key === id))?.[0] ?? null;
};

describe("a dispatch through the revised flow", () => {
  it("stays in a tile at every step on both homes", async () => {
    const { dispatchId: id } = await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId, installationManagerId: managerId, types: ["D1"], factory: "Main factory", items: [{ componentId, quantity: "1" }] });
    const seen: Array<[string, string | null, string | null]> = [];
    const mark = async () => seen.push([(await k.state(id)).stage, await imTile(id), await factoryTile(id)]);
    await mark();
    await k.step(PEOPLE.factory_dispatch, id); await mark();
    await k.step(PEOPLE.installation_manager, id, { status: "ready" }); await mark();
    await k.step(PEOPLE.factory_dispatch, id); await mark();
    await k.step(PEOPLE.accounts, id, { decision: "received", note: "Receipt checked" }); await mark();
    await k.step(PEOPLE.accounts, id, { invoice_no: "INV-1" }, { invoice_file: await k.upload(PEOPLE.accounts, "document") }); await mark();
    await k.step(PEOPLE.accounts, id, { eway_no: "EWAY-1" }, { eway_file: await k.upload(PEOPLE.accounts, "document") }); await mark();
    await k.step(PEOPLE.factory_dispatch, id); await mark();
    await k.step(PEOPLE.factory_dispatch, id, { vehicle_no: "HR26 AB 1234", driver: "Driver 12345", dispatch_date: "2026-10-27" }); await mark();
    await k.step(PEOPLE.installation_manager, id); await mark();
    expect(seen).toEqual([
      ["ready_for_dispatch", "ready", "packing"],
      ["site_readiness", "ready", "site"],
      ["payment_request", "ready", "accounts"],
      ["payment_check", "ready", "accounts"],
      ["tax_invoice", "ready", "accounts"],
      ["eway_bill", "ready", "accounts"],
      ["cleared", "ready", "load"],
      ["dispatched", "ready", "load"],
      ["received", "dispatched", "truck"],
      ["mnd_check", "received", null],
    ]);
    const p = (await imPipeline(db, (await k.as(PEOPLE.installation_manager)).actor, Date.now()))!;
    expect(p.rows.received.find((r) => r.key === id)!.action?.label).toBe("Do MND check");
  });

  it("shows the Packing tile and the five revised phases on the Factory home", async () => {
    const p = await factoryPipeline(db, (await k.as(PEOPLE.factory_dispatch)).actor, Date.now());
    expect(p.tiles.map((t) => t.key)).toEqual(["send", "packing", "site", "accounts", "load", "truck", "replace"]);
    expect(p.tiles.find((t) => t.key === "accounts")!.label).toBe("Payment & accounts");
    expect(p.phases.map((x) => x.code)).toContain("qa");
  });

  it("keeps the tracker's dots for a complaint in the revised flow", async () => {
    const { dispatchId: id } = await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId, installationManagerId: managerId, types: ["D1"], factory: "Main factory", items: [{ componentId, quantity: "1" }] });
    await k.step(PEOPLE.factory_dispatch, id);
    await k.step(PEOPLE.installation_manager, id, { status: "ready" });
    await k.step(PEOPLE.factory_dispatch, id);
    await k.step(PEOPLE.accounts, id, { decision: "received", note: "Receipt checked" });
    await k.step(PEOPLE.accounts, id, { invoice_no: "INV-2" }, { invoice_file: await k.upload(PEOPLE.accounts, "document") });
    await k.step(PEOPLE.accounts, id, { eway_no: "EWAY-2" }, { eway_file: await k.upload(PEOPLE.accounts, "document") });
    await k.step(PEOPLE.factory_dispatch, id);
    await k.step(PEOPLE.factory_dispatch, id, { vehicle_no: "HR26 AB 1234", driver: "Driver 12345", dispatch_date: "2026-10-27" });
    await k.step(PEOPLE.installation_manager, id);
    const s = await k.state(id);
    const [line] = await k.lines(id);
    const photoDraftKey = await k.upload(PEOPLE.installation_manager);
    await receiveDispatch(await k.as(PEOPLE.installation_manager), { dispatchId: id, version: s.version, stage: s.stage, lines: [{ itemId: line!.id, ok: false, kind: "damaged", quantity: "1", reason: "Corner broken", photoDraftKey }] });
    const list = await complaintTracker(db, (await k.as(PEOPLE.installation_manager)).actor, Date.now());
    const mine = list.find((c) => c.status === "open")!;
    expect(mine.track.steps.map((x) => x.label)).toEqual(["Planning", "Purchase", "Production", "QA", "Dispatched"]);
    expect(mine.track.waitingFor).toBe("QC");
  });

  it("lets the factory send before the item list exists, and the site confirm nothing is missing", async () => {
    const { dispatchId: id } = await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId, installationManagerId: managerId, types: ["D1"], factory: "Main factory", items: [], withoutList: true, note: "List follows" });
    await k.step(PEOPLE.factory_dispatch, id);
    await k.step(PEOPLE.installation_manager, id, { status: "ready" });
    await k.step(PEOPLE.factory_dispatch, id);
    await k.step(PEOPLE.accounts, id, { decision: "received", note: "Receipt checked" });
    await k.step(PEOPLE.accounts, id, { invoice_no: "INV-3" }, { invoice_file: await k.upload(PEOPLE.accounts, "document") });
    await k.step(PEOPLE.accounts, id, { eway_no: "EWAY-3" }, { eway_file: await k.upload(PEOPLE.accounts, "document") });
    await k.step(PEOPLE.factory_dispatch, id);
    await k.step(PEOPLE.factory_dispatch, id, { vehicle_no: "HR26 AB 1234", driver: "Driver 12345", dispatch_date: "2026-10-27" });
    await k.step(PEOPLE.installation_manager, id);
    const s = await k.state(id);
    expect(s.stage).toBe("mnd_check");
    await receiveDispatch(await k.as(PEOPLE.installation_manager), { dispatchId: id, version: s.version, stage: s.stage, lines: [], nothingMissing: true });
    expect((await k.state(id)).stage).toBe("installation_started");
  });
});

describe("finance documents in the revised process", () => {
  const can = async (bid: string) => {
    const [o] = await db.query<{ project_id: string }>("select project_id from sales_order where id = $1", [orderId]);
    return canSeeFinanceFiles(db, (await k.as(bid)).actor, o!.project_id);
  };
  const give = (role: string, bid: string) => db.query("insert into flow_role_member(role_code,employee_id) select $1,id from employee where business_id=$2 on conflict do nothing", [role, bid]);
  it("opens invoices and e-way bills to Finance and Dispatch on any project, and not to other departments", async () => {
    expect(await can(PEOPLE.store)).toBe(false);
    await give("finance", PEOPLE.store);
    expect(await can(PEOPLE.store)).toBe(true);
    expect(await can(PEOPLE.purchase)).toBe(false);
    await give("dispatch_department", PEOPLE.purchase);
    expect(await can(PEOPLE.purchase)).toBe(true);
    await give("factory", PEOPLE.production);
    expect(await can(PEOPLE.production)).toBe(false);
  });
});
