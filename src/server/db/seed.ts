/**
 * Seed pipeline: master data first, then operational demo records created through the services.
 */
import type { Db } from "./client";
import { seedMaster } from "./seed-master";

export async function seedIfEmpty(db: Db, opts: { operational?: boolean } = {}) {
  const [row] = await db.query<{ n: number }>("select count(*)::int as n from employee");
  if (row && row.n > 0) return false;
  await db.tx((q) => seedMaster(q));
  if (opts.operational !== false) {
    const { seedOperational } = await import("./seed-operational");
    await seedOperational(db);
  }
  return true;
}
