/**
 * Request session for server components and actions: database, acting user and service context.
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db/client";
import { seedIfEmpty } from "./db/seed";
import { DEMO_COOKIE, demoAuthEnabled, resolveActor } from "./auth/actor";
import { AppError } from "./errors";
import { makeCtx } from "./services/context";

const g = globalThis as unknown as { __imSeeded?: Promise<boolean> };

export async function database() {
  const db = await getDb();
  // Demo data is seeded once per empty database; a real deployment loads its own records instead.
  if (demoAuthEnabled()) g.__imSeeded ??= seedIfEmpty(db).catch((e) => { g.__imSeeded = undefined; throw e; });
  if (g.__imSeeded) await g.__imSeeded;
  return db;
}

export async function session() {
  const db = await database();
  const jar = await cookies();
  try {
    const actor = await resolveActor(db, jar.get(DEMO_COOKIE)?.value);
    return { db, actor, ctx: () => makeCtx(db, actor) };
  } catch (e) {
    if (e instanceof AppError && e.kind === "unauthenticated") redirect("/sign-in");
    throw e;
  }
}
