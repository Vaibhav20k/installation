/**
 * Shared plumbing for application operations: transaction, validation, optimistic versions,
 * idempotency and settings. Every operation validates schema, permission, state, scope and version.
 */
import { z, type ZodType } from "zod";
import type { Db, Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { conflict, notFound, toAppError, validation } from "../errors";
import { newCorrelationId } from "../audit";

export interface Ctx {
  db: Db;
  actor: Actor;
  /** Injectable clock (epoch ms) so hold expiry and month-end rules are testable. */
  now: number;
  correlationId: string;
}

export function makeCtx(db: Db, actor: Actor, now = Date.now()): Ctx {
  const correlationId = newCorrelationId();
  return { db: guarded(db, correlationId), actor, now, correlationId };
}

/** Converts database errors into structured AppErrors at the service boundary. */
function guarded(db: Db, correlationId: string): Db {
  const convert = (e: unknown): never => {
    const app = toAppError(e);
    // Unexpected failures are logged with the correlation id only; no SQL parameters or personal data.
    if (app.kind === "unexpected") console.error(`[${correlationId}]`, (e as Error)?.message ?? e);
    throw app;
  };
  return {
    kind: db.kind,
    close: () => db.close(),
    query: <T,>(sql: string, params?: unknown[]) => db.query<T>(sql, params).catch(convert),
    exec: (script) => db.exec(script).catch(convert),
    tx: (fn) => db.tx(fn).catch(convert),
  };
}

export function parse<S extends ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw validation("Please correct the highlighted fields.", r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`));
  }
  return r.data;
}

export const zId = z.string().uuid();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD with an explicit year");
export const zTime = z.string().regex(/^\d{1,2}:\d{2}$/, "Use HH:MM");
export const zQty = z.string().regex(/^\d+(\.\d{1,6})?$/, "Use a nonnegative number with up to 6 decimals");
export const zVersion = z.number().int().positive();
export const zMinor = z.number().int().nonnegative();

/** Optimistic version check: bumps version when it matches, otherwise reports a meaningful conflict. */
export async function bumpVersion(q: Queryable, table: string, id: string, expected: number) {
  const rows = await q.query<{ version: number }>(`update ${table} set version = version + 1 where id = $1 and version = $2 returning version`, [id, expected]);
  if (rows.length === 0) {
    const [cur] = await q.query<{ version: number }>(`select version from ${table} where id = $1`, [id]);
    if (!cur) throw notFound(table.replace("_", " "));
    throw conflict(`Someone else changed this ${table.replace("_", " ")} (now version ${cur.version}). Reload to see their change before saving.`);
  }
  return rows[0]!.version;
}

/** Runs fn once per idempotency key; a repeat returns the stored result instead of writing again. */
export async function idempotent<T>(q: Queryable, actorId: string, rawKey: string | undefined, operation: string, fn: () => Promise<T>): Promise<T> {
  if (!rawKey) return fn();
  // Tokens are scoped to the acting user so one user can never receive another user's stored result.
  const key = `${actorId}:${rawKey}`;
  const [hit] = await q.query<{ operation: string; result: T }>("select operation, result from idempotency_key where key = $1", [key]);
  if (hit) {
    if (hit.operation !== operation) throw conflict("This submission token was already used for a different operation.");
    return hit.result;
  }
  const result = await fn();
  await q.query("insert into idempotency_key(key, operation, result, actor_id) values ($1,$2,$3,$4)", [key, operation, JSON.stringify(result ?? null), actorId]);
  return result;
}

export async function getSetting<T>(q: Queryable, key: string, fallback: T): Promise<T> {
  const [r] = await q.query<{ value: T }>("select value from app_setting where key = $1", [key]);
  return r ? r.value : fallback;
}

export async function one<T>(q: Queryable, sql: string, params: unknown[], what: string): Promise<T> {
  const [r] = await q.query<T>(sql, params);
  if (!r) throw notFound(what);
  return r;
}

export const iso = (ms: number) => new Date(ms).toISOString();
