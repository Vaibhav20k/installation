/**
 * Installer reports of missing or damaged items found on site after receipt (request of 28 Oct 2026). A person
 * booked on the site today reports a line with type, quantity, reason and a photo; the site's Installation
 * Manager confirms it into a complaint (or rejects it with a reason) and the reporter is told either way.
 * Written before the feature (TDD): every test here failed first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { makeCtx } from "@/server/services/context";
import { createDispatch } from "@/server/services/dispatch";
import { confirmMndReport, myMndReports, reportMnd, reportableLines, reportsToDecide, rejectMndReport, siteReports } from "@/server/services/site-mnd";
import { actor, freshDb } from "./helpers";
import { PEOPLE, errKind, errText, flowKit } from "./flow-helpers";

// A moment when the operational demo has crews booked on site.
const AT = Date.parse("2026-10-22T06:00:00Z");
let db: Db;
const k = flowKit(() => db);
let crewBid = "", crewId = "", imBid = "", outsiderBid = "", dispatchId = "", line = "", otherLine = "";
const as = async (bid: string) => makeCtx(db, await actor(db, bid), AT);

beforeAll(async () => {
  db = await freshDb({ operational: true });
  // An installer confirmed on a site right now, on a project an Installation Manager runs.
  const [r] = await db.query<{ bid: string; id: string; project_id: string; im: string }>(
    `select e.business_id bid, e.id, v.project_id, m.business_id im from reservation r join employee e on e.id = r.employee_id join visit v on v.id = r.visit_id
     join project p on p.id = v.project_id join employee m on m.id = p.manager_id
     where r.state = 'confirmed' and r.span @> $1::timestamptz and e.permission_role = 'employee' and m.business_id in ('EMP-001','EMP-002') order by e.business_id limit 1`, [new Date(AT).toISOString()]);
  crewBid = r!.bid; crewId = r!.id; imBid = r!.im;
  const [o] = await db.query<{ bid: string }>(
    `select e.business_id bid from employee e where e.permission_role = 'employee' and e.job_role <> 'department_staff' and e.active
     and not exists (select 1 from reservation r join visit v on v.id = r.visit_id where r.employee_id = e.id and v.project_id = $1) order by e.business_id limit 1`, [r!.project_id]);
  outsiderBid = o!.bid;
  // A dispatch to that project, received in full.
  const [ord] = await db.query<{ id: string }>("select id from sales_order where project_id = $1 order by business_id limit 1", [r!.project_id]);
  const comps = await db.query<{ id: string; dispatch_group: string }>(
    `select c.id, c.dispatch_group from component c join order_item oi on oi.id = c.order_item_id where oi.order_id = $1 and c.dispatch_group in ('carcass','shutters') order by c.business_id`, [ord!.id]);
  const f = makeCtx(db, await actor(db, PEOPLE.factory_dispatch), AT);
  dispatchId = (await createDispatch(f, { orderId: ord!.id, types: ["D1", "D2"], factory: "Main factory", items: comps.map((c) => ({ componentId: c.id, quantity: "2" })) })).dispatchId;
  // The project's own IM receives it (EMP-001 or EMP-002).
  await db.query("update dispatch set stage = 'received', version = version + 1 where id = $1", [dispatchId]);
  const items = await db.query<{ id: string }>("select id from dispatch_item where dispatch_id = $1 order by id", [dispatchId]);
  line = items[0]!.id; otherLine = items[1]!.id;
  const s = await k.state(dispatchId);
  const { receiveDispatch } = await import("@/server/services/dispatch");
  await receiveDispatch(await as(imBid), { dispatchId, version: s.version, stage: "received", lines: items.map((i) => ({ itemId: i.id, ok: true })) });
}, 240_000);
afterAll(async () => { await db?.close(); });

const photo = () => k.upload(crewBid);

describe("what an installer can report on", () => {
  it("lists the received lines of dispatches to the site they are booked on today", async () => {
    const r = await reportableLines(db, await actor(db, crewBid), AT);
    const d = r.flatMap((s) => s.dispatches).find((x) => x.dispatch_id === dispatchId)!;
    expect(d.lines.map((l) => l.item_id).sort()).toEqual([line, otherLine].sort());
    expect(d.lines.every((l) => !l.open_complaint && !l.pending_report)).toBe(true);
  });
  it("lists nothing for someone not booked on that site", async () => {
    const r = await reportableLines(db, await actor(db, outsiderBid), AT);
    expect(r.flatMap((s) => s.dispatches).some((x) => x.dispatch_id === dispatchId)).toBe(false);
  });
});

let reportId = "";
describe("sending a report", () => {
  it("needs a type, a quantity within what was dispatched, a reason and a photo", async () => {
    const c = await as(crewBid);
    expect(await errText(reportMnd(c, { itemId: line, kind: "damaged", quantity: "1", reason: "Corner broken" }))).toMatch(/photo/);
    expect(await errText(reportMnd(c, { itemId: line, kind: "damaged", quantity: "0", reason: "Corner broken", photoDraftKey: await photo() }))).toMatch(/quantity/i);
    expect(await errText(reportMnd(c, { itemId: line, kind: "damaged", quantity: "3", reason: "Corner broken", photoDraftKey: await photo() }))).toMatch(/at most 2/);
    expect(await errKind(reportMnd(c, { itemId: line, kind: "damaged", quantity: "1", reason: "", photoDraftKey: await photo() }))).toBe("validation");
    expect(await errKind(reportMnd(c, { itemId: line, kind: "lost" as never, quantity: "1", reason: "Corner broken", photoDraftKey: await photo() }))).toBe("validation");
  });
  it("is refused for someone not booked on the site", async () => {
    expect(await errKind(reportMnd(await as(outsiderBid), { itemId: line, kind: "damaged", quantity: "1", reason: "Corner broken", photoDraftKey: await k.upload(outsiderBid) }))).toBe("forbidden");
  });
  it("saves a pending report and tells the site's Installation Manager", async () => {
    reportId = (await reportMnd(await as(crewBid), { itemId: line, kind: "damaged", quantity: "1", reason: "Corner broken while unpacking", photoDraftKey: await photo() })).reportId;
    const [n] = await db.query<{ who: string; href: string }>("select e.business_id who, n.href from notification n join employee e on e.id = n.employee_id where n.kind = 'mnd_report' order by n.created_at desc limit 1");
    expect(n).toEqual({ who: imBid, href: `/dispatch/${dispatchId}#site-reports` });
    expect((await myMndReports(db, await actor(db, crewBid)))[0]).toMatchObject({ id: reportId, status: "pending" });
  });
  it("refuses a second report on a line that already has one waiting", async () => {
    expect(await errText(reportMnd(await as(crewBid), { itemId: line, kind: "missing", quantity: "1", reason: "Another one", photoDraftKey: await photo() }))).toMatch(/already reported/i);
  });
});

describe("the Installation Manager decides", () => {
  it("only the site's Installation Manager can confirm or reject", async () => {
    const other = imBid === "EMP-001" ? "EMP-002" : "EMP-001";
    for (const bid of [crewBid, other, PEOPLE.qc, PEOPLE.admin]) expect(`${bid}:${await errKind(confirmMndReport(await as(bid), { reportId }))}`).toBe(`${bid}:forbidden`);
  });
  it("sees the waiting report in My steps (only the site's IM) and on the dispatch", async () => {
    expect((await reportsToDecide(db, await actor(db, imBid))).map((r) => r.id)).toEqual([reportId]);
    expect(await reportsToDecide(db, await actor(db, imBid === "EMP-001" ? "EMP-002" : "EMP-001"))).toEqual([]);
    const r = await siteReports(db, await actor(db, imBid), dispatchId);
    expect(r.map((x) => x.id)).toEqual([reportId]);
    expect(r[0]!.photos).toBe(1);
  });
  it("confirming opens a complaint with the photo, flags the dispatch partial and tells the reporter", async () => {
    const { complaintId } = await confirmMndReport(await as(imBid), { reportId });
    const [c] = await db.query<{ stage: string; kind: string; quantity: string; dispatch_item_id: string }>("select stage, kind, quantity::float::text quantity, dispatch_item_id from complaint where id = $1", [complaintId]);
    expect(c).toEqual({ stage: "qc_review", kind: "damaged", quantity: "1", dispatch_item_id: line });
    const [ph] = await db.query<{ n: number }>("select count(*)::int n from evidence_link l join stage_history h on h.id = l.parent_id where h.subject_id = $1 and l.status = 'active'", [complaintId]);
    expect(ph!.n).toBe(1);
    expect((await k.state(dispatchId)).partial).toBe(true);
    const [n] = await db.query<{ title: string }>("select title from notification where employee_id = $1 and kind = 'mnd_report_decided' order by created_at desc limit 1", [crewId]);
    expect(n!.title).toMatch(/confirmed/i);
    expect(await errKind(confirmMndReport(await as(imBid), { reportId }))).toBe("conflict");
  });
  it("a line with an open complaint cannot be reported again", async () => {
    const r = await reportableLines(db, await actor(db, crewBid), AT);
    expect(r.flatMap((s) => s.dispatches).flatMap((d) => d.lines).find((l) => l.item_id === line)!.open_complaint).toMatch(/^MND-/);
    expect(await errText(reportMnd(await as(crewBid), { itemId: line, kind: "damaged", quantity: "1", reason: "Again", photoDraftKey: await photo() }))).toMatch(/already has complaint MND-/);
  });
  it("rejecting needs a reason and tells the reporter why", async () => {
    const id = (await reportMnd(await as(crewBid), { itemId: otherLine, kind: "missing", quantity: "2", reason: "Box empty", photoDraftKey: await photo() })).reportId;
    expect(await errKind(rejectMndReport(await as(imBid), { reportId: id, reason: "" }))).toBe("validation");
    await rejectMndReport(await as(imBid), { reportId: id, reason: "Found them in the other box" });
    expect((await myMndReports(db, await actor(db, crewBid))).find((x) => x.id === id)).toMatchObject({ status: "rejected", decision_reason: "Found them in the other box" });
    const [n] = await db.query<{ body: string }>("select body from notification where employee_id = $1 and kind = 'mnd_report_decided' order by created_at desc limit 1", [crewId]);
    expect(n!.body).toContain("Found them in the other box");
    // Rejected reports free the line: it can be reported again.
    expect(await errKind(reportMnd(await as(crewBid), { itemId: otherLine, kind: "missing", quantity: "1", reason: "Still short by one", photoDraftKey: await photo() }))).toBe("ok");
  });
});
