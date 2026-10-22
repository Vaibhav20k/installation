/**
 * Accounts / site / installation clearance, audited exceptions and readiness checks (phase 6).
 * Skill coverage alone never approves a site; exceptions apply only to configured gates.
 */
import { z } from "zod";
import { applianceBlockers } from "@/domain/site";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { forbidSelfApproval, requireCapability, requireProjectScope, requireRole } from "../auth/permissions";
import { forbidden, validation } from "../errors";
import { bumpVersion, getSetting, one, parse, zDate, zId, zVersion, type Ctx } from "./context";

export interface ClearancePolicy { firmBookingRequires: string[]; exceptionGates: string[]; holdBeforeClearance: "manager" | "supervisor" }
export const DEFAULT_CLEARANCE_POLICY: ClearancePolicy = { firmBookingRequires: ["accounts", "site", "installation"], exceptionGates: ["accounts"], holdBeforeClearance: "manager" };

export async function clearancePolicy(q: Queryable) {
  return getSetting<ClearancePolicy>(q, "clearance_policy", DEFAULT_CLEARANCE_POLICY);
}

/** Evaluates every required gate for a date. Expired or revoked approvals block; valid exceptions are reported. */
export async function clearanceGate(q: Queryable, visitId: string, onDate: string) {
  const policy = await clearancePolicy(q);
  const rows = await q.query<{ id: string; gate: string; status: string; valid_until: string | null }>(
    "select id, gate, status, valid_until::text from clearance where visit_id = $1", [visitId]);
  const blockers: string[] = [];
  const exceptions: string[] = [];
  for (const gate of policy.firmBookingRequires) {
    const c = rows.find((r) => r.gate === gate);
    const cleared = c && c.status === "cleared" && (!c.valid_until || c.valid_until >= onDate);
    if (cleared) continue;
    if (c && policy.exceptionGates.includes(gate)) {
      const [ex] = await q.query<{ id: string; conditions: string }>(
        "select id, conditions from clearance_exception where clearance_id = $1 and not revoked and valid_until >= $2 order by approved_at desc limit 1", [c.id, onDate]);
      if (ex) { exceptions.push(`${gate}: exception applies (${ex.conditions})`); continue; }
    }
    const state = !c ? "missing" : c.status === "cleared" ? `expired on ${c.valid_until}` : c.status;
    blockers.push(`${gate[0]!.toUpperCase()}${gate.slice(1)} clearance is ${state}`);
  }
  return { ok: blockers.length === 0, blockers, exceptions };
}

/** Required readiness checks must pass or be justified not-applicable before deployment. */
export async function readinessGate(q: Queryable, visitId: string, onDate: string) {
  const rows = await q.query<{ check_code: string; required: boolean; result: string; valid_until: string | null }>(
    "select check_code, required, result, valid_until::text from readiness_check where visit_id = $1", [visitId]);
  const blockers = rows
    .filter((r) => r.required && !(r.result === "na" || (r.result === "pass" && (!r.valid_until || r.valid_until >= onDate))))
    .map((r) => `Readiness: ${r.check_code.replace("_", " ")} is ${r.result === "pass" ? "expired" : r.result}`);
  // Appliances on this visit's orders (or project-wide): a selected-only appliance or unbooked brand technician blocks.
  const appliances = await q.query<{ appliance: string; state: string; brand_technician: string; exception_reason: string | null; depends_on: string | null }>(
    `select a.appliance, a.state, a.brand_technician, a.exception_reason, a.depends_on from appliance_dependency a join visit v on v.project_id = a.project_id
     where v.id = $1 and (a.order_item_id is null or a.order_item_id in (select oi.id from order_item oi join visit_order vo on vo.order_id = oi.order_id where vo.visit_id = $1))`, [visitId]);
  const ap = applianceBlockers(appliances.map((a) => ({ appliance: a.appliance, state: a.state, brandTechnician: a.brand_technician, exceptionReason: a.exception_reason, dependsOn: a.depends_on })));
  blockers.push(...ap.blockers.map((b) => `Appliance: ${b.message}`));
  return { ok: blockers.length === 0, blockers, risks: ap.risks.map((r) => `Appliance (exception recorded): ${r.message}`) };
}

export async function setClearance(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    visitId: zId, gate: z.enum(["accounts", "site", "installation"]), status: z.enum(["pending", "cleared", "rejected", "expired", "revoked"]),
    version: zVersion, expectedDate: zDate.nullable().optional(), validUntil: zDate.nullable().optional(), evidence: z.string().max(500).optional(),
  }), input);
  if (d.gate === "accounts") requireCapability(ctx.actor, "accounts_clearance", "Accounts clearance");
  else requireRole(ctx.actor, "manager", `${d.gate} clearance`);
  if (d.status === "cleared" && !d.evidence?.trim()) throw validation("Record the evidence for this clearance.", ["evidence: required"]);
  return ctx.db.tx(async (q) => {
    const c = await one<{ id: string; status: string; project_id: string }>(q,
      "select c.id, c.status, v.project_id from clearance c join visit v on v.id = c.visit_id where c.visit_id = $1 and c.gate = $2", [d.visitId, d.gate], "Clearance");
    await requireProjectScope(q, ctx.actor, c.project_id);
    await bumpVersion(q, "clearance", c.id, d.version);
    await q.query(
      `update clearance set status = $2, approver_id = $3, decided_at = case when $2 = 'pending' then null else now() end,
         expected_date = coalesce($4, expected_date), valid_until = $5, evidence = coalesce($6, evidence) where id = $1`,
      [c.id, d.status, ctx.actor.id, d.expectedDate ?? null, d.validUntil ?? null, d.evidence ?? null]);
    // Expired or revoked clearance flags existing bookings for review; reservations are not erased.
    const affected = ["expired", "revoked", "rejected"].includes(d.status)
      ? (await q.query<{ n: number }>("select count(*)::int n from reservation where visit_id = $1 and state in ('held','confirmed')", [d.visitId]))[0]!.n
      : 0;
    await audit(q, { actorId: ctx.actor.id, action: `clearance_${d.status}`, objectType: "clearance", objectId: c.id, before: { status: c.status }, after: d, correlationId: ctx.correlationId });
    return { bookingsFlaggedForReview: affected };
  });
}

export async function grantClearanceException(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ visitId: zId, gate: z.enum(["accounts", "site", "installation"]), reason: z.string().min(5).max(500), conditions: z.string().min(3).max(500), validUntil: zDate }), input);
  requireRole(ctx.actor, "manager", "clearance exceptions");
  return ctx.db.tx(async (q) => {
    const policy = await clearancePolicy(q);
    if (!policy.exceptionGates.includes(d.gate)) throw forbidden(`Exceptions are not configured for the ${d.gate} gate.`);
    if (d.gate === "accounts") requireCapability(ctx.actor, "accounts_clearance", "An accounts exception");
    const c = await one<{ id: string; project_id: string; plan_creator: string | null }>(q,
      `select c.id, v.project_id, pl.created_by plan_creator from clearance c join visit v on v.id = c.visit_id join plan pl on pl.id = v.plan_id
       where c.visit_id = $1 and c.gate = $2`, [d.visitId, d.gate], "Clearance");
    await requireProjectScope(q, ctx.actor, c.project_id);
    if (c.plan_creator) forbidSelfApproval(ctx.actor, c.plan_creator, "plan's clearance exception");
    const [e] = await q.query<{ id: string }>(
      "insert into clearance_exception(clearance_id, reason, conditions, approved_by, valid_until) values ($1,$2,$3,$4,$5) returning id",
      [c.id, d.reason, d.conditions, ctx.actor.id, d.validUntil]);
    await audit(q, { actorId: ctx.actor.id, action: "grant_exception", objectType: "clearance", objectId: c.id, after: d, reason: d.reason, correlationId: ctx.correlationId });
    return { id: e!.id };
  });
}

export async function revokeClearanceException(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ exceptionId: zId, reason: z.string().min(3).max(300) }), input);
  requireRole(ctx.actor, "manager", "revoking exceptions");
  return ctx.db.tx(async (q) => {
    const e = await one<{ clearance_id: string; project_id: string }>(q,
      "select x.clearance_id, v.project_id from clearance_exception x join clearance c on c.id = x.clearance_id join visit v on v.id = c.visit_id where x.id = $1", [d.exceptionId], "Exception");
    await requireProjectScope(q, ctx.actor, e.project_id);
    await q.query("update clearance_exception set revoked = true where id = $1", [d.exceptionId]);
    await audit(q, { actorId: ctx.actor.id, action: "revoke_exception", objectType: "clearance", objectId: e.clearance_id, reason: d.reason, correlationId: ctx.correlationId });
  });
}

export async function setReadinessCheck(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    visitId: zId, checkCode: z.enum(["site_access", "materials", "drawings", "tools", "customer_confirmation", "skill_coverage"]),
    result: z.enum(["pending", "pass", "fail", "na"]), required: z.boolean().optional(), naReason: z.string().max(300).optional(),
    evidence: z.string().max(500).optional(), validUntil: zDate.nullable().optional(),
  }), input);
  requireRole(ctx.actor, "supervisor", "readiness checks");
  if (d.result === "na" && !d.naReason?.trim()) throw validation("Justify why this check does not apply.", ["naReason: required"]);
  return ctx.db.tx(async (q) => {
    const v = await one<{ project_id: string }>(q, "select project_id from visit where id = $1", [d.visitId], "Visit");
    await requireProjectScope(q, ctx.actor, v.project_id);
    if (d.checkCode === "skill_coverage" && d.result === "pass") {
      // Skill coverage is verified from staffing, not by declaration.
      const { visitCoverage } = await import("./booking");
      const cov = await visitCoverage(q, d.visitId);
      if (!cov.met) throw validation("Skill coverage is not met by the current staffing.", cov.problems);
    }
    const rows = await q.query<{ id: string }>(
      `update readiness_check set result = $3, required = coalesce($4, required), na_reason = $5, evidence = $6, valid_until = $7, verifier_id = $8, checked_at = now()
       where visit_id = $1 and check_code = $2 and component_id is null returning id`,
      [d.visitId, d.checkCode, d.result, d.required ?? null, d.naReason ?? null, d.evidence ?? null, d.validUntil ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "readiness_check", objectType: "readiness_check", objectId: rows[0]?.id ?? d.visitId, after: d, correlationId: ctx.correlationId });
  });
}
