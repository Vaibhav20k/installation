/**
 * The Complaints view for the Installation Manager: scope (own projects only, nothing for installers or another
 * project's IM), no cost, the five phases as a complaint moves, the "item in stock" skip, overdue-first sorting,
 * and recently closed complaints (last 30 days only).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createDispatch } from "@/server/services/dispatch";
import { loadDefinition } from "@/server/services/flow-core";
import { complaintTracker, trackerCounts } from "@/server/queries/complaint-tracker";
import { unmappedStages } from "@/domain/complaint-phases";
import { actor, freshDb, idOf } from "./helpers";
import { NOW, PEOPLE, flowKit } from "./flow-helpers";

let db: Db;
const k = flowKit(() => db);
let first = "", second = "";
const DAY = 86_400_000;
const track = async (bid: string, now = NOW) => complaintTracker(db, await actor(db, bid), now);

beforeAll(async () => {
  db = await freshDb();
  const order = await idOf(db, "sales_order", "ORD-001");
  const [a, b] = [await idOf(db, "component", "CMP-001"), await idOf(db, "component", "CMP-002")];
  const r = await createDispatch(await k.as(PEOPLE.factory_dispatch), { orderId: order, types: ["D1", "D2"], factory: "Main factory", items: [{ componentId: a, quantity: "4" }, { componentId: b, quantity: "2" }] });
  await k.toSite(r.dispatchId);
  const got = await k.receive(r.dispatchId, { [a]: { kind: "damaged", quantity: "1" }, [b]: { kind: "missing", quantity: "1" } });
  [first, second] = got.complaints.map((c) => c.id) as [string, string];
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("complaint tracker", () => {
  it("covers every stage of the active complaint definition", async () => {
    expect(unmappedStages((await loadDefinition(db, "complaint")).def)).toEqual([]);
  });

  it("shows the IM the complaints they raised, at Planning, without cost", async () => {
    const list = await track(PEOPLE.installation_manager);
    expect(list.map((c) => c.id).sort()).toEqual([first, second].sort());
    for (const c of list) {
      expect(c.raised_by_me).toBe(true);
      expect(c.track.phase).toBe("planning");
      expect(c.track.waitingFor).toBe("Planning team");
      expect(c).not.toHaveProperty("cost");
    }
    expect(trackerCounts(list)).toMatchObject({ open: 2, closed: 0, byPhase: { planning: 2, purchase: 0 } });
  });

  it("never widens scope: another project's IM and an installer see nothing; a factory department sees all", async () => {
    expect(await track(PEOPLE.otherIm)).toEqual([]);
    expect(await track(PEOPLE.installer)).toEqual([]);
    const qc = await track(PEOPLE.qc);
    expect(qc.map((c) => c.id).sort()).toEqual([first, second].sort());
    expect(qc.every((c) => !c.raised_by_me)).toBe(true);
  });

  it("follows the complaint through the phases, skipping Purchase, QC and Production when the item is in stock", async () => {
    await k.cstep(PEOPLE.qc, first, { review: "Confirmed damaged in transit" });
    await k.cstep(PEOPLE.planning, first, { cost: "1200" });
    await k.cstep(PEOPLE.management, first, { decision: "approve" });
    await k.cstep(PEOPLE.planning, first, { plan: "Send from stock", target_date: "2026-11-05" });
    await k.cstep(PEOPLE.store, first, { item_source: "fg_in_stock" });
    const c = (await track(PEOPLE.installation_manager)).find((x) => x.id === first)!;
    expect(c.stage).toBe("ready_for_dispatch");
    expect(c.track.phase).toBe("dispatched");
    expect(c.track.waitingFor).toBe("Factory dispatch");
    expect(c.track.steps.map((s) => s.state)).toEqual(["done", "skipped", "skipped", "skipped", "current"]);
  });

  it("puts overdue complaints first, then the oldest", async () => {
    // Ten days on, the one still at QC review (SLA 1 day) is overdue; Ready for dispatch (SLA 1 day) is too.
    const later = await track(PEOPLE.installation_manager, NOW + 10 * DAY);
    expect(later.every((c) => c.overdue)).toBe(true);
    await db.query("update complaint set stage_entered_at = $2 where id = $1", [first, new Date(NOW + 10 * DAY).toISOString()]);
    const list = await track(PEOPLE.installation_manager, NOW + 10 * DAY);
    expect(list.map((c) => [c.id, c.overdue])).toEqual([[second, true], [first, false]]);
  });

  it("keeps closed complaints for 30 days, after the open ones", async () => {
    await db.query("update complaint set status = 'closed', outcome = 'replaced', stage = 'closed', closed_at = $2 where id = $1", [first, new Date(NOW - 2 * DAY).toISOString()]);
    const list = await track(PEOPLE.installation_manager);
    expect(list.map((c) => [c.id, c.status])).toEqual([[second, "open"], [first, "closed"]]);
    const closed = list[1]!;
    expect(closed.track.phase).toBe("done");
    expect(closed.track.waitingFor).toBeNull();
    expect(closed.track.steps.at(-1)!.state).toBe("done");
    expect(trackerCounts(list)).toMatchObject({ open: 1, closed: 1 });
    await db.query("update complaint set closed_at = $2 where id = $1", [first, new Date(NOW - 40 * DAY).toISOString()]);
    expect((await track(PEOPLE.installation_manager)).map((c) => c.id)).toEqual([second]);
  });

  it("reads priority only when the column exists", async () => {
    const [col] = await db.query("select 1 from information_schema.columns where table_name = 'complaint' and column_name = 'priority'");
    const list = await track(PEOPLE.installation_manager);
    if (!col) expect(list.every((c) => c.priority === null)).toBe(true);
    else expect(list.every((c) => c.priority === null || ["normal", "high", "urgent"].includes(c.priority))).toBe(true);
  });
});
