/**
 * Ready for dispatch before the factory has added the item list (owner decision, 28 Oct 2026). The factory must
 * say so explicitly; the dispatch then runs the normal flow with no BOM lines, and the Installation Manager
 * reports anything missing or damaged as items not on the list at receipt.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createDispatch, receiveDispatch } from "@/server/services/dispatch";
import { dispatchDetail } from "@/server/queries/dispatch";
import { actor, freshDb, idOf } from "./helpers";
import { NOW, PEOPLE, errKind, errText, flowKit } from "./flow-helpers";

let db: Db;
const k = flowKit(() => db);
let order = "", carcass = "";

beforeAll(async () => {
  db = await freshDb();
  order = await idOf(db, "sales_order", "ORD-001");
  carcass = await idOf(db, "component", "CMP-001");
}, 240_000);
afterAll(async () => { await db?.close(); });

const base = { orderId: "", types: ["D1"], factory: "Main factory" };
const asFactory = async () => k.as(PEOPLE.factory_dispatch);

describe("ready for dispatch without the item list", () => {
  it("is refused when no lines are chosen and the factory has not said the list is missing", async () => {
    expect(await errText(createDispatch(await asFactory(), { ...base, orderId: order, items: [] }))).toMatch(/item list/i);
  });

  it("is refused when the factory says the list is missing but still sends lines", async () => {
    expect(await errKind(createDispatch(await asFactory(), { ...base, orderId: order, withoutList: true, items: [{ componentId: carcass, quantity: "1" }] }))).toBe("validation");
  });

  it("creates a dispatch with no lines, tells the next step, and records that the list was missing", async () => {
    const { dispatchId } = await createDispatch(await asFactory(), { ...base, orderId: order, withoutList: true, note: "List follows from design" });
    const [h] = await db.query<{ data: { without_list?: boolean; lines?: number } }>("select data from stage_history where subject_id = $1 order by seq limit 1", [dispatchId]);
    expect(h!.data).toMatchObject({ without_list: true, lines: 0 });
    const d = await dispatchDetail(db, await actor(db, PEOPLE.installation_manager), dispatchId, NOW);
    expect(d!.items).toHaveLength(0);

    // At site the Installation Manager confirms nothing is missing, and the dispatch moves on.
    await k.toSite(dispatchId);
    const s = await k.state(dispatchId);
    await receiveDispatch(await k.as(PEOPLE.installation_manager), { dispatchId, version: s.version, stage: s.stage, lines: [], nothingMissing: true });
    expect((await k.state(dispatchId)).stage).toBe("installation_started");
  });

  it("is still limited to the factory dispatch role", async () => {
    expect(await errKind(createDispatch(await k.as(PEOPLE.installation_manager), { ...base, orderId: order, withoutList: true }))).toBe("forbidden");
  });
});
