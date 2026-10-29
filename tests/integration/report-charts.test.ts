import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { kraReview } from "@/server/queries/kra";
import { kraTrend } from "@/server/queries/report-charts";
import { actor, freshDb } from "./helpers";

const NOW = Date.parse("2026-10-21T06:00:00Z");
let db: Db;
beforeAll(async () => { db = await freshDb({ operational: true }); }, 240_000);
afterAll(async () => { await db?.close(); });

describe("report chart aggregates", () => {
  it("KRA trend agrees with the KRA review for the selected month and is zero-filled before it", async () => {
    for (const id of ["EMP-004", "EMP-001"]) {
      const who = await actor(db, id);
      const t = await kraTrend(db, who, "2026-10");
      expect(t.months).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
      const k = await kraReview(db, who, { month: "2026-10" }, NOW);
      const repeat = k.rows.find((r) => r.code === "repeat_visits")!;
      expect(repeat.actual).toBe(`${t.unplannedRepeats.at(-1)} unplanned`);
      const complaints = k.rows.find((r) => r.code === "complaint_reduction")!;
      expect(complaints.coverage.startsWith(`${t.complaints.at(-1)} complaint(s)`)).toBe(true);
      expect(t.complaints.length).toBe(6);
    }
  });
});
