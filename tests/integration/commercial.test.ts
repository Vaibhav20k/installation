import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { makeCtx } from "@/server/services/context";
import { commercialSummary, decideAdditionalWork, pendingAdditionalWork, requestAdditionalWork, setInstallationCharge } from "@/server/services/commercial";
import { clockIn, clockOut, setOvertimeReason } from "@/server/services/attendance";
import { reviewEligibility } from "@/server/services/time";
import { AppError } from "@/server/errors";
import { actor, clockInPhoto, freshDb, idOf } from "./helpers";

const NOW = Date.parse("2026-10-16T06:00:00Z");
const at = (hhmm: string, day = "2026-10-16") => Date.parse(`${day}T${hhmm}+05:30`);
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };
let db: Db;
const as = async (bid: string, now = NOW) => makeCtx(db, await actor(db, bid), now);
const asId = async (id: string, now = NOW) => makeCtx(db, (await loadActor(db, id))!, now);

beforeAll(async () => { db = await freshDb({ operational: true }); });
afterAll(async () => { await db.close(); });

describe("additional work and charges (requirements 8, 9; scenario 58)", () => {
  it("records a request; the requester cannot approve it; chargeable needs a quoted amount; free of charge is allowed", async () => {
    const p = await idOf(db, "project", "PRJ-004"), o = await idOf(db, "sales_order", "ORD-005"), v = await idOf(db, "visit", "VIS-006");
    const r = await requestAdditionalWork(await as("EMP-008"), { projectId: p, orderId: o, visitId: v, description: "Extra wall shelf beside the fridge", requestedBy: "customer", reason: "Asked on site", estimatedMinutes: 90 });
    expect(r.businessId).toBe("AW-001");
    expect((await pendingAdditionalWork(db, await actor(db, "EMP-001"))).map((x) => x.business_id)).toEqual(["AW-001"]);
    expect(await kind(decideAdditionalWork(await as("EMP-001"), { id: r.id, decision: "approved", chargeType: "chargeable" }))).toBe("validation");
    await decideAdditionalWork(await as("EMP-001"), { id: r.id, decision: "approved", chargeType: "chargeable", quotedAmountMinor: 450000, plannedCostMinor: 120000, commercialRef: "QT-77" });
    expect(await kind(decideAdditionalWork(await as("EMP-001"), { id: r.id, decision: "rejected" }))).toBe("conflict");
    const own = await requestAdditionalWork(await as("EMP-001"), { projectId: p, orderId: o, description: "Free trim touch-up", requestedBy: "site_team", reason: "Goodwill" });
    expect(await kind(decideAdditionalWork(await as("EMP-001"), { id: own.id, decision: "approved", chargeType: "free_of_charge" }))).toBe("forbidden");
    await decideAdditionalWork(await as("EMP-004"), { id: own.id, decision: "approved", chargeType: "free_of_charge" });
  });

  it("charges, waivers, estimates, budgets and costs stay separate; no profit figure exists", async () => {
    const p = await idOf(db, "project", "PRJ-004"), o = await idOf(db, "sales_order", "ORD-005");
    expect(await kind(setInstallationCharge(await as("EMP-001"), { projectId: p, orderId: o, quotedMinor: 100, waivedMinor: 200, source: "Quotation" }))).toBe("validation");
    await setInstallationCharge(await as("EMP-001"), { projectId: p, orderId: o, quotedMinor: 2500000, waivedMinor: 500000, source: "Quotation", reference: "Q-2026-88" });
    const s = await commercialSummary(db, await actor(db, "EMP-001"), p);
    expect(s.totals).toMatchObject({ quoted: 2500000, waived: 500000, charged: 2000000, additionalChargeable: 450000, freeOfCharge: 1 });
    expect(Object.keys(s.totals)).not.toContain("profit");
  });
});

describe("overtime period and eligibility for attendance time (scenario 51)", () => {
  it("work after clock-in + 8 h is outside schedule even inside the old 10:00–19:00 calendar; future work brought forward can be eligible", async () => {
    const [w] = await db.query<{ id: string }>("select id from employee where business_id = 'EMP-033'");
    await clockIn(await asId(w!.id, at("08:00")), { photoDraftKey: await clockInPhoto(db, w!.id, at("08:00")) });
    const [s] = await db.query<{ id: string }>("select id from shift_instance where employee_id = $1", [w!.id]);
    await setOvertimeReason(await asId(w!.id, at("16:30")), { shiftId: s!.id, reason: "future_task" });
    await clockOut(await asId(w!.id, at("18:00")), { shiftId: s!.id });
    const [ot] = await db.query<{ id: string }>("select id from ot_request where employee_id = $1", [w!.id]);
    expect(await kind(reviewEligibility(await as("EMP-005", at("19:00")), { requestId: ot!.id, verifiedReason: "authorized_future_task" }))).not.toBe("ok");
    const sup = (await db.query<{ manager_id: string }>("select manager_id from employee where id = $1", [w!.id]))[0]!.manager_id;
    const d = await reviewEligibility(await asId(sup, at("19:00")), { requestId: ot!.id, verifiedReason: "authorized_future_task", futureTaskAuthorization: "Supervisor asked at 14:00 to start tomorrow's shutters" });
    // No approved monthly policy exists in the demo, so an otherwise eligible decision waits for policy.
    expect(d.status).toBe("pending_policy");
    const [row] = await db.query<{ decision_code: string }>("select decision_code from ot_request where id = $1", [ot!.id]);
    expect(row!.decision_code).toBe("policy_not_approved");
    const catchUp = await reviewEligibility(await asId(sup, at("19:05")), { requestId: ot!.id, verifiedReason: "original_target_catch_up" });
    expect(catchUp.status).toBe("ineligible");
  });
});
