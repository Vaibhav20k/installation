/**
 * Builds a separate, clearly labelled performance fixture (spec V3 §4): the demo seed plus 12 months of
 * fictional time records for every field employee and at least 10,000 progress rows. Written to its own folder
 * (IM_DATA_DIR, default <data>/pg-large) so the normal demo database is never touched. Test data only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/server/db/client";
import { seedIfEmpty } from "../src/server/db/seed";

async function main() {
  const base = process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  const dir = process.env.IM_DATA_DIR ? path.resolve(process.env.IM_DATA_DIR) : path.join(base, "magppie-installation-management", "pg-large");
  fs.rmSync(dir, { recursive: true, force: true });
  const db = await openDb({ dataDir: dir, url: null });
  await seedIfEmpty(db);
  const people = await db.query<{ id: string }>("select id from employee where permission_role = 'employee' and active order by business_id");
  const [proj] = await db.query<{ id: string }>("select id from project where business_id = 'PRJ-004'");
  // Twelve months of one 08:00–17:00 IST entry per working day per employee (Sundays off), Oct 2025 – Sep 2026.
  let entries = 0;
  await db.tx(async (q) => {
    for (let d = Date.parse("2025-10-01T02:30:00Z"); d < Date.parse("2026-10-01T00:00:00Z"); d += 86_400_000) {
      if (new Date(d).getUTCDay() === 0) continue;
      const start = new Date(d).toISOString(), end = new Date(d + 9 * 3_600_000).toISOString();
      for (const p of people) {
        await q.query(`insert into time_entry(employee_id, project_id, activity, span, state, note, created_by) values ($1,$2,'installation',tstzrange($3::timestamptz,$4::timestamptz),'accepted','Performance fixture',$1)`,
          [p.id, proj!.id, start, end]);
        entries++;
      }
    }
  });
  // 10,000 small accepted progress events spread over the in-progress kitchen visit's tasks, within scope bounds.
  const tasks = await db.query<{ id: string; scoped: number }>("select vt.id, vt.scoped_quantity::float scoped from visit_task vt join visit v on v.id = vt.visit_id where v.business_id = 'VIS-006'");
  let rows = 0;
  await db.tx(async (q) => {
    for (let i = 0; i < 10_000; i++) {
      const t = tasks[i % tasks.length]!;
      await q.query("insert into progress_event(visit_task_id, step, quantity_delta, accepted, at, evidence) values ($1,'install',0.0001,true,$2,'Performance fixture')", [t.id, new Date(Date.parse("2026-10-14T05:00:00Z") + i * 1000).toISOString()]);
      rows++;
    }
  });
  await db.close();
  console.log(`Performance fixture at ${dir}: ${people.length} field employees, ${entries} time entries (12 months), ${rows} progress rows. Fictional test data.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
