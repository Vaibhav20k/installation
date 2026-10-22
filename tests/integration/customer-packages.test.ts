import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { makeCtx } from "@/server/services/context";
import { addDesignRevision, createDesignRequest, customerDetail, decideDesignRequest, logCommunication, setJourney } from "@/server/services/customer";
import { addPackage, decidePackageException, packageBoard, recordScan } from "@/server/services/packages";
import { AppError } from "@/server/errors";
import { actor, freshDb, idOf } from "./helpers";

const NOW = Date.parse("2026-10-16T06:00:00Z");
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };
let db: Db, p = "", o = "";
const as = async (bid: string) => makeCtx(db, await actor(db, bid), NOW);

beforeAll(async () => {
  db = await freshDb({ operational: true });
  p = await idOf(db, "project", "PRJ-004"); o = await idOf(db, "sales_order", "ORD-005");
});
afterAll(async () => { await db.close(); });

describe("customer coordination (scenario 64)", () => {
  it("a logged conversation never claims delivery; future events are refused", async () => {
    await setJourney(await as("EMP-008"), { projectId: p, stage: "installation", ownerId: (await actor(db, "EMP-008")).id });
    expect(await kind(logCommunication(await as("EMP-008"), { projectId: p, channel: "call", direction: "to_customer", summary: "Will call tomorrow", date: "2026-10-20", time: "10:00" }))).toBe("validation");
    await logCommunication(await as("EMP-008"), { projectId: p, channel: "call", direction: "to_customer", summary: "Explained countertop delay", commitment: "Slab on site by Thursday", date: "2026-10-16", time: "10:30" });
    const c = await customerDetail(db, await actor(db, "EMP-008"), p);
    expect(c.journey?.stage).toBe("installation");
    expect(c.logs[0]!.acknowledgement).toBe("not_requested");
  });

  it("with no approved revision limit, revisions never block; the requester cannot approve their own request", async () => {
    const r = await createDesignRequest(await as("EMP-008"), { projectId: p, kind: "design", origin: "customer", brief: "Move the tall unit 300 mm left", reason: "Fridge size changed" });
    for (let i = 0; i < 4; i++) {
      const v = await addDesignRevision(await as("EMP-008"), { requestId: r.id, cause: i % 2 ? "designer_correction" : "customer_change", reason: `Round ${i + 1}` });
      expect(v.needsEscalation).toBe(false);
      expect(v.limitConfigured).toBe(false);
    }
    expect(await kind(decideDesignRequest(await as("EMP-008"), { requestId: r.id, decision: "approved" }))).toBe("forbidden");
    await decideDesignRequest(await as("EMP-001"), { requestId: r.id, decision: "approved" });
  });
});

describe("packages (scenarios 59, 60)", () => {
  it("dispatched but not receipt-scanned is 'receipt unverified', repeat scans do not inflate counts, unknown codes become exceptions", async () => {
    await addPackage(await as("EMP-008"), { projectId: p, orderId: o, code: "PKG-K-01", description: "Base carcasses 1/3", weightKg: 42 });
    await addPackage(await as("EMP-008"), { projectId: p, orderId: o, code: "PKG-K-02", description: "Countertop slab", highValue: true });
    await recordScan(await as("EMP-008"), { projectId: p, code: "PKG-K-01", kind: "dispatch", clientEventId: "dispatch-0001", method: "manual" });
    await recordScan(await as("EMP-008"), { projectId: p, code: "PKG-K-02", kind: "dispatch", clientEventId: "dispatch-0002", method: "manual" });
    // Receipt of box 1 scanned twice by mistake, and the same tap retried (same event id).
    const first = await recordScan(await as("EMP-008"), { projectId: p, code: "PKG-K-01", kind: "receipt", clientEventId: "receipt-0001", method: "camera" });
    const retry = await recordScan(await as("EMP-008"), { projectId: p, code: "PKG-K-01", kind: "receipt", clientEventId: "receipt-0001", method: "camera" });
    await recordScan(await as("EMP-008"), { projectId: p, code: "PKG-K-01", kind: "receipt", clientEventId: "receipt-0002", method: "manual" });
    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    const unknown = await recordScan(await as("EMP-008"), { projectId: p, code: "PKG-ZZ-99", kind: "receipt", clientEventId: "receipt-0003", method: "manual" });
    expect(unknown.known).toBe(false);
    expect(unknown.exceptionId).toBeTruthy();
    const b = await packageBoard(db, await actor(db, "EMP-008"), p, NOW);
    expect(b.packages.map((x) => [x.code, x.status])).toEqual([["PKG-K-01", "received"], ["PKG-K-02", "receipt_unverified"]]);
    expect(b.counts).toMatchObject({ total: 2, received: 1, unverified: 1 });
    expect(b.exceptions.map((x) => x.kind)).toEqual(["unknown_scan"]);
  });

  it("damage opens one exception; responsibility and charge are separate manager decisions", async () => {
    const d = await recordScan(await as("EMP-008"), { projectId: p, code: "PKG-K-01", kind: "damage", clientEventId: "damage-0001", method: "manual", note: "Corner crushed" });
    expect(await kind(decidePackageException(await as("EMP-008"), { id: d.exceptionId!, responsibleFunction: "Logistics" }))).toBe("forbidden");
    await decidePackageException(await as("EMP-001"), { id: d.exceptionId!, responsibleFunction: "Logistics", replacementStatus: "approved" });
    const [x] = await db.query<{ responsible_function: string; charge_type: string | null; replacement_status: string }>("select responsible_function, charge_type, replacement_status from package_exception where id = $1", [d.exceptionId]);
    expect(x).toEqual({ responsible_function: "Logistics", charge_type: null, replacement_status: "approved" });
    expect(await kind(recordScan(await as("EMP-008"), { projectId: await idOf(db, "project", "PRJ-001"), code: "PKG-K-01", kind: "receipt", clientEventId: "receipt-0009", method: "manual" }))).toBe("validation");
  });
});
