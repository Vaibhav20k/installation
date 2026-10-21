/**
 * Permission model (master prompt section 12). Job role and permission role are separate.
 * Scope is enforced on every read and write by the services, never by navigation alone.
 */
import type { Queryable } from "../db/client";
import { forbidden } from "../errors";

export type PermissionRole = "employee" | "supervisor" | "manager" | "admin";
export type Capability =
  | "accounts_clearance" | "finance_verify" | "kra_review" | "skill_verify"
  | "rate_approve" | "policy_activate" | "target_approve";

export interface Actor {
  id: string;
  businessId: string;
  name: string;
  jobRole: string;
  role: PermissionRole;
  capabilities: Capability[];
  managerId: string | null;
}

const RANK: Record<PermissionRole, number> = { employee: 0, supervisor: 1, manager: 2, admin: 3 };

export function atLeast(actor: Actor, role: PermissionRole) {
  return RANK[actor.role] >= RANK[role];
}

export function requireRole(actor: Actor, role: PermissionRole, action = "this action") {
  if (!atLeast(actor, role)) throw forbidden(`Only a ${role} or above can perform ${action}.`);
}

export function hasCapability(actor: Actor, cap: Capability) {
  return actor.role === "admin" || actor.capabilities.includes(cap);
}

export function requireCapability(actor: Actor, cap: Capability, action: string) {
  // Admins manage master data, but protected approvals still need the explicit capability.
  if (!actor.capabilities.includes(cap)) throw forbidden(`${action} requires the "${cap.replace("_", " ")}" capability.`);
}

/** Employee ids the actor may see: self, plus reports down the manager chain; admin sees all. */
export async function visibleEmployeeIds(q: Queryable, actor: Actor): Promise<Set<string> | "all"> {
  if (actor.role === "admin") return "all";
  if (actor.role === "employee") return new Set([actor.id]);
  const rows = await q.query<{ id: string }>(
    `with recursive tree(id) as (
       select id from employee where manager_id = $1
       union select e.id from employee e join tree t on e.manager_id = t.id
     ) select id from tree`,
    [actor.id],
  );
  return new Set([actor.id, ...rows.map((r) => r.id)]);
}

export async function canSeeEmployee(q: Queryable, actor: Actor, employeeId: string) {
  const ids = await visibleEmployeeIds(q, actor);
  return ids === "all" || ids.has(employeeId);
}

export async function requireEmployeeScope(q: Queryable, actor: Actor, employeeId: string) {
  if (!(await canSeeEmployee(q, actor, employeeId))) throw forbidden("That employee is outside your scope.");
}

/**
 * Project scope: admins see all; managers see projects they manage; supervisors see their manager's
 * projects; everyone sees projects where they hold a reservation.
 */
export function projectScopeSql(actor: Actor, alias = "p", param = "$1"): { sql: string; all: boolean } {
  if (actor.role === "admin") return { sql: "true", all: true };
  const viaReservation = `exists (select 1 from visit v2 join reservation r2 on r2.visit_id = v2.id where v2.project_id = ${alias}.id and r2.employee_id = ${param})`;
  if (actor.role === "manager") return { sql: `(${alias}.manager_id = ${param} or ${viaReservation})`, all: false };
  if (actor.role === "supervisor") return { sql: `(${alias}.manager_id = (select manager_id from employee where id = ${param}) or ${viaReservation})`, all: false };
  return { sql: viaReservation, all: false };
}

export async function requireProjectScope(q: Queryable, actor: Actor, projectId: string) {
  const s = projectScopeSql(actor, "p", "$2");
  const rows = await q.query(`select 1 from project p where p.id = $1 and ${s.sql}`, s.all ? [projectId] : [projectId, actor.id]);
  if (rows.length === 0) throw forbidden("That project is outside your scope.");
}

/** No self-approval by default. */
export function forbidSelfApproval(actor: Actor, ownerId: string, what: string) {
  if (actor.id === ownerId) throw forbidden(`You cannot approve your own ${what}.`);
}
