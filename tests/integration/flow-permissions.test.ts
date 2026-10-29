/**
 * Permission matrix generated from the active flow definitions: for every stage of both flows, every person in
 * the fixture tries to complete it. Only the owning role gets past the permission check; everyone else (other
 * departments, an administrator without the role, an installer, an Installation Manager of another project) is
 * refused. Stage skipping and stale screens are refused for every stage too.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createDispatch, advanceDispatch, receiveDispatch, moveDispatchBack } from "@/server/services/dispatch";
import { advanceComplaint, moveComplaintBack } from "@/server/services/complaint";
import { loadDefinition } from "@/server/services/flow-core";
import type { FlowDefinition } from "@/domain/flow";
import { freshDb, idOf } from "./helpers";
import { PEOPLE, errKind, flowKit } from "./flow-helpers";

let db: Db;
const k = flowKit(() => db);
let dispatchDef: FlowDefinition, complaintDef: FlowDefinition;
let dispatchId = "", complaintId = "";
const WHO = Object.entries(PEOPLE).filter(([key]) => key !== "reportingManager") as Array<[string, string]>;

beforeAll(async () => {
  db = await freshDb();
  dispatchDef = (await loadDefinition(db, "dispatch")).def;
  complaintDef = (await loadDefinition(db, "complaint")).def;
  const order = await idOf(db, "sales_order", "ORD-001");
  const r = await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId: order, types: ["D1"], factory: "Main factory", items: [{ componentId: await idOf(db, "component", "CMP-001"), quantity: "4" }] });
  dispatchId = r.dispatchId;
  await k.toSite(dispatchId);
  const c = await k.receive(dispatchId, { [await idOf(db, "component", "CMP-001")]: { kind: "damaged", quantity: "1" } });
  complaintId = c.complaints[0]!.id;
}, 240_000);
afterAll(async () => { await db?.close(); });

/** What a person's attempt on a stage should produce: owners get past the role check, others are refused. */
function expectedFor(owner: string, who: string) {
  if (who === "otherIm") return "forbidden"; // holds the IM role but not this project
  return who === owner ? "past-permission" : "forbidden";
}

describe("dispatch: only the owning role can act on each stage", () => {
  it("covers every stage with an owner", () => {
    expect(dispatchDef.stages.filter((s) => s.owner !== "system").length).toBeGreaterThanOrEqual(8);
  });
  const stages = () => dispatchDef.stages.filter((s) => s.owner !== "system" && s.handler !== "create");
  it("matrix", async () => {
    const rows: string[] = [];
    for (const s of stages()) {
      for (const [who, bid] of WHO) {
        await k.placeAt("dispatch", dispatchId, s.code);
        const st = await k.state(dispatchId);
        const call = s.handler === "receive_mnd"
          ? receiveDispatch(await k.as(bid), { dispatchId, version: st.version, stage: s.code, lines: (await k.lines(dispatchId)).map((l) => ({ itemId: l.id, ok: true })) })
          : advanceDispatch(await k.as(bid), { dispatchId, version: st.version, stage: s.code, values: {} });
        const got = await errKind(call);
        const want = expectedFor(s.owner, who);
        const ok = want === "forbidden" ? got === "forbidden" : got !== "forbidden";
        if (!ok) rows.push(`${s.code} as ${who}: got ${got}, want ${want}`);
      }
    }
    expect(rows).toEqual([]);
  });
  it("the creation stage is Factory / Dispatch only", async () => {
    const order = await idOf(db, "sales_order", "ORD-001");
    const comp = await idOf(db, "component", "CMP-002");
    for (const [who, bid] of WHO) {
      const got = await errKind(createDispatch(await k.as(bid), { orderId: order, types: ["D2"], factory: "Main factory", items: [{ componentId: comp, quantity: "1" }] }));
      expect(`${who}:${got === "forbidden" ? "forbidden" : "allowed"}`).toBe(`${who}:${who === "factory_dispatch" ? "allowed" : "forbidden"}`);
    }
  });
  it("no stage can be skipped and stale screens are refused, for every stage", async () => {
    for (const s of stages()) {
      await k.placeAt("dispatch", dispatchId, s.code);
      const st = await k.state(dispatchId);
      const later = dispatchDef.stages.find((x) => dispatchDef.stages.indexOf(x) > dispatchDef.stages.indexOf(s) && x.owner === s.owner && x.code !== s.code);
      if (later) expect(await errKind(advanceDispatch(await k.as(PEOPLE[s.owner as keyof typeof PEOPLE]), { dispatchId, version: st.version, stage: later.code, values: {} }))).toBe("conflict");
      expect(await errKind(advanceDispatch(await k.as(PEOPLE[s.owner as keyof typeof PEOPLE]), { dispatchId, version: st.version - 1, stage: s.code, values: {} }))).toBe("conflict");
    }
  });
  it("back moves: only the stage owner (not Management, finding F2), never without a reason", async () => {
    await k.placeAt("dispatch", dispatchId, "eway_bill");
    const st = await k.state(dispatchId);
    const input = { dispatchId, version: st.version, stage: "eway_bill", to: "tax_invoice", reason: "Wrong GSTIN" };
    expect(await errKind(moveDispatchBack(await k.as(PEOPLE.store), input))).toBe("forbidden");
    expect(await errKind(moveDispatchBack(await k.as(PEOPLE.accounts), { ...input, reason: "" }))).toBe("validation");
    expect(await errKind(moveDispatchBack(await k.as(PEOPLE.management), input))).toBe("forbidden");
    expect(await errKind(moveDispatchBack(await k.as(PEOPLE.accounts), input))).toBe("ok");
  });
});

describe("complaint: only the owning role can act on each stage", () => {
  it("matrix", async () => {
    const rows: string[] = [];
    for (const s of complaintDef.stages.filter((x) => x.owner !== "system")) {
      for (const [who, bid] of WHO) {
        await k.placeAt("complaint", complaintId, s.code);
        const st = await k.cstate(complaintId);
        const got = await errKind(advanceComplaint(await k.as(bid), { complaintId, version: st.version, stage: s.code, values: {} }));
        // The cost gate also refuses the person who costed it; nobody has costed this complaint, so the role decides.
        const want = expectedFor(s.owner, who);
        const ok = want === "forbidden" ? got === "forbidden" : got !== "forbidden";
        if (!ok) rows.push(`${s.code} as ${who}: got ${got}, want ${want}`);
      }
    }
    expect(rows).toEqual([]);
  });
  it("automatic stages cannot be completed by anyone", async () => {
    for (const s of complaintDef.stages.filter((x) => x.owner === "system" && !x.terminal)) {
      for (const [, bid] of WHO) {
        await k.placeAt("complaint", complaintId, s.code);
        const st = await k.cstate(complaintId);
        expect(await errKind(advanceComplaint(await k.as(bid), { complaintId, version: st.version, stage: s.code, values: {} }))).toBe("conflict");
      }
    }
  });
  it("back moves need a listed stage and a reason", async () => {
    await k.placeAt("complaint", complaintId, "planning_costing");
    const st = await k.cstate(complaintId);
    expect(await errKind(moveComplaintBack(await k.as(PEOPLE.planning), { complaintId, version: st.version, stage: "planning_costing", to: "qc_review", reason: " " }))).toBe("validation");
    expect(await errKind(moveComplaintBack(await k.as(PEOPLE.planning), { complaintId, version: st.version, stage: "planning_costing", to: "store_check", reason: "Recheck" }))).toBe("validation");
    expect(await errKind(moveComplaintBack(await k.as(PEOPLE.planning), { complaintId, version: st.version, stage: "planning_costing", to: "qc_review", reason: "Recheck photos" }))).toBe("ok");
  });
});
