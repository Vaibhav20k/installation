/**
 * Direct upload of one evidence file. The short-lived signed URL comes from createEvidenceUpload; the
 * signed-in user must also match the session. Bytes stream to private storage, never into the database.
 */
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { DEMO_COOKIE, resolveActor } from "@/server/auth/actor";
import { HTTP_STATUS, toAppError } from "@/server/errors";
import { receiveUpload } from "@/server/services/evidence";
import { verifyUpload } from "@/integrations/storage";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const url = new URL(req.url);
  const expires = Number(url.searchParams.get("e"));
  const token = url.searchParams.get("t") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(sessionId) || !Number.isFinite(expires) || !verifyUpload(sessionId, expires, token)) {
    return Response.json({ ok: false, message: "This upload link is not valid." }, { status: 403 });
  }
  if (expires < Date.now()) return Response.json({ ok: false, message: "This upload link has expired. Retry the file." }, { status: 410 });
  if (!req.body) return Response.json({ ok: false, message: "No file received." }, { status: 400 });
  try {
    const db = await getDb();
    const actor = await resolveActor(db, (await cookies()).get(DEMO_COOKIE)?.value);
    const r = await receiveUpload(db, actor.id, sessionId, req.body, Date.now());
    return Response.json({ ok: true, bytes: r.bytes });
  } catch (e) {
    if (e instanceof Error && e.message === "too_large") return Response.json({ ok: false, message: "The file is larger than the allowed size." }, { status: 413 });
    if (e instanceof Error && e.message === "storage_unavailable") return Response.json({ ok: false, message: "Photo and video storage is not available right now." }, { status: 503 });
    const err = toAppError(e);
    return Response.json({ ok: false, message: err.message }, { status: HTTP_STATUS[err.kind] });
  }
}
