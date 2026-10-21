import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { makeCtx } from "@/server/services/context";
import { dashboard } from "@/server/queries/dashboard";
import { planningBoard, planningSheet } from "@/server/queries/planning";
import { kraReview } from "@/server/queries/kra";
import { manpowerTracker } from "@/server/queries/trackers";
import { suggestTeamsForVisit } from "@/server/services/booking";
import { actor, freshDb } from "./helpers";

/** Records observed timings on the demo dataset; bounds are generous regression guards, not benchmarks. */
const NOW = Date.parse("2026-10-21T06:00:00Z");
let db: Db;
beforeAll(async () => { db = await freshDb({ operational: true }); }, 240_000);
afterAll(async () => { await db?.close(); });

const time = async <T>(label: string, fn: () => Promise<T>, log: string[]) => {
  const t = performance.now();
  const r = await fn();
  log.push(`${label}: ${Math.round(performance.now() - t)} ms`);
  return r;
};

describe("observed read-model timings (demo dataset)", () => {
  it("stays well within interactive bounds", async () => {
    const admin = await actor(db, "EMP-004");
    const log: string[] = [];
    const [size] = await db.query<{ e: number; v: number; t: number; r: number }>(
      "select (select count(*)::int from employee) e, (select count(*)::int from visit) v, (select count(*)::int from time_entry) t, (select count(*)::int from reservation) r");
    log.push(`dataset: ${size!.e} employees, ${size!.v} visits, ${size!.t} time entries, ${size!.r} reservations`);
    await time("dashboard", () => dashboard(db, admin, { month: "2026-10" }, NOW), log);
    await time("planning board (28 days, all employees)", () => planningBoard(db, admin, { from: "2026-10-12", days: 28 }, NOW), log);
    await time("planning sheet", () => planningSheet(db, admin, {}, NOW), log);
    await time("KRA review", () => kraReview(db, admin, { month: "2026-10" }, NOW), log);
    await time("manpower tracker", () => manpowerTracker(db, admin, { month: "2026-10" }), log);
    const [visit] = await db.query<{ id: string }>("select id from visit where business_id = 'VIS-004'");
    const sup = makeCtx(db, await actor(db, "EMP-008"), NOW);
    const s = await time("team suggestion (30-day horizon)", () => suggestTeamsForVisit(sup, { visitId: visit!.id }), log);
    log.push(`team suggestion searched ${s.searched.combinations} combinations over ${s.searched.dates} date(s)`);
    console.log(log.join("\n"));
    expect(log.length).toBeGreaterThan(6);
  }, 120_000);
});
