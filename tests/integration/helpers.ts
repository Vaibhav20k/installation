import { openDb, type Db } from "@/server/db/client";
import { seedIfEmpty } from "@/server/db/seed";
import { loadActor } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";

/** Fresh in-memory embedded database with demo master data. */
export async function freshDb(opts: { operational?: boolean } = {}): Promise<Db> {
  const db = await openDb({ dataDir: null, url: null });
  await seedIfEmpty(db, { operational: opts.operational ?? false });
  return db;
}

export async function actor(db: Db, businessId: string): Promise<Actor> {
  const [r] = await db.query<{ id: string }>("select id from employee where business_id = $1", [businessId]);
  const a = r && (await loadActor(db, r.id));
  if (!a) throw new Error(`No active employee ${businessId}`);
  return a;
}

export async function idOf(db: Db, table: string, businessId: string): Promise<string> {
  const [r] = await db.query<{ id: string }>(`select id from ${table} where business_id = $1`, [businessId]);
  if (!r) throw new Error(`${table} ${businessId} not found`);
  return r.id;
}

/**
 * A ready clock-in photo for tests: an image asset already uploaded and checked, under a fresh draft key.
 * (The real upload path is covered in evidence.test.ts.)
 */
export async function clockInPhoto(db: Db, employeeId: string, at: number): Promise<string> {
  const draftKey = crypto.randomUUID();
  const [a] = await db.query<{ id: string }>(
    "insert into evidence_asset(uploader_id, storage_key, original_name, media_type, mime, byte_size, state, received_at) values ($1, gen_random_uuid()::text || '.bin', 'selfie.jpg', 'image', 'image/jpeg', 1000, 'ready', $2) returning id",
    [employeeId, new Date(at).toISOString()]);
  await db.query("insert into upload_session(actor_id, draft_key, context, asset_id, expected_mime, expected_size, idempotency_key, expires_at, completed_at, created_at) values ($1,$2,'attendance.clock_in',$3,'image/jpeg',1000,$4,$5,$6,$6)",
    [employeeId, draftKey, a!.id, crypto.randomUUID(), new Date(at + 900_000).toISOString(), new Date(at).toISOString()]);
  return draftKey;
}
