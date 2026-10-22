/**
 * Due-job runner endpoint for a production scheduler (cron) to call. Requires IM_JOB_SECRET; without it the
 * endpoint is disabled. Locally the in-process runner in instrumentation.ts does the same work.
 */
import { getDb } from "@/server/db/client";
import { processDueJobs } from "@/server/services/attendance";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.IM_JOB_SECRET;
  if (!secret || req.headers.get("x-job-secret") !== secret) return new Response("Not found", { status: 404 });
  const processed = await processDueJobs(await getDb(), Date.now());
  return Response.json({ processed });
}
