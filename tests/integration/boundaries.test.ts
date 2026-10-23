import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { makeCtx } from "@/server/services/context";
import { applyImport, previewImport } from "@/server/services/imports";
import { addTravelLeg } from "@/server/services/travel";
import { createPlan, createVisit, setSkillRequirements, updateVisitDates } from "@/server/services/planning";
import { holdCapacity, setVisitStaffing, suggestTeamsForVisit } from "@/server/services/booking";
import { proposeScheduleRevision } from "@/server/services/execution";
import { amendTimeEntry, createTimeEntry, reviewTimeEntry, submitTimeEntries } from "@/server/services/time";
import { gatherMonth } from "@/server/services/reconciliation";
import { AppError } from "@/server/errors";
import { actor, freshDb, idOf } from "./helpers";

const NOW = Date.parse("2026-10-21T06:00:00Z");
let db: Db;
const as = async (bid: string, now = NOW) => makeCtx(db, await actor(db, bid), now);
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };

beforeAll(async () => { db = await freshDb({ operational: true }); }, 240_000);
afterAll(async () => { await db?.close(); });

describe("source import boundary", () => {
  it("previews typed mappings, rejects unit mismatches and applies idempotently without rewriting approved revisions", async () => {
    const admin = await as("EMP-004");
    const pv = await previewImport(admin, { system: "demo_fixture" });
    expect(pv.live).toBe(false);
    const byId = Object.fromEntries(pv.rows.map((r) => [r.externalId, r]));
    expect(byId["FX-SO-1001"]!.status).toBe("update");
    expect(byId["FX-SO-1001"]!.changes.join(" ")).toContain("quantity 12 → 14");
    expect(byId["FX-SO-1001"]!.plansToReview).toEqual(["PLN-001"]);
    expect(byId["FX-SO-2001"]!.status).toBe("new");
    expect(byId["FX-SO-2002"]!.status).toBe("rejected");
    expect(byId["FX-SO-2002"]!.reasons[0]).toContain("must be measured in sqft");

    const [baseline] = await db.query<{ snapshot: unknown }>("select r.snapshot from plan p join plan_revision r on r.id = p.baseline_revision_id where p.business_id = 'PLN-001'");
    const res = await applyImport(admin, { system: "demo_fixture", externalIds: ["FX-SO-1001", "FX-SO-2001", "FX-SO-2002"] });
    expect(res.applied).toHaveLength(2);
    expect(res.skipped[0]).toContain("FX-SO-2002: rejected");
    const [after] = await db.query<{ snapshot: unknown }>("select r.snapshot from plan p join plan_revision r on r.id = p.baseline_revision_id where p.business_id = 'PLN-001'");
    expect(after!.snapshot).toEqual(baseline!.snapshot);
    const [shutters] = await db.query<{ quantity: string; drawing_version: string }>("select c.quantity::int::text quantity, c.drawing_version from component c join order_item oi on oi.id = c.order_item_id join sales_order o on o.id = oi.order_id where o.business_id = 'ORD-001' and c.name = 'Shutters'");
    expect(shutters).toEqual({ quantity: "14", drawing_version: "DRG-B" });
    const [flag] = await db.query<{ n: number }>("select count(*)::int n from issue where category = 'Source change'");
    expect(flag!.n).toBe(1);
    const again = await applyImport(admin, { system: "demo_fixture", externalIds: ["FX-SO-1001", "FX-SO-2001"] });
    expect(again.applied).toEqual([]);
    expect(again.skipped.every((s) => s.includes("unchanged"))).toBe(true);
    const [orders] = await db.query<{ n: number }>("select count(*)::int n from sales_order where external_ref = 'FX-SO-2001'");
    expect(orders!.n).toBe(1);
  });

  it("limits a manager's preview to their own projects", async () => {
    const pv = await previewImport(await as("EMP-001"), { system: "demo_fixture" });
    expect(pv.rows.find((r) => r.externalId === "FX-SO-2001")!.reasons.join(" ")).toMatch(/outside your scope|already applied/);
    expect(await kind(previewImport(await as("EMP-005"), { system: "demo_fixture" }))).toBe("forbidden");
  });
});

describe("travel, delays and truthful time capture", () => {
  it("scenario 27: travel legs define outstation occupancy; booked legs must stay inside reservations", async () => {
    const sup = await as("EMP-008");
    const plan = await createPlan(sup, { projectId: await idOf(db, "project", "PRJ-002") });
    const v = await createVisit(sup, { planId: plan.id, visitType: "fresh", plannedStart: "2026-12-02", plannedEnd: "2026-12-03", orderIds: [await idOf(db, "sales_order", "ORD-003")] });
    const skill = (await db.query<{ id: string }>("select id from skill where code = 'assembly'"))[0]!.id;
    await setSkillRequirements(sup, { visitId: v.id, requirements: [{ skillId: skill, minLevel: 1, headcount: 3, mode: "collective" }] });
    const opts = await suggestTeamsForVisit(sup, { visitId: v.id });
    await setVisitStaffing(sup, { visitId: v.id, employeeIds: opts.earliest!.memberIds });
    // Reachability: arriving after the start date, or leaving before the last work day, is refused (checklist phase 6).
    expect(await kind(addTravelLeg(sup, { visitId: v.id, kind: "outbound", origin: "Delhi", destination: "Jaipur", plannedDepart: "2026-12-02T20:00:00Z", plannedArrive: "2026-12-03T02:00:00Z" }))).toBe("validation");
    expect(await kind(addTravelLeg(sup, { visitId: v.id, kind: "return", origin: "Jaipur", destination: "Delhi", plannedDepart: "2026-12-02T10:00:00Z", plannedArrive: "2026-12-02T16:00:00Z" }))).toBe("validation");
    await addTravelLeg(sup, { visitId: v.id, kind: "outbound", origin: "Delhi", destination: "Jaipur", plannedDepart: "2026-12-01T03:30:00Z", plannedArrive: "2026-12-01T09:30:00Z" });
    await addTravelLeg(sup, { visitId: v.id, kind: "return", origin: "Jaipur", destination: "Delhi", plannedDepart: "2026-12-04T03:30:00Z", plannedArrive: "2026-12-04T09:30:00Z" });
    const [row] = await db.query<{ departure_at: number; return_at: number; outstation: boolean }>("select departure_at, return_at, outstation from visit where id = $1", [v.id]);
    expect(row).toEqual({ departure_at: Date.parse("2026-12-01T03:30:00Z"), return_at: Date.parse("2026-12-04T09:30:00Z"), outstation: true });
    const [res] = await db.query<{ lo: number; hi: number }>("select min(lower(span)) lo, max(upper(span)) hi from reservation where visit_id = $1 and state = 'proposed'", [v.id]);
    expect([res!.lo, res!.hi]).toEqual([row!.departure_at, row!.return_at]);
    // Once held, a local assignment on the return-travel day is not offered to these people.
    await holdCapacity(await as("EMP-001"), { visitId: v.id });
    const other = await createVisit(sup, { planId: plan.id, visitType: "fresh", plannedStart: "2026-12-04", plannedEnd: "2026-12-04", orderIds: [await idOf(db, "sales_order", "ORD-003")] });
    await setSkillRequirements(sup, { visitId: other.id, requirements: [{ skillId: skill, minLevel: 1, headcount: 3, mode: "collective" }] });
    const local = await suggestTeamsForVisit(sup, { visitId: other.id, horizonDays: 1 });
    const team = opts.earliest!.memberIds;
    expect(local.unavailableOnFirstDate.filter((u) => team.includes(u.id)).every((u) => u.reasons.some((r) => r.includes("reserved")))).toBe(true);
    const sameDay = local.options.filter((o): o is NonNullable<typeof o> => !!o && o.start === "2026-12-04");
    expect(sameDay.length).toBeGreaterThan(0);
    expect(sameDay.every((o) => !o.memberIds.some((id) => team.includes(id)))).toBe(true);
    // A booked leg outside the held occupancy is refused.
    expect(await kind(addTravelLeg(sup, { visitId: v.id, kind: "return", origin: "Jaipur", destination: "Delhi", plannedDepart: "2026-12-05T03:30:00Z", plannedArrive: "2026-12-05T09:30:00Z" }))).toBe("conflict");
  });

  it("visit dates must keep departure, installation and return in order (checklist phase 6)", async () => {
    const sup = await as("EMP-008");
    const plan = await createPlan(sup, { projectId: await idOf(db, "project", "PRJ-002") });
    const v = await createVisit(sup, { planId: plan.id, visitType: "fresh", plannedStart: "2026-12-10", plannedEnd: "2026-12-12", orderIds: [await idOf(db, "sales_order", "ORD-003")] });
    expect(await kind(updateVisitDates(sup, { visitId: v.id, plannedStart: "2026-12-10", plannedEnd: "2026-12-12", departureAt: "2026-12-11T03:30:00Z", returnAt: "2026-12-13T09:00:00Z" }))).toBe("validation");
    expect(await kind(updateVisitDates(sup, { visitId: v.id, plannedStart: "2026-12-10", plannedEnd: "2026-12-12", departureAt: "2026-12-09T03:30:00Z", returnAt: "2026-12-11T09:00:00Z" }))).toBe("validation");
    expect(await kind(updateVisitDates(sup, { visitId: v.id, plannedStart: "2026-12-10", plannedEnd: "2026-12-12", departureAt: "2026-12-09T03:30:00Z", returnAt: "2026-12-13T09:00:00Z" }))).toBe("ok");
  });

  it("scenario 28: a delay revision proposal shows conflicts and cost impact without moving anything", async () => {
    const [vis] = await db.query<{ id: string; planned_start: string; planned_end: string }>("select id, planned_start::text, planned_end::text from visit where business_id = 'VIS-002'");
    const p = await proposeScheduleRevision(await as("EMP-005"), { visitId: vis!.id, plannedStart: "2026-10-28", plannedEnd: "2026-10-29" });
    expect(p.personDayChange).toBe(0); // proposed staff are not counted as booked person-days
    const [after] = await db.query<{ planned_start: string }>("select planned_start::text from visit where id = $1", [vis!.id]);
    expect(after!.planned_start).toBe(vis!.planned_start);
  });

  it("scenario 30: unbooked work is captured as an exception and blocks finalization; returned entries keep history", async () => {
    const emp = (await db.query<{ id: string }>("select id from employee where business_id = 'EMP-030'"))[0]!.id;
    const me = makeCtx(db, (await loadActor(db, emp))!, NOW);
    const [vis] = await db.query<{ id: string }>("select id from visit where business_id = 'VIS-001'");
    const prj = await idOf(db, "project", "PRJ-001");
    const base = { employeeId: emp, projectId: prj, visitId: vis!.id, activity: "installation" as const, start: { date: "2026-10-13", time: "10:00" }, end: { date: "2026-10-13", time: "12:00" } };
    expect(await kind(createTimeEntry(me, base))).toBe("validation");
    const e = await createTimeEntry(me, { ...base, note: "Called in to help unload; no booking was made" });
    expect(e.isException).toBe(true);
    await submitTimeEntries(me, { entryIds: [e.id] });
    const sup = await as("EMP-004");
    await reviewTimeEntry(sup, { entryId: e.id, decision: "returned", note: "Add the unloading detail" });
    const g = await gatherMonth(db, emp, "2026-10", Date.parse("2026-11-05T00:00:00Z"));
    expect(g.result.blockers.join(" ")).toContain("unresolved planning exception");
    const fixed = await amendTimeEntry(me, { ...base, entryId: e.id, note: "Unloaded 24 carcasses with the crew; no booking was made", reason: "Added unloading detail" });
    const history = await db.query<{ state: string; is_current: boolean; revision_no: number }>("select state, is_current, revision_no from time_entry where id in ($1, $2) order by revision_no", [e.id, fixed.id]);
    expect(history).toEqual([{ state: "returned", is_current: false, revision_no: 1 }, { state: "draft", is_current: true, revision_no: 2 }]);
  });
});
