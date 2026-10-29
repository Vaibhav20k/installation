/**
 * Dispatch setup (administrators): who holds each department role, and the stage definitions. A saved
 * definition becomes a new active version; records already in flight finish on the version they started with,
 * so an edit never strands a dispatch on a stage that no longer exists.
 */
import { z } from "zod";
import { audit } from "../audit";
import { requireAdmin } from "../auth/permissions";
import { validation } from "../errors";
import { one, parse, zId, type Ctx } from "./context";
import { loadDefinition, validateDefinition } from "./flow-core";

export async function setRoleMember(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ roleCode: z.string().max(40), employeeId: zId, member: z.boolean() }), input);
  requireAdmin(ctx.actor, "department roles");
  return ctx.db.tx(async (q) => {
    await one(q, "select code from flow_role where code = $1", [d.roleCode], "Role");
    const e = await one<{ active: boolean; name: string }>(q, "select active, name from employee where id = $1", [d.employeeId], "Employee");
    if (d.member && !e.active) throw validation(`${e.name} is inactive.`);
    if (d.member) await q.query("insert into flow_role_member(role_code, employee_id, added_by) values ($1,$2,$3) on conflict do nothing", [d.roleCode, d.employeeId, ctx.actor.id]);
    else await q.query("delete from flow_role_member where role_code = $1 and employee_id = $2", [d.roleCode, d.employeeId]);
    await audit(q, { actorId: ctx.actor.id, action: d.member ? "add_flow_role" : "remove_flow_role", objectType: "employee", objectId: d.employeeId, after: { role: d.roleCode }, correlationId: ctx.correlationId });
    return { ok: true };
  });
}

export async function saveFlowDefinition(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ flow: z.enum(["dispatch", "complaint"]), definition: z.string().max(60_000), note: z.string().trim().min(3).max(200) }), input);
  requireAdmin(ctx.actor, "dispatch setup");
  let raw: unknown;
  try { raw = JSON.parse(d.definition); } catch (e) { throw validation("The definition is not valid JSON.", [(e as Error).message]); }
  return ctx.db.tx(async (q) => {
    const def = await validateDefinition(q, raw);
    if (def.flow !== d.flow) throw validation(`This definition is for the ${def.flow} flow.`);
    const cur = await loadDefinition(q, d.flow);
    if (JSON.stringify(cur.def) === JSON.stringify(def)) throw validation("Nothing changed.");
    await q.query("lock table flow_config in exclusive mode");
    const [n] = await q.query<{ v: number }>("select coalesce(max(version), 0) + 1 v from flow_config where flow = $1", [d.flow]);
    await q.query("update flow_config set active = false where flow = $1 and active", [d.flow]);
    await q.query("insert into flow_config(flow, version, definition, active, note, created_by) values ($1,$2,$3,true,$4,$5)", [d.flow, n!.v, JSON.stringify(def), d.note, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "save_flow_definition", objectType: "flow_config", objectId: `${d.flow}:${n!.v}`, before: { version: cur.version }, after: { version: n!.v, stages: def.stages.map((s) => s.code) }, reason: d.note, correlationId: ctx.correlationId });
    return { version: n!.v };
  });
}
