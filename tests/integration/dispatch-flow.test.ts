import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { makeCtx } from "@/server/services/context";
import { advanceDispatch, createDispatch, moveDispatchBack, receiveDispatch } from "@/server/services/dispatch";
import { advanceComplaint, moveComplaintBack } from "@/server/services/complaint";
import { saveFlowDefinition, setRoleMember } from "@/server/services/flow-admin";
import { processFlowReminders } from "@/server/services/flow-core";
import { complaintDetail, dispatchDetail, dispatchableOrders, flowDashboard, myPending, teamPending } from "@/server/queries/dispatch";
import { DEFAULT_DISPATCH_FLOW } from "@/domain/flow-defaults";
import { AppError } from "@/server/errors";
import { actor, freshDb, idOf } from "./helpers";

const NOW = Date.parse("2026-10-27T05:00:00Z");
const DAY = 86_400_000;
let db: Db;
let order = "", carcass = "", shutters = "", counter = "", backsplash = "";
const as = async (bid: string, now = NOW) => makeCtx(db, await actor(db, bid), now);
const err = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? `${e.kind}: ${e.message} ${e.details.join(" | ")}` : String(e); } };

/** A file that has finished uploading under a fresh draft key, as the browser would leave it. */
async function upload(bid: string, media: "image" | "document" = "image") {
  const [e] = await db.query<{ id: string }>("select id from employee where business_id = $1", [bid]);
  const draft = crypto.randomUUID();
  const [a] = await db.query<{ id: string }>(
    "insert into evidence_asset(uploader_id, storage_key, original_name, media_type, mime, byte_size, state) values ($1, gen_random_uuid()::text || '.bin', $2, $3, $4, 1000, 'ready') returning id",
    [e!.id, media === "image" ? "photo.jpg" : "invoice.pdf", media, media === "image" ? "image/jpeg" : "application/pdf"]);
  await db.query("insert into upload_session(actor_id, draft_key, context, asset_id, expected_mime, expected_size, idempotency_key, expires_at, completed_at) values ($1,$2,'flow.test',$3,'image/jpeg',1000,$4,now() + interval '1 hour', now())",
    [e!.id, draft, a!.id, crypto.randomUUID()]);
  return draft;
}

async function state(id: string) {
  const [r] = await db.query<{ stage: string; version: number; status: string; partial: boolean; hold_until: string | null }>("select stage, version, status, partial, hold_until::text from dispatch where id = $1", [id]);
  return r!;
}
async function cstate(id: string) {
  const [r] = await db.query<{ stage: string; version: number; status: string; outcome: string | null }>("select stage, version, status, outcome from complaint where id = $1", [id]);
  return r!;
}
async function step(bid: string, id: string, values: Record<string, string> = {}, files: Record<string, string> = {}, now = NOW) {
  const s = await state(id);
  return advanceDispatch(await as(bid, now), { dispatchId: id, version: s.version, stage: s.stage, values, files });
}
async function cstep(bid: string, id: string, values: Record<string, string> = {}) {
  const s = await cstate(id);
  return advanceComplaint(await as(bid), { complaintId: id, version: s.version, stage: s.stage, values });
}
/** Site ready, invoice, e-way bill and the truck: the path every dispatch takes to the site. */
async function toSite(id: string) {
  await step("EMP-001", id, { status: "ready" });
  await step("HUB-002", id, { invoice_no: "INV-1" }, { invoice_file: await upload("HUB-002", "document") });
  await step("HUB-002", id, { eway_no: "EWB-1" }, { eway_file: await upload("HUB-002", "document") });
  await step("HUB-001", id, { vehicle_no: "HR26 AB 1234", driver: "Ramesh 98100 00000", dispatch_date: "2026-10-27" });
}
async function receiveAllOk(id: string) {
  const d = (await dispatchDetail(db, await actor(db, "EMP-001"), id, NOW))!;
  const s = await state(id);
  return receiveDispatch(await as("EMP-001"), { dispatchId: id, version: s.version, stage: s.stage, lines: d.items.map((i) => ({ itemId: i.id, ok: true })) });
}

beforeAll(async () => {
  db = await freshDb();
  order = await idOf(db, "sales_order", "ORD-001");
  carcass = await idOf(db, "component", "CMP-001");
  shutters = await idOf(db, "component", "CMP-002");
  counter = await idOf(db, "component", "CMP-004");
  backsplash = await idOf(db, "component", "CMP-BSP-001");
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("dispatch creation", () => {
  it("lets only Factory / Dispatch create, and offers the order's BOM", async () => {
    expect(await err(createDispatch(await as("HUB-002"), { orderId: order, types: ["D1"], factory: "Main factory", items: [{ componentId: carcass, quantity: "24" }] }))).toMatch(/^forbidden/);
    const o = await dispatchableOrders(db, await actor(db, "HUB-001"));
    expect(o.canCreate).toBe(true);
    expect(o.orders.find((x) => x.id === order)!.lines.map((l) => l.dispatch_group)).toEqual(expect.arrayContaining(["carcass", "shutters", "countertop", "backsplash"]));
  });

  it("checks types against BOM groups, D3 overlap and quantity left", async () => {
    const f = await as("HUB-001");
    expect(await err(createDispatch(f, { orderId: order, types: ["D1"], factory: "Main factory", items: [{ componentId: shutters, quantity: "12" }] }))).toMatch(/shutters line/);
    expect(await err(createDispatch(f, { orderId: order, types: ["D3", "D3a"], factory: "Main factory", items: [{ componentId: counter, quantity: "45" }] }))).toMatch(/overlaps/);
    expect(await err(createDispatch(f, { orderId: order, types: ["D1"], factory: "Main factory", items: [{ componentId: carcass, quantity: "25" }] }))).toMatch(/only 24 left/);
  });
});

let combined = "";
describe("combined dispatch with a site that is not ready", () => {
  it("creates D1 + D2 together and notifies the Installation Manager", async () => {
    const r = await createDispatch(await as("HUB-001"), { orderId: order, types: ["D1", "D2"], factory: "Main factory", items: [{ componentId: carcass, quantity: "24" }, { componentId: shutters, quantity: "12" }] });
    combined = r.dispatchId;
    expect((await state(combined)).stage).toBe("site_readiness");
    const [n] = await db.query<{ href: string; title: string }>("select n.href, n.title from notification n join employee e on e.id = n.employee_id where e.business_id = 'EMP-001' and n.kind = 'flow_task' order by n.created_at desc limit 1");
    expect(n!.href).toBe(`/dispatch/${combined}`);
    expect(n!.title).toContain("Site readiness");
    expect((await myPending(db, await actor(db, "EMP-001"), NOW)).items.map((i) => i.id)).toContain(combined);
  });

  it("refuses other roles and skipped stages", async () => {
    expect(await err(step("HUB-002", combined, { status: "ready" }))).toMatch(/^forbidden/);
    const s = await state(combined);
    expect(await err(advanceDispatch(await as("HUB-002"), { dispatchId: combined, version: s.version, stage: "tax_invoice", values: {} }))).toMatch(/already moved past|^conflict/);
  });

  it("Not ready holds the stage with a reason and date, and reminds the day before", async () => {
    expect(await err(step("EMP-001", combined, { status: "not_ready" }))).toMatch(/Why it is not ready: required/);
    await step("EMP-001", combined, { status: "not_ready", reason: "Flooring work still on", expected_date: "2026-10-30" });
    const s = await state(combined);
    expect(s.stage).toBe("site_readiness");
    expect(s.hold_until).toBe("2026-10-30");
    expect(await processFlowReminders(db, NOW)).toBe(0);
    expect(await processFlowReminders(db, Date.parse("2026-10-29T04:00:00Z"))).toBe(1);
    const [n] = await db.query<{ n: number }>("select count(*)::int n from notification where kind = 'flow_reminder'");
    expect(n!.n).toBeGreaterThan(0);
    expect(await processFlowReminders(db, Date.parse("2026-10-29T05:00:00Z"))).toBe(0);
  });

  it("only Ready moves on; invoices and the e-way bill need their files", async () => {
    await step("EMP-001", combined, { status: "ready" });
    expect((await state(combined)).stage).toBe("tax_invoice");
    expect(await err(step("HUB-002", combined, { invoice_no: "INV-1" }))).toMatch(/Tax invoice: add at least 1/);
    await step("HUB-002", combined, { invoice_no: "INV-1" }, { invoice_file: await upload("HUB-002", "document") });
    expect((await state(combined)).stage).toBe("eway_bill");
  });

  it("goes back only to allowed stages and only with a reason", async () => {
    const s = await state(combined);
    expect(await err(moveDispatchBack(await as("HUB-002"), { dispatchId: combined, version: s.version, stage: s.stage, to: "site_readiness", reason: "wrong" }))).toMatch(/go back only to/);
    await moveDispatchBack(await as("HUB-002"), { dispatchId: combined, version: s.version, stage: s.stage, to: "tax_invoice", reason: "Invoice had the wrong GSTIN" });
    expect((await state(combined)).stage).toBe("tax_invoice");
    await step("HUB-002", combined, { invoice_no: "INV-2" }, { invoice_file: await upload("HUB-002", "document") });
    await step("HUB-002", combined, { eway_no: "EWB-1" }, { eway_file: await upload("HUB-002", "document") });
    await step("HUB-001", combined, { vehicle_no: "HR26 AB 1234", driver: "Ramesh", dispatch_date: "2026-10-28" });
    expect((await state(combined)).stage).toBe("received");
  });
});

let fgComplaint = "";
describe("receipt with Missing & Damaged, and installation", () => {
  it("needs type, quantity, reason and a photo for each unchecked line", async () => {
    const d = (await dispatchDetail(db, await actor(db, "EMP-001"), combined, NOW))!;
    const s = await state(combined);
    const shut = d.items.find((i) => i.component_id === shutters)!;
    const carc = d.items.find((i) => i.component_id === carcass)!;
    const bad = await err(receiveDispatch(await as("EMP-001"), { dispatchId: combined, version: s.version, stage: s.stage, lines: [{ itemId: carc.id, ok: true }, { itemId: shut.id, ok: false, kind: "damaged", quantity: "2", reason: "Edge chipped" }] }));
    expect(bad).toMatch(/at least one photo/);
    const r = await receiveDispatch(await as("EMP-001"), { dispatchId: combined, version: s.version, stage: s.stage,
      lines: [{ itemId: carc.id, ok: true }, { itemId: shut.id, ok: false, kind: "damaged", quantity: "2", reason: "Edge chipped", photoDraftKey: await upload("EMP-001") }] });
    expect(r.complaints).toHaveLength(1);
    fgComplaint = r.complaints[0]!.id;
    expect(await state(combined)).toMatchObject({ stage: "installation_started", partial: true });
    expect((await cstate(fgComplaint)).stage).toBe("qc_review");
    const k = (await complaintDetail(db, await actor(db, "HUB-003"), fgComplaint, NOW))!;
    expect(k.history[0]!.files).toHaveLength(1);
    expect(k.factory).toBe("Main factory");
  });

  it("installation starts while the complaint is open and completes with photos", async () => {
    await step("EMP-001", combined, { start_date: "2026-10-29" });
    expect(await err(step("EMP-001", combined, {}))).toMatch(/Completion photos/);
    await step("EMP-001", combined, {}, { photos: await upload("EMP-001") });
    expect(await state(combined)).toMatchObject({ status: "completed", partial: true });
  });
});

describe("MND complaint with a finished good in stock", () => {
  it("runs QC, costing and the management gate (no self-approval, reject needs a reason)", async () => {
    await cstep("HUB-003", fgComplaint, { review: "Two shutters chipped in transit, photos clear" });
    await cstep("HUB-004", fgComplaint, { cost: "4800" });
    // A planner who also holds Management may not approve their own costing.
    await setRoleMember(await as("EMP-004"), { roleCode: "management", employeeId: await idOf(db, "employee", "HUB-004"), member: true });
    expect(await err(cstep("HUB-004", fgComplaint, { decision: "approve" }))).toMatch(/your own/);
    expect(await err(cstep("HUB-005", fgComplaint, { decision: "reject" }))).toMatch(/Reason: required/);
    await cstep("HUB-005", fgComplaint, { decision: "reject", reason: "Use stock shutters, recheck cost" });
    expect((await cstate(fgComplaint)).stage).toBe("planning_costing");
    await cstep("HUB-004", fgComplaint, { cost: "3200" });
    await cstep("HUB-005", fgComplaint, { decision: "approve" });
    await cstep("HUB-004", fgComplaint, { plan: "Pick 2 shutters from FG stock", target_date: "2026-11-02" });
    await cstep("HUB-006", fgComplaint, { item_source: "fg_in_stock" });
    expect((await cstate(fgComplaint)).stage).toBe("ready_for_dispatch");
  });

  it("creates a tagged replacement dispatch that closes the complaint when received OK", async () => {
    const r = await cstep("HUB-001", fgComplaint, {});
    expect(r.replacement).toMatch(/^DSP-/);
    const [rep] = await db.query<{ id: string; types: string[] }>("select id, types from dispatch where replacement_for = $1", [fgComplaint]);
    expect(rep!.types).toEqual(["D2"]);
    const hist = (await dispatchDetail(db, await actor(db, "EMP-001"), rep!.id, NOW))!.history;
    expect(hist[0]!.data.note).toContain("Replacement – Complaint MND-");
    await toSite(rep!.id);
    await receiveAllOk(rep!.id);
    expect(await cstate(fgComplaint)).toMatchObject({ status: "closed", outcome: "replaced" });
  });
});

describe("MND complaint that needs purchase, with an IQC reject, on a split D3", () => {
  let d3a = "", d3b = "", buy = "";
  it("ships countertop and backsplash as separate dispatches", async () => {
    d3a = (await createDispatch(await as("HUB-001"), { orderId: order, types: ["D3a"], factory: "Main factory", items: [{ componentId: counter, quantity: "45" }] })).dispatchId;
    d3b = (await createDispatch(await as("HUB-001"), { orderId: order, types: ["D3b"], factory: "Main factory", items: [{ componentId: backsplash, quantity: "18" }] })).dispatchId;
    expect(await err(createDispatch(await as("HUB-001"), { orderId: order, types: ["D3b"], factory: "Main factory", items: [{ componentId: backsplash, quantity: "1" }] }))).toMatch(/only 0 left/);
    await toSite(d3a);
    await toSite(d3b);
    await receiveAllOk(d3b);
    expect((await state(d3b)).partial).toBe(false);
    const d = (await dispatchDetail(db, await actor(db, "EMP-001"), d3a, NOW))!;
    const s = await state(d3a);
    const r = await receiveDispatch(await as("EMP-001"), { dispatchId: d3a, version: s.version, stage: s.stage, lines: [{ itemId: d.items[0]!.id, ok: false, kind: "missing", quantity: "5", reason: "One slab not on the truck", photoDraftKey: await upload("EMP-001") }] });
    buy = r.complaints[0]!.id;
  });

  it("goes through purchase; IQC reject sends it back to purchase with a reason", async () => {
    await cstep("HUB-003", buy, { review: "Slab missing, transporter confirms" });
    await cstep("HUB-004", buy, { cost: "15000" });
    await cstep("HUB-005", buy, { decision: "approve" });
    await cstep("HUB-004", buy, { plan: "Order a new slab", target_date: "2026-11-10" });
    await cstep("HUB-006", buy, { item_source: "to_purchase" });
    expect((await cstate(buy)).stage).toBe("purchase");
    await cstep("HUB-007", buy, { po_ref: "PO-7781", expected_date: "2026-11-05" });
    expect(await err(cstep("HUB-003", buy, { result: "reject" }))).toMatch(/Reason: required/);
    await cstep("HUB-003", buy, { result: "reject", reason: "Shade does not match" });
    expect((await cstate(buy)).stage).toBe("purchase");
    await cstep("HUB-007", buy, { po_ref: "PO-7790", expected_date: "2026-11-08" });
    await cstep("HUB-003", buy, { result: "pass" });
    for (const [bid, s] of [["HUB-006", "store_issue"], ["HUB-008", "production"], ["HUB-009", "packaging"]] as const) {
      expect((await cstate(buy)).stage).toBe(s);
      await cstep(bid, buy, {});
    }
    expect((await cstate(buy)).stage).toBe("ready_for_dispatch");
    const hist = (await complaintDetail(db, await actor(db, "HUB-005"), buy, NOW))!.history;
    expect(hist.filter((h) => h.kind === "back").map((h) => h.reason)).toEqual(["Shade does not match"]);
  });

  it("can be sent back by the stage owner, never without a reason", async () => {
    const s = await cstate(buy);
    expect(await err(moveComplaintBack(await as("HUB-001"), { complaintId: buy, version: s.version, stage: s.stage, to: "packaging", reason: "" }))).toMatch(/^validation/);
  });
});

describe("views, dashboard and config", () => {
  it("shows the management dashboard and the reporting manager's team", async () => {
    const dash = await flowDashboard(db, await actor(db, "HUB-005"), NOW + 3 * DAY);
    expect(dash.totals.openComplaints).toBe(1);
    expect(Number(dash.cost!.approved)).toBe(18200);
    expect(dash.complaintStages.find((s) => s.code === "ready_for_dispatch")!.n).toBe(1);
    const team = await teamPending(db, await actor(db, "HUB-005"), NOW);
    expect(team.find((p) => p.business_id === "HUB-001")!.waiting.length).toBe(1);
    expect(await err(flowDashboard(db, await actor(db, "EMP-020"), NOW))).toMatch(/^forbidden/);
  });

  it("saves a valid new flow version; open records keep theirs", async () => {
    const admin = await as("EMP-004");
    const bad = { ...DEFAULT_DISPATCH_FLOW, stages: DEFAULT_DISPATCH_FLOW.stages.map((s) => (s.code === "tax_invoice" ? { ...s, owner: "nobody" } : s)) };
    expect(await err(saveFlowDefinition(admin, { flow: "dispatch", definition: JSON.stringify(bad), note: "test" }))).toMatch(/not a known role/);
    const renamed = { ...DEFAULT_DISPATCH_FLOW, stages: DEFAULT_DISPATCH_FLOW.stages.map((s) => (s.code === "tax_invoice" ? { ...s, label: "Invoice upload" } : s)) };
    expect((await saveFlowDefinition(admin, { flow: "dispatch", definition: JSON.stringify(renamed), note: "Rename" })).version).toBe(2);
    expect(await err(saveFlowDefinition(await as("HUB-005"), { flow: "dispatch", definition: JSON.stringify(renamed), note: "Try it" }))).toMatch(/^forbidden/);
    const [v] = await db.query<{ n: number }>("select count(*)::int n from dispatch where config_version = 1");
    expect(v!.n).toBeGreaterThan(0);
  });

  it("keeps every stage change in an append-only history", async () => {
    expect(await err(db.query("delete from stage_history"))).toMatch(/append-only/);
    const [h] = await db.query<{ n: number }>("select count(*)::int n from stage_history where actor_id is not null");
    expect(h!.n).toBeGreaterThan(30);
  });
});
