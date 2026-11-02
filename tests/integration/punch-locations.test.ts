/**
 * The punch location report (owner request, 2 Nov 2026): who punched where and when, on screen and as a download.
 * Location is sensitive, so access is narrower than project scope: crew see only themselves.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { punchReport } from "@/server/queries/punch-locations";
import { actor, freshDb } from "./helpers";
import { PEOPLE } from "./flow-helpers";

let db: Db;
const COWORKER = "EMP-021";
let visitA = "", projectA = "", visitB = "", projectB = "";
const FROM = "2026-09-01", TO = "2026-09-30";

const punch = async (bid: string, visitId: string, projectId: string, inAt: string, outAt: string | null, loc: object | null, voided = false) =>
  db.query(`insert into site_presence(employee_id, visit_id, project_id, check_in_at, check_out_at, check_in_location, check_out_location, voided)
            select id, $2, $3, $4, $5, $6, $7, $8 from employee where business_id = $1`,
    [bid, visitId, projectId, inAt, outAt, loc && JSON.stringify(loc), outAt && loc ? JSON.stringify(loc) : null, voided]);
const LOC = { latitude: 28.4356, longitude: 77.1057, accuracy: 12, capturedAt: "2026-09-10T03:30:00.000Z" };
const run = async (bid: string, f: Record<string, string> = {}) => punchReport(db, await actor(db, bid), { from: FROM, to: TO, ...f });

beforeAll(async () => {
  db = await freshDb({ operational: true });
  // Two sites, each with its own manager.
  const visits = await db.query<{ id: string; project_id: string }>("select distinct on (project_id) id, project_id from visit order by project_id, id limit 2");
  ({ id: visitA, project_id: projectA } = visits[0]!);
  ({ id: visitB, project_id: projectB } = visits[1]!);
  await db.query("update project set manager_id = (select id from employee where business_id = $1) where id = $2", [PEOPLE.installation_manager, projectA]);
  await db.query("update project set manager_id = (select id from employee where business_id = $1) where id = $2", [PEOPLE.otherIm, projectB]);
  await db.query("update project set latitude = 28.4356, longitude = 77.1057 where id = $1", [projectA]);
  await punch(PEOPLE.installer, visitA, projectA, "2026-09-10T03:30:00Z", "2026-09-10T12:00:00Z", LOC);
  await punch(COWORKER, visitA, projectA, "2026-09-11T03:30:00Z", null, null);
  await punch("EMP-022", visitB, projectB, "2026-09-12T03:30:00Z", "2026-09-12T05:00:00Z", LOC);
  await punch(PEOPLE.installer, visitA, projectA, "2026-09-13T03:30:00Z", "2026-09-13T05:00:00Z", LOC, true); // voided
  await punch(PEOPLE.installer, visitA, projectA, "2026-08-20T03:30:00Z", "2026-08-20T05:00:00Z", LOC); // outside the month
  await db.query("insert into flow_role_member(role_code, employee_id) select 'installation_head', id from employee where business_id = $1 on conflict do nothing", [PEOPLE.store]);
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("what the report shows", () => {
  it("gives time, place, accuracy, hours and distance from the site for a punch", async () => {
    const r = (await run(PEOPLE.admin, { employee: "" })).rows.find((x) => x.business_id === PEOPLE.installer)!;
    expect(r.date).toBe("2026-09-10");
    expect(r.in).toMatchObject({ latitude: 28.4356, longitude: 77.1057, accuracy: 12 });
    expect(r.in!.distanceM).toBe(0);
    expect(r.hours).toBe(8.5);
    expect(r.out?.latitude).toBe(28.4356);
  });
  it("says so when no location was recorded, and when the person has not punched out", async () => {
    const r = (await run(PEOPLE.admin)).rows.find((x) => x.business_id === COWORKER)!;
    expect(r.in).toBeNull();
    expect(r.check_out_at).toBeNull();
    expect(r.hours).toBeNull();
  });
  it("leaves out voided punches and punches outside the dates", async () => {
    const dates = (await run(PEOPLE.admin)).rows.filter((x) => x.business_id === PEOPLE.installer).map((x) => x.date);
    expect(dates).toEqual(["2026-09-10"]);
  });
  it("uses the site's local date for the date range", async () => {
    await punch("EMP-023", visitA, projectA, "2026-09-30T20:00:00Z", "2026-09-30T21:00:00Z", LOC); // 1 Oct 01:30 in India
    const { rows } = await run(PEOPLE.admin);
    expect(rows.some((x) => x.business_id === "EMP-023")).toBe(false);
    expect((await run(PEOPLE.admin, { from: "2026-10-01", to: "2026-10-01" })).rows.map((x) => x.business_id)).toEqual(["EMP-023"]);
  });
  it("filters to one person and one project, and lists the choices", async () => {
    const all = await run(PEOPLE.admin);
    const id = all.people.find((p) => p.business_id === PEOPLE.installer)!.id;
    expect((await run(PEOPLE.admin, { employee: id })).rows.map((x) => x.business_id)).toEqual([PEOPLE.installer]);
    expect((await run(PEOPLE.admin, { project: projectB })).rows.map((x) => x.business_id)).toEqual(["EMP-022"]);
    expect(all.projects.map((p) => p.id)).toEqual(expect.arrayContaining([projectA, projectB]));
  });
});

describe("who may see it", () => {
  const bids = async (bid: string) => (await run(bid)).rows.map((x) => x.business_id).sort();
  it("shows crew only their own punches, not their co-workers' on the same site", async () => {
    expect(await bids(PEOPLE.installer)).toEqual([PEOPLE.installer]);
    expect((await run(COWORKER)).people.map((p) => p.business_id)).toEqual([COWORKER]);
  });
  it("shows a manager their own projects only", async () => {
    const im = await bids(PEOPLE.installation_manager);
    expect(im).toEqual(expect.arrayContaining([PEOPLE.installer, COWORKER]));
    expect(im).not.toContain("EMP-022");
    expect(await bids(PEOPLE.otherIm)).toEqual(["EMP-022"]);
  });
  it("shows Admin and the Installation Head everyone", async () => {
    for (const b of [PEOPLE.admin, PEOPLE.store]) expect(await bids(b)).toEqual(expect.arrayContaining([PEOPLE.installer, COWORKER, "EMP-022"]));
  });
  it("cannot be widened by asking for someone else's person or project", async () => {
    const all = await run(PEOPLE.admin);
    const other = all.people.find((p) => p.business_id === "EMP-022")!.id;
    expect((await run(PEOPLE.installer, { employee: other })).rows).toEqual([]);
    expect((await run(PEOPLE.installation_manager, { project: projectB })).rows).toEqual([]);
  });
});
