/**
 * Identity boundary. The demo identity selector reads a cookie and is disabled in production;
 * a real deployment must plug an authentication provider into resolveActor().
 */
import type { Queryable } from "../db/client";
import { AppError } from "../errors";
import type { Actor, Capability, PermissionRole } from "./permissions";

export const DEMO_COOKIE = "im_demo_actor";

/** Demo identities: on in development; in a production build only for the local preview (IM_LOCAL_DEMO=1). */
export function demoAuthEnabled() {
  if (process.env.IM_DISABLE_DEMO_AUTH === "1") return false;
  return process.env.NODE_ENV !== "production" || process.env.IM_LOCAL_DEMO === "1";
}

interface EmployeeRow {
  id: string; business_id: string; name: string; job_role: string; permission_role: PermissionRole;
  capabilities: Capability[]; manager_id: string | null; active: boolean;
}

export async function loadActor(q: Queryable, employeeId: string): Promise<Actor | null> {
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) return null;
  const [r] = await q.query<EmployeeRow>(
    "select id, business_id, name, job_role, permission_role, capabilities, manager_id, active from employee where id = $1",
    [employeeId],
  );
  if (!r || !r.active) return null;
  return { id: r.id, businessId: r.business_id, name: r.name, jobRole: r.job_role, role: r.permission_role, capabilities: r.capabilities ?? [], managerId: r.manager_id };
}

/** Resolves the acting user from a cookie value. Production has no demo bypass. */
export async function resolveActor(q: Queryable, cookieValue: string | undefined): Promise<Actor> {
  if (!demoAuthEnabled()) {
    throw new AppError("unauthenticated", "No authentication provider is configured. Demo sign-in is disabled in production.");
  }
  const actor = cookieValue ? await loadActor(q, cookieValue) : null;
  if (!actor) throw new AppError("unauthenticated", "Choose a demo identity to continue.");
  return actor;
}
