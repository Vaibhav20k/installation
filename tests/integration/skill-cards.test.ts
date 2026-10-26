import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { makeCtx } from "@/server/services/context";
import { assignContext, assignOptions, cardDetail, listCards } from "@/server/queries/skill-cards";
import { addCardSkill, assignFromCard, updateCardSkill, verifyCardSkill } from "@/server/services/skill-cards";
import { authorizeAssetRead, completeEvidenceUpload, createEvidenceUpload, linkEvidence, receiveUpload } from "@/server/services/evidence";
import { releaseReservation } from "@/server/services/booking";
import { AppError } from "@/server/errors";
import { actor, freshDb, idOf } from "./helpers";

// Inside visit W (booked 21–23 Oct) and visit K (booked 14–28 Oct) of the operational seed.
const NOW = Date.parse("2026-10-22T06:00:00Z");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };
let db: Db, dir = "";
const as = async (bid: string, now = NOW) => makeCtx(db, await actor(db, bid), now);
const ADMIN = "EMP-004";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-cards-"));
  process.env.IM_EVIDENCE_DIR = dir;
  db = await freshDb({ operational: true });
}, 240_000);
afterAll(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.IM_EVIDENCE_DIR; });

describe("admin-only access", () => {
  it("managers, supervisors and workers are refused by every card query and action", async () => {
    const emp = await idOf(db, "employee", "EMP-020");
    for (const who of ["EMP-001", "EMP-008", "EMP-020"]) {
      const a = await actor(db, who);
      expect(await kind(listCards(db, a, {}, NOW))).toBe("forbidden");
      expect(await kind(cardDetail(db, a, emp, NOW))).toBe("forbidden");
      expect(await kind(assignOptions(db, a))).toBe("forbidden");
      expect(await kind(assignFromCard(await as(who), { employeeId: emp, visitId: emp, mode: "draft", reason: "Trying" }))).toBe("forbidden");
      expect(await kind(updateCardSkill(await as(who), { employeeSkillId: emp, version: 1, level: 3, reason: "Trying" }))).toBe("forbidden");
    }
  });
});

describe("cards read real records", () => {
  it("lists the workforce in pages with derived availability, current visit and next available date", async () => {
    const r = await listCards(db, await actor(db, ADMIN), {}, NOW);
    expect(r.total).toBe(40);
    expect(r.rows).toHaveLength(24);
    const [booked] = await db.query<{ employee_id: string; visit: string; hi: number }>(
      "select r.employee_id, v.business_id visit, upper(r.span) hi from reservation r join visit v on v.id = r.visit_id where r.state = 'confirmed' and r.span @> $1::timestamptz order by upper(r.span) limit 1", [new Date(NOW).toISOString()]);
    const assigned = await listCards(db, await actor(db, ADMIN), { availability: "assigned" }, NOW);
    const card = assigned.rows.find((c) => c.id === booked!.employee_id) ?? (await listCards(db, await actor(db, ADMIN), { availability: "assigned", page: 2 }, NOW)).rows.find((c) => c.id === booked!.employee_id);
    expect(card?.current?.visit).toBe(booked!.visit);
    expect(card!.next_available! >= new Date(Number(booked!.hi) - 1).toISOString().slice(0, 10)).toBe(true);
    expect(assigned.rows.every((c) => c.availability === "assigned")).toBe(true);
    // Titles never imply proficiency: senior technicians are listed with whatever their records say.
    const seniors = await listCards(db, await actor(db, ADMIN), { role: "senior_technician" }, NOW);
    expect(seniors.rows.every((c) => c.job_role === "senior_technician")).toBe(true);
  });

  it("availability follows bookings: releasing the booking makes the person available again", async () => {
    const [r] = await db.query<{ id: string; employee_id: string }>(
      "select r.id, r.employee_id from reservation r join visit v on v.id = r.visit_id where r.state = 'confirmed' and r.span @> $1::timestamptz and v.outstation = false order by r.employee_id limit 1", [new Date(NOW).toISOString()]);
    expect(r, "a booked local reservation covering now").toBeTruthy();
    const find = async () => (await listCards(db, await actor(db, ADMIN), { q: (await db.query<{ business_id: string }>("select business_id from employee where id = $1", [r!.employee_id]))[0]!.business_id }, NOW)).rows[0]!;
    expect((await find()).availability).toBe("assigned");
    await releaseReservation(await as("EMP-001"), { reservationId: r!.id, reason: "Card availability test" });
    const after = await find();
    expect(["available", "on_leave"]).toContain(after.availability);
    expect(after.current).toBeNull();
  });

  it("filters by skill, minimum level and verification; expired records show as expired", async () => {
    const a = await actor(db, ADMIN);
    const high = await listCards(db, a, { skill: "stone_fitting", minLevel: 3 }, NOW);
    expect(high.rows.every((c) => c.skills.some((s) => s.code === "stone_fitting" && s.level >= 3))).toBe(true);
    const [es] = await db.query<{ id: string; employee_id: string }>("select id, employee_id from employee_skill order by id limit 1");
    await db.query("update employee_skill set valid_from = '2025-01-01', valid_to = '2026-01-31' where id = $1", [es!.id]);
    const expired = await listCards(db, a, { verification: "expired" }, NOW);
    const card = expired.rows.find((c) => c.id === es!.employee_id);
    expect(card?.skills.find((s) => s.id === es!.id)?.expired).toBe(true);
  });
});

describe("skill editing keeps history and never silently verifies", () => {
  it("a level change clears verification, records why, and refuses stale edits", async () => {
    const [es] = await db.query<{ id: string; employee_id: string; level: number; version: number }>(
      "select es.id, es.employee_id, es.level, es.version from employee_skill es join employee e on e.id = es.employee_id where es.verified and e.business_id <> 'EMP-004' and es.level < 3 order by es.id limit 1");
    const r = await updateCardSkill(await as(ADMIN), { employeeSkillId: es!.id, version: es!.version, level: (es!.level + 1) as 2 | 3, notes: "Led two islands alone", reason: "Observed on VIS-005" });
    expect(r.verificationCleared).toBe(true);
    const [after] = await db.query<{ level: number; verified: boolean; verified_by: string | null; notes: string }>("select level, verified, verified_by, notes from employee_skill where id = $1", [es!.id]);
    expect(after).toEqual({ level: es!.level + 1, verified: false, verified_by: null, notes: "Led two islands alone" });
    const hist = await db.query<{ change: string; reason: string }>("select change, reason from employee_skill_change where employee_skill_id = $1 order by at, change", [es!.id]);
    expect(hist.map((h) => h.change).sort()).toEqual(["level", "notes", "unverified"]);
    expect(hist.every((h) => h.reason === "Observed on VIS-005")).toBe(true);
    expect(await kind(updateCardSkill(await as(ADMIN), { employeeSkillId: es!.id, version: es!.version, level: 1, reason: "Stale tab" }))).toBe("conflict");
    expect(await kind(db.query("update employee_skill_change set reason = 'x' where employee_skill_id = $1", [es!.id]))).not.toBe("ok");
    // Verification is a separate step with the existing capability rule.
    await verifyCardSkill(await as(ADMIN), { employeeSkillId: es!.id, verified: true, note: "Checked on site" });
    expect((await db.query<{ verified: boolean }>("select verified from employee_skill where id = $1", [es!.id]))[0]!.verified).toBe(true);
    const detail = await cardDetail(db, await actor(db, ADMIN), es!.employee_id, NOW);
    expect(detail.skills.find((s) => s.id === es!.id)!.history[0]!.change).toBe("verified");
  });

  it("an admin cannot verify their own skill; a new skill starts unverified; duplicates are refused", async () => {
    const me = await idOf(db, "employee", ADMIN);
    const [skill] = await db.query<{ id: string }>("select id from skill where id not in (select skill_id from employee_skill where employee_id = $1) limit 1", [me]);
    const added = await addCardSkill(await as(ADMIN), { employeeId: me, skillId: skill!.id, level: 2, reason: "Recording my own claim" });
    expect((await db.query<{ verified: boolean }>("select verified from employee_skill where id = $1", [added.id]))[0]!.verified).toBe(false);
    expect(await kind(verifyCardSkill(await as(ADMIN), { employeeSkillId: added.id, verified: true, note: "Self" }))).toBe("forbidden");
    expect(await kind(addCardSkill(await as(ADMIN), { employeeId: me, skillId: skill!.id, level: 3, reason: "Again" }))).toBe("conflict");
  });

  it("card evidence is admin-only for linking and for reading, even for the uploader's manager", async () => {
    const [c] = await db.query<{ id: string }>("select id from employee_skill_change order by at desc limit 1");
    const ctx = await as(ADMIN);
    const draft = crypto.randomUUID();
    const s = await createEvidenceUpload(ctx, { draftKey: draft, context: "skill.card", fileName: "cert.jpg", mime: "image/jpeg", size: JPEG.length, idempotencyKey: `k-${draft}` });
    await receiveUpload(db, ctx.actor.id, s.sessionId, new ReadableStream({ start(cn) { cn.enqueue(new Uint8Array(JPEG)); cn.close(); } }), NOW);
    await completeEvidenceUpload(ctx, { sessionId: s.sessionId });
    expect(await linkEvidence(ctx, { draftKey: draft, parentType: "employee_skill_change", parentId: c!.id })).toEqual({ linked: 1, pending: 0 });
    expect(await kind(authorizeAssetRead(db, await actor(db, ADMIN), s.assetId))).toBe("ok");
    expect(await kind(authorizeAssetRead(db, await actor(db, "EMP-001"), s.assetId))).toBe("forbidden");
    expect(await kind(linkEvidence(await as("EMP-001"), { draftKey: draft, parentType: "employee_portrait", parentId: await idOf(db, "employee", "EMP-020") }))).toBe("forbidden");
  });
});

describe("assign from a card", () => {
  const free = async (from: string, to: string, n = 2) => (await db.query<{ id: string }>(`select e.id from employee e where e.active and e.permission_role = 'employee'
    and not exists (select 1 from reservation r where r.employee_id = e.id and r.state in ('proposed','held','confirmed') and r.span && tstzrange($1::timestamptz,$2::timestamptz))
    and not exists (select 1 from leave_record l where l.employee_id = e.id and l.span && tstzrange($1::timestamptz,$2::timestamptz)) order by e.business_id limit $3`, [from, to, n])).map((r) => r.id);

  it("a draft with one person is saved but never reported as a complete team; confirming needs an approved plan", async () => {
    const [v] = await db.query<{ id: string }>("select id from visit where planned_start = '2026-11-09' and exec_status = 'unscheduled' limit 1");
    const [one] = await free("2026-11-08", "2026-11-13", 1);
    const ctx = await assignContext(db, await actor(db, ADMIN), one!, v!.id, NOW);
    expect(ctx.booked).toBe(false);
    const attendanceBefore = await db.query<{ n: number }>("select count(*)::int n from attendance_event");
    const r = await assignFromCard(await as(ADMIN), { employeeId: one!, visitId: v!.id, mode: "draft", reason: "Card draft" });
    expect(r).toMatchObject({ status: "draft", complete: false });
    expect((r as { openItems: string[] }).openItems.some((x) => x.includes("configured team size"))).toBe(true);
    const [res] = await db.query<{ state: string }>("select state from reservation where visit_id = $1 and employee_id = $2", [v!.id, one!]);
    expect(res!.state).toBe("proposed");
    // Confirming an incomplete team is refused by the same staffing checks.
    expect(await kind(assignFromCard(await as(ADMIN), { employeeId: one!, visitId: v!.id, mode: "confirm", reason: "Card confirm" }))).toBe("validation");
    expect((await db.query<{ n: number }>("select count(*)::int n from attendance_event"))[0]!.n).toBe(attendanceBefore[0]!.n);
    const audit = await db.query("select 1 from audit_event where action = 'card_assign' and object_id = $1", [v!.id]);
    expect(audit.length).toBeGreaterThan(0);
  });

  it("an inactive person cannot be assigned; out-of-order dates are refused", async () => {
    const [v] = await db.query<{ id: string }>("select id from visit where planned_start = '2026-11-09' limit 1");
    const [p] = await free("2026-11-08", "2026-11-13", 1);
    await db.query("update employee set active = false where id = $1", [p!]);
    expect(await kind(assignFromCard(await as(ADMIN), { employeeId: p!, visitId: v!.id, mode: "draft", reason: "Inactive" }))).toBe("validation");
    await db.query("update employee set active = true where id = $1", [p!]);
    expect(await kind(assignFromCard(await as(ADMIN), { employeeId: p!, visitId: v!.id, mode: "draft", reason: "Dates", dates: { plannedStart: "2026-11-09", plannedEnd: "2026-11-11", departureAt: "2026-11-10T03:00:00Z", returnAt: "2026-11-12T10:00:00Z" } }))).toBe("validation");
  });

  it("two simultaneous assignments of the same person to overlapping booked visits: exactly one succeeds", async () => {
    const booked = await db.query<{ id: string }>("select v.id from visit v where exists (select 1 from reservation r where r.visit_id = v.id and r.state = 'confirmed' and r.span @> '2026-10-23T06:00:00Z'::timestamptz) and v.exec_status in ('scheduled','in_progress') limit 2");
    expect(booked.length).toBe(2);
    const [p] = await free("2026-10-23", "2026-10-31", 1);
    const run = (visitId: string) => kind(as(ADMIN).then((c) => assignFromCard(c, { employeeId: p!, visitId, mode: "confirm", reason: "Race", from: { date: "2026-10-23", time: "09:00" } })));
    const results = await Promise.all(booked.map((b) => run(b.id)));
    expect(results.filter((x) => x === "ok")).toHaveLength(1);
    expect(results.filter((x) => x === "conflict")).toHaveLength(1);
    const rows = await db.query("select 1 from reservation where employee_id = $1 and state in ('held','confirmed')", [p!]);
    expect(rows).toHaveLength(1);
  });
});
