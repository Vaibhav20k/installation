/**
 * Shared read helpers. Every read is scoped on the server by the acting user.
 */
import type { Queryable } from "../db/client";
import { projectScopeSql, visibleEmployeeIds, type Actor } from "../auth/permissions";

/** SQL predicate for visible projects with its parameters, numbered from `from`. */
export function projectFilter(actor: Actor, alias: string, from: number): { sql: string; params: unknown[] } {
  const s = projectScopeSql(actor, alias, `$${from}`);
  return s.all ? { sql: "true", params: [] } : { sql: s.sql, params: [actor.id] };
}

export async function employeeFilter(q: Queryable, actor: Actor, column: string, from: number): Promise<{ sql: string; params: unknown[] }> {
  const ids = await visibleEmployeeIds(q, actor);
  return ids === "all" ? { sql: "true", params: [] } : { sql: `${column} = any($${from}::uuid[])`, params: [[...ids]] };
}

export interface Paged<T> { rows: T[]; total: number; page: number; pageSize: number }

export function paging(page?: number, pageSize = 50) {
  const p = Math.max(1, Math.floor(page ?? 1));
  return { page: p, pageSize, offset: (p - 1) * pageSize };
}
