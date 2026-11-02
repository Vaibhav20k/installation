/**
 * Demo sign-in must survive several server copies (Vercel): each copy seeds its own database with different random
 * ids, so the cookie holds the employee number, which is the same on every copy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { loadActor, resolveActor } from "@/server/auth/actor";
import { freshDb, idOf } from "./helpers";

let db: Db, second: Db;
beforeAll(async () => { db = await freshDb(); second = await freshDb(); }, 240_000);
afterAll(async () => { await db?.close(); await second?.close(); });

describe("demo identity across server copies", () => {
  it("gets different ids on two copies, so an id alone cannot identify a person", async () => {
    expect(await idOf(db, "employee", "EMP-016")).not.toBe(await idOf(second, "employee", "EMP-016"));
  });
  it("finds the same person on another copy from the employee number", async () => {
    const here = await resolveActor(db, "EMP-016");
    const there = await resolveActor(second, "EMP-016");
    expect(there.businessId).toBe("EMP-016");
    expect(there.name).toBe(here.name);
  });
  it("still accepts a cookie holding an id from before this change", async () => {
    expect((await loadActor(db, await idOf(db, "employee", "EMP-016")))?.businessId).toBe("EMP-016");
  });
  it("rejects unknown numbers, malformed values and inactive people", async () => {
    expect(await loadActor(db, "EMP-99999")).toBeNull();
    expect(await loadActor(db, "EMP-016' or '1'='1")).toBeNull();
    expect(await loadActor(db, "")).toBeNull();
    await db.query("update employee set active = false where business_id = 'EMP-017'");
    expect(await loadActor(db, "EMP-017")).toBeNull();
    await expect(resolveActor(db, "nobody")).rejects.toMatchObject({ kind: "unauthenticated" });
  });
});
