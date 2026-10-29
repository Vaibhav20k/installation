/**
 * Regression tests for the findings of the independent break-it pass (docs/dispatch-testing.md, "Security
 * findings"). Each test was written to fail against the code as it was, then the fix made it pass.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createDispatch, moveDispatchBack } from "@/server/services/dispatch";
import { moveComplaintBack } from "@/server/services/complaint";
import { authorizeAssetRead } from "@/server/services/evidence";
import { complaintDetail, flowDashboard } from "@/server/queries/dispatch";
import { actor, freshDb, idOf } from "./helpers";
import { NOW, PEOPLE, errKind, errText, flowKit } from "./flow-helpers";

let db: Db;
const k = flowKit(() => db);
let dispatchId = "", complaintId = "", invoiceAsset = "", photoAsset = "";

beforeAll(async () => {
  db = await freshDb();
  const order = await idOf(db, "sales_order", "ORD-001");
  const carcass = await idOf(db, "component", "CMP-001");
  dispatchId = (await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId: order, types: ["D1"], factory: "Main factory", items: [{ componentId: carcass, quantity: "3" }] })).dispatchId;
  await k.toSite(dispatchId);
  complaintId = (await k.receive(dispatchId, { [carcass]: { kind: "damaged", quantity: "1" } })).complaints[0]!.id;
  await k.cstep(PEOPLE.qc, complaintId, { review: "Confirmed" });
  await k.cstep(PEOPLE.planning, complaintId, { cost: "4800" });
  const [inv] = await db.query<{ asset_id: string }>(
    `select l.asset_id from evidence_link l join stage_history h on h.id = l.parent_id where h.subject_id = $1 and h.from_stage = 'tax_invoice'`, [dispatchId]);
  invoiceAsset = inv!.asset_id;
  const [ph] = await db.query<{ asset_id: string }>(
    `select l.asset_id from evidence_link l join stage_history h on h.id = l.parent_id where h.subject_id = $1 and h.kind = 'create'`, [complaintId]);
  photoAsset = ph!.asset_id;
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("F1 (Medium): cost and tax documents follow least privilege", () => {
  it.each(["store", "purchase", "production", "packaging", "qc", "factory_dispatch"] as const)("%s cannot see a complaint's cost or who set it", async (role) => {
    const c = (await complaintDetail(db, await actor(db, PEOPLE[role]), complaintId, NOW))!;
    expect(c.cost).toBeNull();
    expect(c.costed_by_name).toBeNull();
    expect(JSON.stringify(c.history)).not.toContain("4800");
  });
  it.each(["planning", "management", "admin", "installation_manager"] as const)("%s can see the cost", async (role) => {
    expect((await complaintDetail(db, await actor(db, PEOPLE[role]), complaintId, NOW))!.cost).toBe("4800.00");
  });
  it("the cost totals on the dashboard are hidden from fulfilment roles", async () => {
    expect((await flowDashboard(db, await actor(db, PEOPLE.packaging), NOW)).cost).toBeNull();
    expect(Number((await flowDashboard(db, await actor(db, PEOPLE.management), NOW)).cost!.awaiting)).toBe(4800);
  });
  it("invoice and e-way bill files open only for Accounts, Factory / Dispatch, Management, admins and the project's managers", async () => {
    for (const r of ["packaging", "store", "purchase", "production", "qc", "planning"] as const) expect(`${r}:${await errKind(authorizeAssetRead(db, await actor(db, PEOPLE[r]), invoiceAsset))}`).toBe(`${r}:forbidden`);
    for (const r of ["accounts", "factory_dispatch", "management", "admin", "installation_manager"] as const) expect(`${r}:${await errKind(authorizeAssetRead(db, await actor(db, PEOPLE[r]), invoiceAsset))}`).toBe(`${r}:ok`);
    expect(await errKind(authorizeAssetRead(db, await actor(db, PEOPLE.otherIm), invoiceAsset))).toBe("forbidden");
  });
  it("MND photos stay visible to the departments that work the complaint", async () => {
    for (const r of ["qc", "planning", "store", "management"] as const) expect(await errKind(authorizeAssetRead(db, await actor(db, PEOPLE[r]), photoAsset))).toBe("ok");
    expect(await errKind(authorizeAssetRead(db, await actor(db, PEOPLE.installer), photoAsset))).toBe("forbidden");
  });
});

describe("F2 (Low): only the stage owner moves a dispatch back", () => {
  it("Management cannot rewind a dispatch stage it does not own; the owner still can", async () => {
    await k.placeAt("dispatch", dispatchId, "eway_bill");
    const s = await k.state(dispatchId);
    const input = { dispatchId, version: s.version, stage: s.stage, to: "tax_invoice", reason: "Recount" };
    expect(await errKind(moveDispatchBack(await k.as(PEOPLE.management), input))).toBe("forbidden");
    expect(await errKind(moveDispatchBack(await k.as(PEOPLE.accounts), input))).toBe("ok");
  });
  it("Management keeps its back-right in the complaint flow (it owns the cost gate)", async () => {
    await k.cstep(PEOPLE.management, complaintId, { decision: "approve" });
    const s = await k.cstate(complaintId);
    expect(await errKind(moveComplaintBack(await k.as(PEOPLE.store), { complaintId, version: s.version, stage: s.stage, to: "qc_review", reason: "x" }))).toBe("validation");
  });
});

describe("F3 (Low): oversized numbers are a validation error, not a server error", () => {
  it("refuses a cost too large for the column with a message", async () => {
    await k.placeAt("complaint", complaintId, "planning_costing");
    expect(await errText(k.cstep(PEOPLE.planning, complaintId, { cost: "999999999999999999" }))).toMatch(/^validation: .*Replacement cost/);
    expect(await errKind(k.cstep(PEOPLE.planning, complaintId, { cost: "9".repeat(50_000) }))).toBe("validation");
  });
});

describe("F4 (Low): notifications never go to Installation Managers outside the project", () => {
  it("a project with no scoped Installation Manager notifies no IM at all", async () => {
    // PRJ-003 is managed by EMP-002; take the IM role away so no IM is scoped to it.
    await db.query("delete from flow_role_member where role_code = 'installation_manager' and employee_id = (select id from employee where business_id = 'EMP-002')");
    const order = await idOf(db, "sales_order", "ORD-004");
    const comp = (await db.query<{ id: string }>("select c.id from component c join order_item oi on oi.id = c.order_item_id where oi.order_id = $1 and c.dispatch_group = 'carcass'", [order]))[0]!.id;
    const d = (await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId: order, types: ["D1"], factory: "Main factory", items: [{ componentId: comp, quantity: "1" }] })).dispatchId;
    const sent = await db.query<{ who: string }>("select e.business_id who from notification n join employee e on e.id = n.employee_id where n.href = $1", [`/dispatch/${d}`]);
    expect(sent.map((s) => s.who)).not.toContain(PEOPLE.installation_manager);
  });
});
