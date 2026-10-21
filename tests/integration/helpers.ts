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
