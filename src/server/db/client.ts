/**
 * Database access. Uses an external PostgreSQL server when DATABASE_URL is set, otherwise an
 * embedded PostgreSQL (PGlite) stored under IM_DATA_DIR. Both return the same value shapes:
 * date -> "YYYY-MM-DD", numeric -> string, timestamptz -> epoch ms, int8 -> number.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs a multi-statement script without parameters. */
  exec(script: string): Promise<void>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: "embedded" | "external";
}

const OID = { int8: 20, numeric: 1700, date: 1082, timestamp: 1114, timestamptz: 1184 };
const parseTs = (v: string) => Date.parse(v.includes("T") ? v : v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
const parseInt8 = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`int8 value ${v} exceeds safe integer range`);
  return n;
};

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * The embedded database is single-process. An app-level lock records the owning process; if that
 * process is gone (killed dev server), PGlite's stale postmaster.pid is cleared so the data reopens.
 */
function claimDataDir(dataDir: string) {
  const lock = `${dataDir}.lock`;
  if (fs.existsSync(lock)) {
    const owner = Number(fs.readFileSync(lock, "utf8"));
    if (owner && owner !== process.pid && alive(owner)) {
      throw new Error(`The embedded database at ${dataDir} is in use by process ${owner}. Stop that server or set IM_DATA_DIR to another folder.`);
    }
  }
  // No other live process owns the folder, and this process opens at most one instance (getDb singleton),
  // so any PGlite postmaster.pid left here is stale.
  fs.rmSync(path.join(dataDir, "postmaster.pid"), { force: true });
  fs.writeFileSync(lock, String(process.pid));
  return lock;
}

async function openEmbedded(dataDir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  let lock: string | null = null;
  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    lock = claimDataDir(dataDir);
  }
  const pg = await PGlite.create({
    dataDir,
    extensions: { btree_gist },
    parsers: {
      [OID.int8]: parseInt8,
      [OID.numeric]: (v: string) => v,
      [OID.date]: (v: string) => v,
      [OID.timestamp]: parseTs,
      [OID.timestamptz]: parseTs,
    },
  });
  await pg.exec("set timezone = 'UTC'");
  const wrap = (q: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (s: string) => Promise<unknown> }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await q.query(sql, params)).rows as T[];
    },
    async exec(script: string) { await q.exec(script); },
  });
  const close = async () => {
    if (!pg.closed) await pg.close();
    if (lock) fs.rmSync(lock, { force: true });
  };
  if (lock) {
    // Close cleanly on shutdown so the data folder is not left locked.
    const onSignal = () => { void close().finally(() => process.exit(0)); };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    process.once("exit", () => { if (lock) fs.rmSync(lock, { force: true }); });
  }
  // PGlite runs one statement at a time; transactions are serialized by its internal mutex.
  return {
    kind: "embedded",
    ...wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    close,
  };
}

async function openExternal(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, {
    max: 10,
    connection: { TimeZone: "UTC" },
    types: {
      int8: { to: OID.int8, from: [OID.int8], serialize: String, parse: parseInt8 },
      numeric: { to: OID.numeric, from: [OID.numeric], serialize: String, parse: (v: string) => v },
      date: { to: OID.date, from: [OID.date], serialize: String, parse: (v: string) => v },
      ts: { to: OID.timestamptz, from: [OID.timestamp, OID.timestamptz], serialize: (v: unknown) => String(v), parse: parseTs },
    },
  });
  const wrap = (s: typeof sql): Queryable => ({
    async query<T>(text: string, params: unknown[] = []) {
      return (await s.unsafe(text, params as never[])) as unknown as T[];
    },
    // unsafe() without parameters uses the simple protocol, which accepts several statements.
    async exec(script: string) { await s.unsafe(script).simple(); },
  });
  return {
    kind: "external",
    ...wrap(sql),
    tx: (fn) => sql.begin((t) => fn(wrap(t as unknown as typeof sql))) as Promise<never>,
    close: () => sql.end(),
  };
}

export async function openDb(opts: { url?: string | null; dataDir?: string | null } = {}): Promise<Db> {
  // url: null forces the embedded database (tests); undefined falls back to DATABASE_URL.
  const url = opts.url === null ? undefined : opts.url ?? process.env.DATABASE_URL;
  const db = url ? await openExternal(url) : await openEmbedded(opts.dataDir === null ? undefined : opts.dataDir ?? dataDirFromEnv());
  await migrate(db);
  return db;
}

/**
 * Default embedded-database folder is outside the project so cloud-synced folders (OneDrive, Dropbox)
 * never hold database files open mid-write. IM_DATA_DIR overrides it.
 */
function dataDirFromEnv() {
  if (process.env.IM_DATA_DIR) return path.resolve(process.cwd(), process.env.IM_DATA_DIR);
  // Vercel functions can only write to the temporary folder (the data there is lost when the server restarts).
  if (process.env.VERCEL) return path.join(os.tmpdir(), "magppie-installation-management", "pg");
  const base = process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "magppie-installation-management", "pg");
}

export function migrationsDir() {
  return path.resolve(process.cwd(), "db/migrations");
}

/** Applies numbered SQL files once, in order, each inside a transaction. */
export async function migrate(db: Db) {
  await db.query(`create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>("select name from schema_migration")).map((r) => r.name));
  const files = fs.readdirSync(migrationsDir()).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const text = fs.readFileSync(path.join(migrationsDir(), f), "utf8");
    await db.tx(async (q) => {
      await q.exec(text);
      await q.query("insert into schema_migration(name) values ($1)", [f]);
    });
  }
}

const g = globalThis as unknown as { __imDb?: Promise<Db> };

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDb(): Promise<Db> {
  if (!g.__imDb) g.__imDb = openDb().catch((e) => { g.__imDb = undefined; throw e; });
  return g.__imDb;
}
