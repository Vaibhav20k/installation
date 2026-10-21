/**
 * Append-only audit trail. Before/after values exclude private fields such as phone numbers.
 */
import { randomUUID } from "node:crypto";
import type { Queryable } from "./db/client";

const PRIVATE_KEYS = new Set(["phone", "password", "token"]);

function safe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(safe);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!PRIVATE_KEYS.has(k)) out[k] = safe(v);
    return out;
  }
  return value;
}

export interface AuditInput {
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  correlationId?: string;
}

export async function audit(q: Queryable, a: AuditInput) {
  await q.query(
    `insert into audit_event(actor_id, action, object_type, object_id, before, after, reason, correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.actorId, a.action, a.objectType, a.objectId, JSON.stringify(safe(a.before)), JSON.stringify(safe(a.after)), a.reason ?? null, a.correlationId ?? randomUUID()],
  );
}

export function newCorrelationId() {
  return randomUUID();
}
