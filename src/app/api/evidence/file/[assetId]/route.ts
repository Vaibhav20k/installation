/**
 * Serves one evidence file after re-checking permission on every request (no long-lived public URLs).
 * Supports byte ranges so videos can seek; responses are private and not shared between users.
 */
import { Readable } from "node:stream";
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { DEMO_COOKIE, resolveActor } from "@/server/auth/actor";
import { HTTP_STATUS, toAppError } from "@/server/errors";
import { authorizeAssetRead } from "@/server/services/evidence";
import { evidenceStorage } from "@/integrations/storage";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(assetId)) return new Response("Not found", { status: 404 });
  try {
    const db = await getDb();
    const actor = await resolveActor(db, (await cookies()).get(DEMO_COOKIE)?.value);
    const a = await authorizeAssetRead(db, actor, assetId);
    const storage = evidenceStorage();
    const size = await storage.size(a.storage_key);
    const headers: Record<string, string> = { "content-type": a.mime, "cache-control": "private, max-age=300", "accept-ranges": "bytes", "x-content-type-options": "nosniff",
      // PDFs (invoices, e-way bills) download rather than render inside the app's origin.
      "content-disposition": `${a.mime === "application/pdf" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.original_name)}` };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      const body = Readable.toWeb(storage.stream(a.storage_key, { start, end })) as ReadableStream;
      return new Response(body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(storage.stream(a.storage_key)) as ReadableStream, { status: 200, headers: { ...headers, "content-length": String(size) } });
  } catch (e) {
    const err = toAppError(e);
    return new Response(err.message, { status: HTTP_STATUS[err.kind] });
  }
}
