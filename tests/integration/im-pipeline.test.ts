import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createDispatch } from "@/server/services/dispatch";
import { setJourney } from "@/server/services/customer";
import { dispatchableOrders } from "@/server/queries/dispatch";
import { imPipeline, TILE_KEYS, type TileKey } from "@/server/queries/im-pipeline";
import { actor, freshDb, idOf } from "./helpers";
import { flowKit, NOW, PEOPLE } from "./flow-helpers";

const DAY = 86_400_000;
let db: Db;
const kit = flowKit(() => db);
const IM = PEOPLE.installation_manager;
const ids: Record<string, string> = {};
let projectId = "";

/** Every tile's count equals its list, and each dispatch is in at most one tile. */
async function pipeFor(bid: string, now = NOW) {
  const p = (await imPipeline(db, await actor(db, bid), now))!;
  for (const t of p.tiles) {
    expect(t.n, t.key).toBe(p.rows[t.key].length);
    expect(t.overdue, t.key).toBe(p.rows[t.key].filter((r) => r.overdue).length);
  }
  const all = TILE_KEYS.filter((k) => k !== "handover").flatMap((k) => p.rows[k].map((r) => r.key));
  expect(new Set(all).size).toBe(all.length);
  const where = (id: string) => TILE_KEYS.find((k) => p.rows[k].some((r) => r.key === id)) as TileKey | undefined;
  const row = (id: string) => TILE_KEYS.flatMap((k) => p.rows[k]).find((r) => r.key === id);
  return { ...p, where, row };
}

async function installStart(id: string) { await kit.step(IM, id, { start_date: "2026-10-27" }); }
async function installDone(id: string) { await kit.step(IM, id, {}, { photos: await kit.upload(IM) }); }

beforeAll(async () => {
  db = await freshDb();
  const order = await idOf(db, "sales_order", "ORD-001");
  [{ project_id: projectId }] = (await db.query<{ project_id: string }>("select project_id from sales_order where id = $1", [order])) as [{ project_id: string }];
  const o = (await dispatchableOrders(db, await actor(db, PEOPLE.factory_dispatch))).orders.find((x) => x.id === order)!;
  const line = (g: string) => o.lines.filter((l) => l.dispatch_group === g && Number(l.left) > 0).map((l) => ({ componentId: l.id, quantity: l.left }));
  const f = await kit.as(PEOPLE.factory_dispatch);
  for (const [type, group] of [["D1", "carcass"], ["D2", "shutters"], ["D3a", "countertop"], ["D3b", "backsplash"]] as const) {
    ids[type] = (await createDispatch(f, { orderId: order, types: [type], factory: "Main factory", items: line(group) })).dispatchId;
  }
  // D1 on site being fitted, D2 on the truck, D3a received, D3b still waiting for the site check; one more at Accounts.
  await kit.toSite(ids.D1!); await kit.receive(ids.D1!); await installStart(ids.D1!);
  await kit.toSite(ids.D2!);
  await kit.toSite(ids.D3a!); await kit.receive(ids.D3a!);
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("Installation Manager pipeline", () => {
  it("buckets each dispatch by the step it waits for and what it carries", async () => {
    const p = await pipeFor(IM);
    expect(p.where(ids.D1!)).toBe("install1");
    expect(p.where(ids.D2!)).toBe("dispatched");
    expect(p.where(ids.D3a!)).toBe("received");
    expect(p.where(ids.D3b!)).toBe("ready");
    expect(p.tiles.map((t) => t.key)).toEqual([...TILE_KEYS]);
  });

  it("gives the IM one button for their own steps, linked to the dispatch's step form", async () => {
    const p = await pipeFor(IM);
    expect(p.row(ids.D3b!)!.action).toEqual({ label: "Confirm site ready", href: `/dispatch/${ids.D3b}#h-now` });
    expect(p.row(ids.D2!)!.action!.label).toBe("Mark received");
    expect(p.row(ids.D3a!)!.action!.label).toBe("Start installation");
    expect(p.row(ids.D1!)!.action!.label).toBe("Installation done");
    expect(p.row(ids.D1!)!.what).toBe("D1 Carcass");
    expect(p.tiles.find((t) => t.key === "ready")!.mine).toBe(1);
  });

  it("shows Waiting for accounts / factory instead of a button on other people's steps", async () => {
    await kit.step(IM, ids.D3b!, { status: "ready" });
    let p = await pipeFor(IM);
    expect(p.where(ids.D3b!)).toBe("ready");
    expect(p.row(ids.D3b!)!.action).toBeNull();
    expect(p.row(ids.D3b!)!.waiting).toBe("Waiting for accounts");
    await kit.step(PEOPLE.accounts, ids.D3b!, { invoice_no: "INV-9" }, { invoice_file: await kit.upload(PEOPLE.accounts, "document") });
    await kit.step(PEOPLE.accounts, ids.D3b!, { eway_no: "EWB-9" }, { eway_file: await kit.upload(PEOPLE.accounts, "document") });
    p = await pipeFor(IM);
    expect(p.row(ids.D3b!)!.waiting).toBe("Waiting for factory");
  });

  it("turns a tile red once something in it is past its step's SLA", async () => {
    const later = await pipeFor(IM, NOW + 20 * DAY);
    expect(later.tiles.find((t) => t.key === "install1")!.overdue).toBe(1);
    expect(later.row(ids.D1!)!.overdue).toBe(true);
    expect((await pipeFor(IM)).tiles.find((t) => t.key === "install1")!.overdue).toBe(0);
  });

  it("keeps to the IM's scope: another project's IM sees none of it, and an admin sees it without IM buttons", async () => {
    const other = await pipeFor(PEOPLE.otherIm);
    for (const id of Object.values(ids)) expect(other.where(id)).toBeUndefined();
    const admin = await pipeFor(PEOPLE.admin);
    expect(admin.where(ids.D1!)).toBe("install1");
    expect(admin.row(ids.D1!)!.action).toBeNull();
    expect(admin.row(ids.D1!)!.waiting).toBe("Waiting for the Installation Manager");
  });

  it("is only for Installation Managers and administrators", async () => {
    expect(await imPipeline(db, await actor(db, PEOPLE.factory_dispatch), NOW)).toBeNull();
    expect(await imPipeline(db, await actor(db, PEOPLE.installer), NOW)).toBeNull();
  });

  it("lists a project for final handover only once everything is installed, until the journey says handed over", async () => {
    expect((await pipeFor(IM)).rows.handover.map((r) => r.key)).not.toContain(projectId);
    await installDone(ids.D1!);
    await kit.receive(ids.D2!); await installStart(ids.D2!); await installDone(ids.D2!);
    await installStart(ids.D3a!); await installDone(ids.D3a!);
    await kit.step(PEOPLE.factory_dispatch, ids.D3b!, { vehicle_no: "HR26 AB 9", driver: "Ramesh", dispatch_date: "2026-10-27" });
    await kit.receive(ids.D3b!); await installStart(ids.D3b!);
    // Every truck but one is done: still not ready to hand over.
    expect((await pipeFor(IM)).rows.handover.map((r) => r.key)).not.toContain(projectId);
    await installDone(ids.D3b!);

    // Other orders on the same project still have BOM to send, so the site is not finished until they are too.
    const left = (await dispatchableOrders(db, await actor(db, PEOPLE.factory_dispatch))).orders
      .filter((o) => o.lines.some((l) => l.dispatch_group && l.dispatch_group !== "other" && Number(l.left) > 0));
    const ours = (await db.query<{ id: string }>("select id from sales_order where project_id = $1", [projectId])).map((r) => r.id);
    const f = await kit.as(PEOPLE.factory_dispatch);
    const code = { carcass: "D1", shutters: "D2", countertop: "D3a", backsplash: "D3b" } as Record<string, string>;
    for (const o of left.filter((x) => ours.includes(x.id))) {
      expect((await pipeFor(IM)).rows.handover.map((r) => r.key)).not.toContain(projectId);
      for (const g of Object.keys(code)) {
        const items = o.lines.filter((l) => l.dispatch_group === g && Number(l.left) > 0).map((l) => ({ componentId: l.id, quantity: l.left }));
        if (!items.length) continue;
        const id = (await createDispatch(f, { orderId: o.id, types: [code[g]!], factory: "Main factory", items })).dispatchId;
        await kit.toSite(id); await kit.receive(id); await installStart(id); await installDone(id);
      }
    }

    const p = await pipeFor(IM);
    const row = p.rows.handover.find((r) => r.key === projectId)!;
    expect(row.action).toEqual({ label: "Mark handed over", href: `/projects/${projectId}?tab=customer` });
    expect(p.tiles.find((t) => t.key === "handover")!.n).toBe(p.rows.handover.length);
    expect((await pipeFor(PEOPLE.otherIm)).rows.handover.map((r) => r.key)).not.toContain(projectId);

    await setJourney(await kit.as(IM), { projectId, stage: "handover" });
    expect((await pipeFor(IM)).rows.handover.map((r) => r.key)).not.toContain(projectId);
  });
});
