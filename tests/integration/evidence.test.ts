import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { makeCtx } from "@/server/services/context";
import { createTimeEntry } from "@/server/services/time";
import { requestLeave } from "@/server/services/attendance";
import { setQuantitySnapshot } from "@/server/services/site";
import { authorizeAssetRead, completeEvidenceUpload, createEvidenceUpload, evidenceFor, linkEvidence, receiveUpload, removeDraftEvidence } from "@/server/services/evidence";
import { AppError } from "@/server/errors";
import { freshDb } from "./helpers";

const NOW = Date.parse("2026-10-20T06:00:00Z");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(4096, 3)]);
const TEXT = Buffer.from("this is not a picture, just text pretending to be one");
const stream = (b: Buffer) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(b)); c.close(); } });
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof AppError ? e.kind : String(e); } };

let db: Db, dir = "";
let worker = "", other = "", supervisor = "", unrelatedManager = "";
const as = async (id: string) => makeCtx(db, (await loadActor(db, id))!, NOW);

async function upload(actorId: string, draftKey: string, name: string, mime: string, bytes: Buffer, context = "time.entry") {
  const ctx = await as(actorId);
  const s = await createEvidenceUpload(ctx, { draftKey, context, fileName: name, mime, size: bytes.length, idempotencyKey: `k-${draftKey}-${name}` });
  await receiveUpload(db, actorId, s.sessionId, stream(bytes), NOW);
  return { ...s, complete: () => completeEvidenceUpload(ctx, { sessionId: s.sessionId }) };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-evidence-"));
  process.env.IM_EVIDENCE_DIR = dir;
  db = await freshDb();
  const crew = await db.query<{ id: string; manager_id: string }>("select id, manager_id from employee where permission_role = 'employee' and active order by business_id limit 2");
  worker = crew[0]!.id; other = crew[1]!.id; supervisor = crew[0]!.manager_id;
  // A manager outside the worker's chain (manages projects, not this person).
  const [m] = await db.query<{ id: string }>(`select id from employee where permission_role = 'manager' and id <> (select manager_id from employee where id = $1) order by business_id limit 1`, [supervisor]);
  unrelatedManager = m!.id;
});
afterAll(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.IM_EVIDENCE_DIR; delete process.env.IM_EVIDENCE_STORAGE; });

describe("evidence pipeline", () => {
  let entryId = "";
  it("uploads a photo and a video, validates content and links both to the saved record (scenario 70)", async () => {
    const e = await createTimeEntry(await as(worker), { employeeId: worker, overheadCategory: "training", activity: "other", start: { date: "2026-10-19", time: "10:00" }, end: { date: "2026-10-19", time: "12:00" } });
    entryId = e.id;
    const draft = crypto.randomUUID();
    const p = await upload(worker, draft, "cabinet.jpg", "image/jpeg", JPEG);
    const v = await upload(worker, draft, "walkthrough.mp4", "video/mp4", MP4);
    expect((await p.complete()).state).toBe("ready");
    expect((await v.complete()).state).toBe("ready");
    const r = await linkEvidence(await as(worker), { draftKey: draft, parentType: "time_entry", parentId: entryId, captions: { [p.assetId]: "Left wall" } });
    expect(r).toEqual({ linked: 2, pending: 0 });
    const again = await linkEvidence(await as(worker), { draftKey: draft, parentType: "time_entry", parentId: entryId });
    expect(again.linked).toBe(0);
    const items = await evidenceFor(db, (await loadActor(db, worker))!, "time_entry", entryId);
    expect(items.map((i) => [i.mediaType, i.caption])).toEqual([["image", "Left wall"], ["video", null]]);
    expect(await kind(evidenceFor(db, (await loadActor(db, supervisor))!, "time_entry", entryId))).toBe("ok");
    expect(await kind(evidenceFor(db, (await loadActor(db, other))!, "time_entry", entryId))).toBe("forbidden");
  });

  it("rejects disguised and oversize files without touching the record (scenario 73)", async () => {
    const draft = crypto.randomUUID();
    const fake = await upload(worker, draft, "photo.jpg", "image/jpeg", TEXT);
    expect(await kind(fake.complete())).toBe("validation");
    const swapped = await upload(worker, draft, "clip.jpg", "image/jpeg", MP4);
    expect(await kind(swapped.complete())).toBe("validation");
    expect(await kind(createEvidenceUpload(await as(worker), { draftKey: draft, context: "time.entry", fileName: "huge.mp4", mime: "video/mp4", size: 500 * 1024 * 1024, idempotencyKey: "k-huge-0001" }))).toBe("validation");
    expect(await kind(createEvidenceUpload(await as(worker), { draftKey: draft, context: "time.entry", fileName: "doc.pdf", mime: "application/pdf", size: 1000, idempotencyKey: "k-pdf-0001" }))).toBe("validation");
  });

  it("cannot link files to another worker's record or download another worker's draft (scenario 73)", async () => {
    const draft = crypto.randomUUID();
    const p = await upload(other, draft, "x.jpg", "image/jpeg", JPEG);
    await p.complete();
    expect(await kind(linkEvidence(await as(other), { draftKey: draft, parentType: "time_entry", parentId: entryId }))).toBe("forbidden");
    expect(await kind(authorizeAssetRead(db, (await loadActor(db, worker))!, p.assetId))).toBe("forbidden");
    expect(await kind(authorizeAssetRead(db, (await loadActor(db, other))!, p.assetId))).toBe("ok");
  });

  it("leave attachments stay with the requester and their manager chain (scenario 73)", async () => {
    const l = await requestLeave(await as(worker), { kind: "emergency_unavailability", startDate: "2026-10-21", endDate: "2026-10-21", reason: "Medical" });
    const draft = crypto.randomUUID();
    const p = await upload(worker, draft, "note.jpg", "image/jpeg", JPEG, "leave.request");
    await p.complete();
    await linkEvidence(await as(worker), { draftKey: draft, parentType: "leave_request", parentId: l.id });
    expect(await kind(evidenceFor(db, (await loadActor(db, supervisor))!, "leave_request", l.id))).toBe("ok");
    expect(await kind(evidenceFor(db, (await loadActor(db, unrelatedManager))!, "leave_request", l.id))).toBe("forbidden");
    expect(await kind(authorizeAssetRead(db, (await loadActor(db, unrelatedManager))!, p.assetId))).toBe("forbidden");
  });

  it("a draft attachment can be removed; a linked one cannot be silently erased (scenario 74)", async () => {
    const draft = crypto.randomUUID();
    const p = await upload(worker, draft, "spare.jpg", "image/jpeg", JPEG);
    await p.complete();
    expect((await removeDraftEvidence(await as(worker), { assetId: p.assetId })).removed).toBe(true);
    const [linked] = await db.query<{ asset_id: string }>("select asset_id from evidence_link where parent_id = $1 limit 1", [entryId]);
    expect(await kind(removeDraftEvidence(await as(worker), { assetId: linked!.asset_id }))).toBe("conflict");
  });

  it("storage switched off reports unavailable; the record itself still saves (scenario 77)", async () => {
    process.env.IM_EVIDENCE_STORAGE = "off";
    expect(await kind(createEvidenceUpload(await as(worker), { draftKey: crypto.randomUUID(), context: "time.entry", fileName: "a.jpg", mime: "image/jpeg", size: 100, idempotencyKey: "k-off-0001" }))).toBe("conflict");
    const e = await createTimeEntry(await as(worker), { employeeId: worker, overheadCategory: "training", activity: "other", start: { date: "2026-10-19", time: "13:00" }, end: { date: "2026-10-19", time: "14:00" } });
    expect(e.id).toBeTruthy();
    delete process.env.IM_EVIDENCE_STORAGE;
  });

  it("measurements take photos on their own record; people outside the project cannot attach (checklist phase 7 coverage)", async () => {
    const [admin] = await db.query<{ id: string }>("select id from employee where permission_role = 'admin' order by business_id limit 1");
    const [c] = await db.query<{ id: string; unit: string; quantity_kind: string }>("select id, unit, quantity_kind from component order by business_id limit 1");
    const snap = await setQuantitySnapshot(await as(admin!.id), { componentId: c!.id, basis: "net", quantity: "42", unit: c!.unit, quantityKind: c!.quantity_kind, source: "Site measure" });
    const draft = crypto.randomUUID();
    const p = await upload(admin!.id, draft, "tape.jpg", "image/jpeg", JPEG, "site.measurement");
    await p.complete();
    expect(await linkEvidence(await as(admin!.id), { draftKey: draft, parentType: "quantity_snapshot", parentId: snap.id })).toEqual({ linked: 1, pending: 0 });
    expect((await evidenceFor(db, (await loadActor(db, admin!.id))!, "quantity_snapshot", snap.id)).length).toBe(1);
    const d2 = crypto.randomUUID();
    const q = await upload(worker, d2, "x.jpg", "image/jpeg", JPEG, "site.measurement");
    await q.complete();
    expect(["forbidden", "not_found"]).toContain(await kind(linkEvidence(await as(worker), { draftKey: d2, parentType: "quantity_snapshot", parentId: snap.id })));
  });
});
