/**
 * Append-only change history for employee skill records. Every path that changes a skill (the People page,
 * the admin skill cards, verification) writes here inside its own transaction, alongside the audit event.
 */
import type { Queryable } from "../db/client";

export type SkillChange = "claimed" | "level" | "validity" | "notes" | "verified" | "unverified";

export async function recordSkillChange(q: Queryable, c: { employeeSkillId: string; employeeId: string; change: SkillChange; before?: unknown; after?: unknown; reason?: string | null; actorId: string }) {
  const [r] = await q.query<{ id: string }>(
    "insert into employee_skill_change(employee_skill_id, employee_id, change, before, after, reason, actor_id) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [c.employeeSkillId, c.employeeId, c.change, c.before === undefined ? null : JSON.stringify(c.before), c.after === undefined ? null : JSON.stringify(c.after), c.reason ?? null, c.actorId]);
  return r!.id;
}
