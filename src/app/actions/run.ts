/**
 * Runs an application operation for a server action and returns a serializable Result.
 * Success is reported only after the server confirms the write.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { DEMO_COOKIE, resolveActor } from "@/server/auth/actor";
import { AppError, toAppError, type Result } from "@/server/errors";
import { makeCtx, type Ctx } from "@/server/services/context";

export async function run<T>(op: (ctx: Ctx, input: unknown) => Promise<T>, input: unknown, revalidate: string[] = ["/"]): Promise<Result<T>> {
  let correlationId = "none";
  try {
    const db = await getDb();
    const actor = await resolveActor(db, (await cookies()).get(DEMO_COOKIE)?.value);
    const ctx = makeCtx(db, actor);
    correlationId = ctx.correlationId;
    const data = await op(ctx, input);
    for (const p of revalidate) revalidatePath(p, "layout");
    return { ok: true, data: JSON.parse(JSON.stringify(data ?? null)) as T };
  } catch (e) {
    const err = e instanceof AppError ? e : toAppError(e);
    if (err.kind === "unexpected") console.error(`[${correlationId}] action failed`, e);
    return { ok: false, kind: err.kind, message: err.message, details: err.details, correlationId };
  }
}
