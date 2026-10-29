/**
 * Master data and project scope: customers, projects, orders, components, tasks, employees,
 * skills, calendars and leave (phase 3).
 */
import { z } from "zod";
import { audit } from "../audit";
import { forbidSelfApproval, requireCapability, requireEmployeeScope, requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { bumpVersion, one, parse, zDate, zId, zQty, zVersion, type Ctx } from "./context";
import { recordSkillChange } from "./skill-history";

const JOB_ROLES = ["project_manager", "operator", "site_supervisor", "carpenter", "helper", "senior_technician", "technician", "junior_technician", "assistant_technician", "stone_technician", "department_staff"] as const;

async function nextBusinessId(ctx: Ctx, table: string, prefix: string) {
  const [r] = await ctx.db.query<{ n: number }>(
    `select coalesce(max(substring(business_id from '\\d+$')::int), 0) + 1 as n from ${table} where business_id like $1`, [`${prefix}-%`]);
  return `${prefix}-${String(r!.n).padStart(3, "0")}`;
}

export async function createProject(ctx: Ctx, input: unknown) {
  requireRole(ctx.actor, "manager", "project creation");
  const d = parse(z.object({
    customerId: zId, name: z.string().trim().min(2).max(120), siteAddress: z.string().trim().min(3).max(300),
    city: z.string().trim().min(2).max(80), timezone: z.string().default("Asia/Kolkata"),
    managerId: zId.optional(), kitchenFloorArea: zQty.optional(),
  }), input);
  try { new Intl.DateTimeFormat("en", { timeZone: d.timezone }); } catch { throw validation("Unknown timezone", [`timezone: ${d.timezone}`]); }
  const bid = await nextBusinessId(ctx, "project", "PRJ");
  return ctx.db.tx(async (q) => {
    const [p] = await q.query<{ id: string }>(
      `insert into project(business_id, customer_id, name, site_address, city, timezone, manager_id, kitchen_floor_area, kitchen_floor_area_unit, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning id`,
      [bid, d.customerId, d.name, d.siteAddress, d.city, d.timezone, d.managerId ?? ctx.actor.id, d.kitchenFloorArea ?? null, d.kitchenFloorArea ? "sqft" : null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "create", objectType: "project", objectId: p!.id, after: d, correlationId: ctx.correlationId });
    return { id: p!.id, businessId: bid };
  });
}

export async function createOrder(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, externalRef: z.string().trim().max(60).optional(), promisedCompletion: zDate.optional() }), input);
  requireRole(ctx.actor, "manager", "order creation");
  await requireProjectScope(ctx.db, ctx.actor, d.projectId);
  const bid = await nextBusinessId(ctx, "sales_order", "ORD");
  return ctx.db.tx(async (q) => {
    const [o] = await q.query<{ id: string }>(
      `insert into sales_order(business_id, project_id, external_ref, source_system, promised_completion) values ($1,$2,$3,'manual',$4) returning id`,
      [bid, d.projectId, d.externalRef ?? null, d.promisedCompletion ?? null]);
    await audit(q, { actorId: ctx.actor.id, action: "create", objectType: "order", objectId: o!.id, after: d, correlationId: ctx.correlationId });
    return { id: o!.id, businessId: bid };
  });
}

export async function addOrderItem(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ orderId: zId, productType: z.string().trim().regex(/^[a-z_]+$/, "Use a lowercase product type such as kitchen").max(40), name: z.string().trim().min(2).max(120) }), input);
  requireRole(ctx.actor, "manager", "scope changes");
  const [o] = await ctx.db.query<{ project_id: string }>("select project_id from sales_order where id = $1", [d.orderId]);
  if (!o) throw validation("Order not found");
  await requireProjectScope(ctx.db, ctx.actor, o.project_id);
  const bid = await nextBusinessId(ctx, "order_item", "OI");
  return ctx.db.tx(async (q) => {
    const [r] = await q.query<{ id: string }>("insert into order_item(business_id, order_id, product_type, name, source_version) values ($1,$2,$3,$4,'manual') returning id", [bid, d.orderId, d.productType, d.name]);
    await audit(q, { actorId: ctx.actor.id, action: "create", objectType: "order_item", objectId: r!.id, after: d, correlationId: ctx.correlationId });
    return { id: r!.id, businessId: bid };
  });
}

export async function addComponentWithTasks(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    orderItemId: zId, name: z.string().trim().min(1).max(120), quantity: zQty, unit: z.string().trim().min(1).max(20),
    quantityKind: z.string().regex(/^[a-z_]+$/, "Use a lowercase quantity kind such as cabinet_surface_area"),
    steps: z.array(z.enum(["unpack", "assemble", "install", "finish", "other"])).min(1).max(6),
  }), input);
  requireRole(ctx.actor, "manager", "scope changes");
  const [scope] = await ctx.db.query<{ project_id: string }>(
    `select o.project_id from order_item oi join sales_order o on o.id = oi.order_id where oi.id = $1`, [d.orderItemId]);
  if (!scope) throw validation("Order item not found");
  await requireProjectScope(ctx.db, ctx.actor, scope.project_id);
  const cbid = await nextBusinessId(ctx, "component", "CMP");
  return ctx.db.tx(async (q) => {
    const [c] = await q.query<{ id: string }>(
      `insert into component(business_id, order_item_id, name, quantity, unit, quantity_kind) values ($1,$2,$3,$4,$5,$6) returning id`,
      [cbid, d.orderItemId, d.name, d.quantity, d.unit, d.quantityKind]);
    let prev: string | null = null;
    for (const [i, step] of d.steps.entries()) {
      const [n] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from installation_task`);
      const [t]: Array<{ id: string }> = await q.query<{ id: string }>(
        `insert into installation_task(business_id, component_id, activity, step_order, required_quantity, unit, quantity_kind) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [`TSK-${String(n!.n).padStart(3, "0")}`, c!.id, step, i + 1, d.quantity, d.unit, d.quantityKind]);
      if (prev) await q.query("insert into task_dependency(task_id, predecessor_id) values ($1,$2)", [t!.id, prev]);
      prev = t!.id;
    }
    await audit(q, { actorId: ctx.actor.id, action: "create", objectType: "component", objectId: c!.id, after: d, correlationId: ctx.correlationId });
    return { id: c!.id, businessId: cbid };
  });
}

/** Adds a dependency only if it keeps the task graph acyclic. */
export async function addTaskDependency(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ taskId: zId, predecessorId: zId }), input);
  requireRole(ctx.actor, "manager", "dependency changes");
  if (d.taskId === d.predecessorId) throw validation("A task cannot depend on itself.");
  return ctx.db.tx(async (q) => {
    const projects = await q.query<{ project_id: string }>(
      `select o.project_id from installation_task t join component c on c.id = t.component_id join order_item oi on oi.id = c.order_item_id
       join sales_order o on o.id = oi.order_id where t.id = any($1::uuid[])`, [[d.taskId, d.predecessorId]]);
    if (projects.length !== 2) throw validation("Task not found.");
    if (projects[0]!.project_id !== projects[1]!.project_id) throw validation("Dependencies must stay within one project.");
    await requireProjectScope(q, ctx.actor, projects[0]!.project_id);
    const cycle = await q.query(
      `with recursive up(id) as (select predecessor_id from task_dependency where task_id = $1
         union select td.predecessor_id from task_dependency td join up on td.task_id = up.id)
       select 1 from up where id = $2 limit 1`, [d.predecessorId, d.taskId]);
    if (cycle.length) throw validation("That dependency would create a cycle.");
    await q.query("insert into task_dependency(task_id, predecessor_id) values ($1,$2)", [d.taskId, d.predecessorId]);
    await audit(q, { actorId: ctx.actor.id, action: "add_dependency", objectType: "task", objectId: d.taskId, after: d, correlationId: ctx.correlationId });
  });
}

export async function updateEmployee(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    employeeId: zId, version: zVersion,
    jobRole: z.enum(JOB_ROLES).optional(),
    permissionRole: z.enum(["employee", "supervisor", "manager", "admin"]).optional(),
    managerId: zId.nullable().optional(), baseCity: z.string().trim().min(2).max(80).optional(),
    active: z.boolean().optional(),
  }), input);
  requireRole(ctx.actor, "admin", "employee master changes");
  if (d.managerId === d.employeeId) throw validation("An employee cannot report to themselves.");
  return ctx.db.tx(async (q) => {
    const before = await one<Record<string, unknown>>(q, "select job_role, permission_role, manager_id, base_city, active from employee where id = $1", [d.employeeId], "Employee");
    await bumpVersion(q, "employee", d.employeeId, d.version);
    await q.query(
      `update employee set job_role = coalesce($2, job_role), permission_role = coalesce($3, permission_role),
         manager_id = case when $4::boolean then $5::uuid else manager_id end, base_city = coalesce($6, base_city),
         active = coalesce($7, active), updated_at = now(), updated_by = $8 where id = $1`,
      [d.employeeId, d.jobRole ?? null, d.permissionRole ?? null, d.managerId !== undefined, d.managerId ?? null, d.baseCity ?? null, d.active ?? null, ctx.actor.id]);
    // Deactivation keeps every historical record; future holds are listed for review, not deleted.
    await audit(q, { actorId: ctx.actor.id, action: d.active === false ? "deactivate" : "update", objectType: "employee", objectId: d.employeeId, before, after: d, correlationId: ctx.correlationId });
  });
}

export async function addEmployeeSkill(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    employeeId: zId, skillId: zId, level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    validFrom: zDate.optional(), validTo: zDate.optional(), notes: z.string().trim().max(500).optional(), reason: z.string().trim().max(300).optional(),
  }), input);
  requireRole(ctx.actor, "supervisor", "recording skills");
  await requireEmployeeScope(ctx.db, ctx.actor, d.employeeId);
  if (d.validFrom && d.validTo && d.validTo < d.validFrom) throw validation("Valid-to date is before valid-from date.");
  return ctx.db.tx(async (q) => {
    // A claimed level is recorded unverified; verification is a separate protected action.
    const [dup] = await q.query("select 1 from employee_skill where employee_id = $1 and skill_id = $2 and (valid_to is null or valid_to >= current_date) limit 1", [d.employeeId, d.skillId]);
    if (dup) throw conflict("This person already has a current record for this skill. Edit that record instead.");
    const [r] = await q.query<{ id: string }>(
      `insert into employee_skill(employee_id, skill_id, level, verified, valid_from, valid_to, notes) values ($1,$2,$3,false,$4,$5,$6) returning id`,
      [d.employeeId, d.skillId, d.level, d.validFrom ?? null, d.validTo ?? null, d.notes ?? null]);
    await recordSkillChange(q, { employeeSkillId: r!.id, employeeId: d.employeeId, change: "claimed", after: { level: d.level, validFrom: d.validFrom ?? null, validTo: d.validTo ?? null, notes: d.notes ?? null }, reason: d.reason ?? null, actorId: ctx.actor.id });
    await audit(q, { actorId: ctx.actor.id, action: "add_skill", objectType: "employee_skill", objectId: r!.id, after: d, reason: d.reason, correlationId: ctx.correlationId });
    return { id: r!.id };
  });
}

/**
 * Edit level, validity or notes. A changed level clears verification: the earlier verification was of a different
 * level, and editing must never silently mark (or keep) a skill verified. Stale edits are refused by version.
 * Supervisors and above, for people in their scope; the skill cards call this behind the Admin permission.
 */
export async function updateEmployeeSkill(ctx: Ctx, input: unknown) {
  requireRole(ctx.actor, "supervisor", "correcting skills");
  const d = parse(z.object({ employeeSkillId: zId, version: z.number().int().positive(), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), validFrom: zDate.nullable().optional(), validTo: zDate.nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(), reason: z.string().trim().min(3, "Give a reason for the change").max(300) }), input);
  return ctx.db.tx(async (q) => {
    const s = await one<{ employee_id: string; level: number; verified: boolean; valid_from: string | null; valid_to: string | null; notes: string | null; version: number }>(q,
      "select employee_id, level, verified, valid_from::text, valid_to::text, notes, version from employee_skill where id = $1 for update", [d.employeeSkillId], "Skill record");
    await requireEmployeeScope(q, ctx.actor, s.employee_id);
    if (s.version !== d.version) throw conflict("This skill was changed by someone else since you opened it. Reopen the card to see the latest values.");
    const next = { level: d.level ?? s.level, validFrom: d.validFrom !== undefined ? d.validFrom : s.valid_from, validTo: d.validTo !== undefined ? d.validTo : s.valid_to, notes: d.notes !== undefined ? d.notes : s.notes };
    if (next.validFrom && next.validTo && next.validTo < next.validFrom) throw validation("Valid-to date is before valid-from date.");
    const changes: Array<{ change: "level" | "validity" | "notes" | "unverified"; before: unknown; after: unknown }> = [];
    if (next.level !== s.level) changes.push({ change: "level", before: { level: s.level }, after: { level: next.level } });
    if (next.level !== s.level && s.verified) changes.push({ change: "unverified", before: { verified: true }, after: { verified: false, why: "level changed; needs fresh verification" } });
    if (next.validFrom !== s.valid_from || next.validTo !== s.valid_to) changes.push({ change: "validity", before: { validFrom: s.valid_from, validTo: s.valid_to }, after: { validFrom: next.validFrom, validTo: next.validTo } });
    if ((next.notes ?? null) !== (s.notes ?? null)) changes.push({ change: "notes", before: { notes: s.notes }, after: { notes: next.notes } });
    if (!changes.length) throw validation("Nothing changed.");
    const clearVerification = next.level !== s.level && s.verified;
    await q.query(
      `update employee_skill set level = $2, valid_from = $3, valid_to = $4, notes = $5, version = version + 1,
         verified = case when $6 then false else verified end, verified_by = case when $6 then null else verified_by end, verified_at = case when $6 then null else verified_at end
       where id = $1`, [d.employeeSkillId, next.level, next.validFrom, next.validTo, next.notes, clearVerification]);
    let changeId = "";
    for (const c of changes) changeId = await recordSkillChange(q, { employeeSkillId: d.employeeSkillId, employeeId: s.employee_id, ...c, reason: d.reason, actorId: ctx.actor.id });
    await audit(q, { actorId: ctx.actor.id, action: "update_skill", objectType: "employee_skill", objectId: d.employeeSkillId, before: s, after: next, reason: d.reason, correlationId: ctx.correlationId });
    return { changeId, verificationCleared: clearVerification };
  });
}

export async function verifySkill(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ employeeSkillId: zId, verified: z.boolean(), validTo: zDate.nullable().optional(), note: z.string().max(300).optional() }), input);
  requireCapability(ctx.actor, "skill_verify", "Skill verification");
  return ctx.db.tx(async (q) => {
    const s = await one<{ employee_id: string; verified: boolean; level: number; valid_to: string | null }>(q, "select employee_id, verified, level, valid_to::text from employee_skill where id = $1 for update", [d.employeeSkillId], "Skill record");
    forbidSelfApproval(ctx.actor, s.employee_id, "skill record");
    await requireEmployeeScope(q, ctx.actor, s.employee_id);
    await q.query(
      `update employee_skill set verified = $2, verified_by = case when $2 then $3::uuid end, verified_at = case when $2 then now() end,
         valid_to = case when $4::boolean then $5::date else valid_to end where id = $1`,
      [d.employeeSkillId, d.verified, ctx.actor.id, d.validTo !== undefined, d.validTo ?? null]);
    await q.query("update employee_skill set version = version + 1 where id = $1", [d.employeeSkillId]);
    await recordSkillChange(q, { employeeSkillId: d.employeeSkillId, employeeId: s.employee_id, change: d.verified ? "verified" : "unverified",
      before: { verified: s.verified, level: s.level, validTo: s.valid_to }, after: { verified: d.verified, level: s.level, validTo: d.validTo !== undefined ? d.validTo : s.valid_to }, reason: d.note ?? null, actorId: ctx.actor.id });
    await audit(q, { actorId: ctx.actor.id, action: d.verified ? "verify_skill" : "unverify_skill", objectType: "employee_skill", objectId: d.employeeSkillId, before: s, after: d, reason: d.note, correlationId: ctx.correlationId });
  });
}

export async function recordLeave(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ employeeId: zId, from: zDate, to: zDate, kind: z.string().trim().min(2).max(60), timezone: z.string().default("Asia/Kolkata") }), input);
  requireRole(ctx.actor, "supervisor", "recording leave");
  await requireEmployeeScope(ctx.db, ctx.actor, d.employeeId);
  if (d.to < d.from) throw validation("Leave end date is before its start date.");
  return ctx.db.tx(async (q) => {
    const clash = await q.query<{ business_id: string }>(
      `select v.business_id from reservation r join visit v on v.id = r.visit_id
       where r.employee_id = $1 and r.state in ('held','confirmed')
         and r.span && tstzrange(($2::date)::timestamp at time zone $4, ($3::date + 1)::timestamp at time zone $4)`,
      [d.employeeId, d.from, d.to, d.timezone]);
    const [r] = await q.query<{ id: string }>(
      `insert into leave_record(employee_id, span, kind, status)
       values ($1, tstzrange(($2::date)::timestamp at time zone $4, ($3::date + 1)::timestamp at time zone $4), $5, 'approved') returning id`,
      [d.employeeId, d.from, d.to, d.timezone, d.kind]);
    await audit(q, { actorId: ctx.actor.id, action: "record_leave", objectType: "leave_record", objectId: r!.id, after: d, correlationId: ctx.correlationId });
    // Existing bookings are flagged, never silently removed.
    return { id: r!.id, conflictingVisits: clash.map((c) => c.business_id) };
  });
}

export async function createCustomer(ctx: Ctx, input: unknown) {
  requireRole(ctx.actor, "manager", "customer creation");
  const d = parse(z.object({ name: z.string().trim().min(2).max(120), sourceSystem: z.string().max(40).optional(), sourceRef: z.string().max(60).optional() }), input);
  const bid = await nextBusinessId(ctx, "customer", "CUS");
  return ctx.db.tx(async (q) => {
    const exists = d.sourceSystem && d.sourceRef ? await q.query("select 1 from customer where source_system = $1 and source_ref = $2", [d.sourceSystem, d.sourceRef]) : [];
    if (exists.length) throw conflict("A customer with this source reference already exists.");
    const [c] = await q.query<{ id: string }>(`insert into customer(business_id, name, source_system, source_ref, created_by, updated_by) values ($1,$2,$3,$4,$5,$5) returning id`,
      [bid, d.name, d.sourceSystem ?? null, d.sourceRef ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "create", objectType: "customer", objectId: c!.id, after: d, correlationId: ctx.correlationId });
    return { id: c!.id, businessId: bid };
  });
}
