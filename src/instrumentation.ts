/**
 * Local due-job runner: every 30 s, settle reminders and overtime transitions that are due. Jobs live in the
 * database, so a restart loses nothing; reads also settle due jobs, so a late runner never shows a wrong state.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.IM_DISABLE_JOB_RUNNER === "1") return;
  const g = globalThis as unknown as { __imJobRunner?: ReturnType<typeof setInterval> };
  if (g.__imJobRunner) return;
  const { getDb } = await import("./server/db/client");
  const { processDueJobs } = await import("./server/services/attendance");
  let busy = false;
  g.__imJobRunner = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await processDueJobs(await getDb(), Date.now()); } catch (e) { console.error("[due-jobs]", (e as Error).message); } finally { busy = false; }
  }, 30_000);
}
