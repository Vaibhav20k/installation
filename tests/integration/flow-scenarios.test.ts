/**
 * Spec scenarios end to end through the service layer on a real (in-memory) database: audit and notification on
 * every transition, MND validation and input abuse, races, D2 after D1, a replacement that arrives damaged, the
 * reuse of the existing order/BOM/user tables, and the numbers on the views and dashboard.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createDispatch, receiveDispatch } from "@/server/services/dispatch";
import { advanceComplaint } from "@/server/services/complaint";
import { flowDashboard, myPending, teamPending } from "@/server/queries/dispatch";
import { actor, freshDb, idOf } from "./helpers";
import { NOW, PEOPLE, errKind, errText, flowKit } from "./flow-helpers";

let db: Db;
const k = flowKit(() => db);
let order = "", order2 = "", carcass = "", shutters = "", wCarcass = "", wShutters = "";

beforeAll(async () => {
  db = await freshDb();
  order = await idOf(db, "sales_order", "ORD-001");
  order2 = await idOf(db, "sales_order", "ORD-002");
  carcass = await idOf(db, "component", "CMP-001");
  shutters = await idOf(db, "component", "CMP-002");
  wCarcass = await idOf(db, "component", "CMP-005");
  wShutters = await idOf(db, "component", "CMP-006");
}, 240_000);
afterAll(async () => { await db?.close(); });

const create = async (orderId: string, types: string[], items: Array<[string, string]>) =>
  (await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId, types, factory: "Main factory", items: items.map(([componentId, quantity]) => ({ componentId, quantity })) })).dispatchId;

let d1 = "";
describe("full D1 path: audit trail and next-owner notification on every transition", () => {
  it("records who, what, when (and attachments) and notifies the next owner at each step", async () => {
    d1 = await create(order2, ["D1"], [[wCarcass, "6"]]);
    await k.toSite(d1);
    await k.receive(d1);
    await k.step(PEOPLE.installation_manager, d1, { start_date: "2026-10-28" });
    await k.step(PEOPLE.installation_manager, d1, {}, { photos: await k.upload(PEOPLE.installation_manager) });
    expect((await k.state(d1)).status).toBe("completed");
    const hist = await db.query<{ from_stage: string; to_stage: string; kind: string; actor_id: string | null; at: number; files: number }>(
      `select h.from_stage, h.to_stage, h.kind, h.actor_id, h.at, (select count(*)::int from evidence_link l where l.parent_type = 'stage_history' and l.parent_id = h.id) files
       from stage_history h where subject_id = $1 order by seq`, [d1]);
    expect(hist.map((h) => h.to_stage)).toEqual(["site_readiness", "tax_invoice", "eway_bill", "dispatched", "received", "installation_started", "installation_done", "completed"]);
    expect(hist.every((h) => h.actor_id && h.at > 0)).toBe(true);
    expect(hist.filter((h) => h.files > 0).map((h) => h.from_stage)).toEqual(["tax_invoice", "eway_bill", "installation_done"]);
    const audits = await db.query<{ n: number }>("select count(*)::int n from audit_event where object_type = 'dispatch' and object_id = $1", [d1]);
    expect(audits[0]!.n).toBe(hist.length);
    const notes = await db.query<{ title: string; who: string }>("select n.title, e.business_id who from notification n join employee e on e.id = n.employee_id where n.href = $1", [`/dispatch/${d1}`]);
    const owners: Array<[string, string]> = [["Site readiness", PEOPLE.installation_manager], ["Tax invoice", PEOPLE.accounts], ["E-way bill", PEOPLE.accounts], ["Dispatched", PEOPLE.factory_dispatch],
      ["Received & MND", PEOPLE.installation_manager], ["Installation started", PEOPLE.installation_manager], ["Installation done", PEOPLE.installation_manager]];
    for (const [stage, who] of owners) expect(notes.some((n) => n.title.endsWith(stage) && n.who === who)).toBe(true);
    // Nobody outside the owner role is told about a step.
    expect(notes.some((n) => n.title.endsWith("Tax invoice") && n.who !== PEOPLE.accounts)).toBe(false);
  });

  it("the next dispatch (D2) of the same order starts its own cycle after D1 completes", async () => {
    const d2 = await create(order2, ["D2"], [[wShutters, "8"]]);
    expect((await k.state(d2)).stage).toBe("site_readiness");
    await k.toSite(d2);
    await k.receive(d2);
    expect((await k.state(d2)).stage).toBe("installation_started");
    // Each dispatch carries only its own BOM lines.
    const lines = await db.query<{ dispatch_id: string; component_id: string }>("select dispatch_id, component_id from dispatch_item where dispatch_id = any($1::uuid[])", [[d1, d2]]);
    expect(lines.filter((l) => l.dispatch_id === d1).map((l) => l.component_id)).toEqual([wCarcass]);
    expect(lines.filter((l) => l.dispatch_id === d2).map((l) => l.component_id)).toEqual([wShutters]);
  });
});

describe("dispatch typing and BOM lines", () => {
  it("a BOM line's quantity can never be dispatched twice", async () => {
    expect(await errText(create(order2, ["D1"], [[wCarcass, "1"]]))).toMatch(/only 0 left/);
  });
  it("two dispatches racing for the same quantity: only one wins", async () => {
    const results = await Promise.all([1, 2].map(async () => errKind(create(order, ["D2"], [[shutters, "12"]]))));
    expect(results.sort()).toEqual(["ok", "validation"]);
  });
  it("ignores a forged replacement link on a normal dispatch", async () => {
    const id = (await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId: order, types: ["D1"], factory: "Main factory", items: [{ componentId: carcass, quantity: "1" }], replacementFor: crypto.randomUUID() } as never)).dispatchId;
    const [r] = await db.query<{ replacement_for: string | null }>("select replacement_for from dispatch where id = $1", [id]);
    expect(r!.replacement_for).toBeNull();
  });
  it("rejects zero, negative, NaN and non-numeric quantities, and lines from another order", async () => {
    for (const q of ["0", "-1", "abc", "1e3", "NaN", ""]) expect(`${q}:${await errKind(create(order, ["D1"], [[carcass, q]]))}`).toBe(`${q}:validation`);
    expect(await errText(create(order, ["D1"], [[wCarcass, "1"]]))).toMatch(/not on this order/);
  });
});

describe("Received & MND validation", () => {
  let d = "";
  beforeAll(async () => { d = await create(order, ["D1"], [[carcass, "10"]]); await k.toSite(d); });
  it.each([
    ["zero quantity", { kind: "damaged" as const, quantity: "0" }, /quantity affected/],
    ["more than was dispatched", { kind: "damaged" as const, quantity: "11" }, /at most 10/],
    ["no photo", { kind: "missing" as const, quantity: "1", photo: false }, /at least one photo/],
    ["empty reason", { kind: "missing" as const, quantity: "1", reason: "" }, /add a reason/],
  ])("refuses %s", async (_n, bad, msg) => {
    expect(await errText(k.receive(d, { [carcass]: bad }))).toMatch(msg);
  });
  it("refuses negative quantities and 50k-character reasons at the boundary", async () => {
    expect(await errKind(k.receive(d, { [carcass]: { kind: "damaged", quantity: "-2" } }))).toBe("validation");
    expect(await errKind(k.receive(d, { [carcass]: { kind: "damaged", quantity: "1", reason: "x".repeat(50_000) } }))).toBe("validation");
  });
  it("refuses an unanswered line or a line from another dispatch", async () => {
    const s = await k.state(d);
    expect(await errText(receiveDispatch(await k.as(PEOPLE.installation_manager), { dispatchId: d, version: s.version, stage: s.stage, lines: [{ itemId: crypto.randomUUID(), ok: true }] }))).toMatch(/does not belong|not answered/);
  });
  it("double submit: exactly one receipt is saved and one complaint per bad line", async () => {
    const s = await k.state(d);
    const [l] = await k.lines(d);
    const photo1 = await k.upload(PEOPLE.installation_manager), photo2 = await k.upload(PEOPLE.installation_manager);
    const send = async (photo: string) => errKind(receiveDispatch(await k.as(PEOPLE.installation_manager), { dispatchId: d, version: s.version, stage: s.stage,
      lines: [{ itemId: l!.id, ok: false, kind: "damaged", quantity: "1.5", reason: "Panel cracked", photoDraftKey: photo }] }));
    expect((await Promise.all([send(photo1), send(photo2)])).sort()).toEqual(["conflict", "ok"]);
    const [n] = await db.query<{ n: number }>("select count(*)::int n from complaint where dispatch_id = $1", [d]);
    expect(n!.n).toBe(1);
    expect(await k.state(d)).toMatchObject({ stage: "installation_started", partial: true });
  });
});

describe("replacement that arrives damaged, and Management reject", () => {
  it("rejected cost does not move forward and keeps the reason; approval needs another person", async () => {
    const d = await create(order, ["D1"], [[carcass, "2"]]);
    await k.toSite(d);
    const c = (await k.receive(d, { [carcass]: { kind: "damaged", quantity: "1" } })).complaints[0]!.id;
    await k.cstep(PEOPLE.qc, c, { review: "Confirmed" });
    await k.cstep(PEOPLE.planning, c, { cost: "900" });
    await k.cstep(PEOPLE.management, c, { decision: "reject", reason: "Quote too high" });
    expect((await k.cstate(c)).stage).toBe("planning_costing");
    const [h] = await db.query<{ reason: string; kind: string }>("select reason, kind from stage_history where subject_id = $1 and from_stage = 'management_approval'", [c]);
    expect(h).toEqual({ reason: "Quote too high", kind: "back" });
    const [cost] = await db.query<{ cost_approved_by: string | null }>("select cost_approved_by from complaint where id = $1", [c]);
    expect(cost!.cost_approved_by).toBeNull();

    // Approve, plan, take from stock, then the replacement arrives damaged: a new complaint linked to the original.
    await k.cstep(PEOPLE.planning, c, { cost: "700" });
    await k.cstep(PEOPLE.management, c, { decision: "approve" });
    await k.cstep(PEOPLE.planning, c, { plan: "From stock", target_date: "2026-11-01" });
    await k.cstep(PEOPLE.store, c, { item_source: "fg_in_stock" });
    expect(await errKind(advanceComplaint(await k.as(PEOPLE.factory_dispatch), { complaintId: c, version: 1, stage: "ready_for_dispatch", values: {} }))).toBe("conflict");
    await k.cstep(PEOPLE.factory_dispatch, c, {});
    // The complaint cannot be closed by hand while the replacement is on its way.
    const s = await k.cstate(c);
    expect(await errKind(advanceComplaint(await k.as(PEOPLE.admin), { complaintId: c, version: s.version, stage: s.stage, values: {} }))).toBe("conflict");
    const [rep] = await db.query<{ id: string }>("select id from dispatch where replacement_for = $1", [c]);
    await k.toSite(rep!.id);
    const again = (await k.receive(rep!.id, { [carcass]: { kind: "damaged", quantity: "1", reason: "Damaged again" } })).complaints[0]!;
    const orig = await k.cstate(c);
    expect(orig).toMatchObject({ status: "closed", outcome: "superseded", superseded_by: again.id });
    expect((await k.cstate(again.id)).stage).toBe("qc_review");
  });
});

describe("reuse of existing tables", () => {
  it("adds no copy of orders, BOM lines or users; new rows reference the existing ones", async () => {
    const tables = (await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'")).map((t) => t.table_name);
    const added = ["dispatch", "dispatch_item", "complaint", "stage_history", "flow_role", "flow_role_member", "flow_config", "flow_reminder"];
    for (const t of added) expect(tables).toContain(t);
    expect(tables.filter((t) => /^(orders?|boms?|bom_.*|users?|app_user|order_lines?)$/.test(t))).toEqual([]);
    const fks = await db.query<{ tbl: string; ref: string }>(
      `select tc.table_name tbl, ccu.table_name ref from information_schema.table_constraints tc
       join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
       where tc.constraint_type = 'FOREIGN KEY' and tc.table_name in ('dispatch','dispatch_item','complaint','flow_role_member')`);
    const has = (tbl: string, ref: string) => fks.some((f) => f.tbl === tbl && f.ref === ref);
    expect(has("dispatch", "sales_order") && has("dispatch_item", "component") && has("complaint", "component") && has("flow_role_member", "employee")).toBe(true);
  });
  it("the history and the audit log are append-only", async () => {
    expect(await errText(db.query("update stage_history set reason = 'edited'"))).toMatch(/append-only/);
    expect(await errText(db.query("delete from stage_history"))).toMatch(/append-only/);
    expect(await errText(db.query("update audit_event set reason = 'edited'"))).toMatch(/append-only/);
  });
});

describe("views and dashboard numbers", () => {
  it("match the records created above", async () => {
    const dash = await flowDashboard(db, await actor(db, PEOPLE.management), NOW);
    const [counts] = await db.query<{ d: number; c: number; approved: string }>(
      "select (select count(*)::int from dispatch where status = 'open') d, (select count(*)::int from complaint where status = 'open') c, (select coalesce(sum(cost) filter (where cost_approved_by is not null), 0)::text from complaint) approved");
    expect(dash.totals.openDispatches).toBe(counts!.d);
    expect(dash.totals.openComplaints).toBe(counts!.c);
    expect(Number(dash.cost!.approved)).toBe(Number(counts!.approved));
    expect(Number(dash.cost!.approved)).toBe(700);
    expect(dash.dispatchStages.reduce((n, s) => n + s.n, 0)).toBe(counts!.d);
    expect(dash.complaintStages.reduce((n, s) => n + s.n, 0)).toBe(counts!.c);
    expect(dash.complaintAging.reduce((n, a) => n + a.n, 0)).toBe(counts!.c);
    expect(dash.orders.find((o) => o.order_no === "ORD-002")).toMatchObject({ dispatches: 2, completed: 1, open: 1 });
  });
  it("My pending tasks and the reporting manager's team view agree", async () => {
    const qc = await myPending(db, await actor(db, PEOPLE.qc), NOW);
    const [openQc] = await db.query<{ n: number }>("select count(*)::int n from complaint where status = 'open' and stage in ('qc_review','iqc')");
    expect(qc.items.length).toBe(openQc!.n);
    const team = await teamPending(db, await actor(db, PEOPLE.reportingManager), NOW);
    expect(team.find((p) => p.business_id === PEOPLE.qc)!.waiting.length).toBe(qc.items.length);
    expect(await teamPending(db, await actor(db, PEOPLE.installer), NOW)).toEqual([]);
    expect(await errKind(flowDashboard(db, await actor(db, PEOPLE.installer), NOW))).toBe("forbidden");
  });
});
