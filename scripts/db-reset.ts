/**
 * Recreates the embedded demo database: deletes its folder and re-runs migrations and seeds.
 * Refuses to touch an external DATABASE_URL and refuses while a running server holds the folder.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/server/db/client";
import { seedIfEmpty } from "../src/server/db/seed";

async function main() {
  if (process.env.DATABASE_URL) {
    console.error("DATABASE_URL is set. This script only resets the embedded demo database; reset an external database with your own tooling.");
    process.exit(1);
  }
  const base = process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  const dir = process.env.IM_DATA_DIR ? path.resolve(process.env.IM_DATA_DIR) : path.join(base, "magppie-installation-management", "pg");
  const lock = `${dir}.lock`;
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, "utf8"));
    try { if (pid) { process.kill(pid, 0); console.error(`Process ${pid} is using the database. Stop the dev server first.`); process.exit(1); } } catch { /* stale lock */ }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(lock, { force: true });
  const db = await openDb({ dataDir: dir, url: null });
  await seedIfEmpty(db);
  const [n] = await db.query<{ e: number; v: number }>("select (select count(*)::int from employee) e, (select count(*)::int from visit) v");
  await db.close();
  console.log(`Embedded database recreated at ${dir}: ${n!.e} employees, ${n!.v} visits (demo data).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
