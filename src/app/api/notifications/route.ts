/** In-app notification inbox for the bell: focus-aware polling, one shared request per page. */
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { DEMO_COOKIE, resolveActor } from "@/server/auth/actor";
import { HTTP_STATUS, toAppError } from "@/server/errors";
import { notificationsFor } from "@/server/queries/attendance";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const actor = await resolveActor(db, (await cookies()).get(DEMO_COOKIE)?.value);
    const r = await notificationsFor(db, actor.id, Date.now());
    return Response.json({ ...r, serverNow: Date.now() }, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    const err = toAppError(e);
    return Response.json({ message: err.message }, { status: HTTP_STATUS[err.kind] });
  }
}
