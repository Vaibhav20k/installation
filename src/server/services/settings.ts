/**
 * Policies, rates and metric definitions (phases 4 and 9). Activation and approval are protected
 * separately from ordinary data entry; approved versions are never edited in place.
 */
import { z } from "zod";
import { audit } from "../audit";
import { forbidSelfApproval, requireCapability, requireRole } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { computeMonth } from "@/domain/reconciliation";
import { zonedToUtc } from "@/lib/dates";
import { iso, one, parse, zDate, zId, zQty, type Ctx } from "./context";

const policyFields = z.object({
  name: z.string().min(3).max(120).optional(),
  normalBasis: z.enum(["calendar", "fixed"]).optional(),
  fixedMonthlyMinutes: z.number().int().positive().nullable().optional(),
  creditedActivities: z.array(z.enum(["installation", "additional", "rework", "travel", "waiting", "other"])).min(1).optional(),
  catchUpThresholdCredit: z.enum(["unset", "include", "exclude"]).optional(),
  candidateRule: z.enum(["outside_schedule_only", "authorized_any"]).optional(),
  externalDelayEligibility: z.enum(["unset", "eligible", "ineligible"]).optional(),
  otherDocumentedEligibility: z.enum(["unset", "eligible", "ineligible"]).optional(),
  allocationMethod: z.enum(["unset", "chronological", "manager_selected"]).optional(),
  leaveAdjustment: z.enum(["unset", "subtract_scheduled_net"]).optional(),
  settlementTimezone: z.string().optional(),
  effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const COLUMN: Record<string, string> = {
  name: "name", normalBasis: "normal_basis", fixedMonthlyMinutes: "fixed_monthly_minutes", creditedActivities: "credited_activities",
  catchUpThresholdCredit: "catch_up_threshold_credit", candidateRule: "candidate_rule", externalDelayEligibility: "external_delay_eligibility",
  otherDocumentedEligibility: "other_documented_eligibility", allocationMethod: "allocation_method", leaveAdjustment: "leave_adjustment", settlementTimezone: "settlement_timezone",
};

export async function updateDraftPolicy(ctx: Ctx, input: unknown) {
  const d = parse(policyFields.extend({ policyId: zId }), input);
  requireRole(ctx.actor, "admin", "editing time policies");
  if (d.settlementTimezone) { try { new Intl.DateTimeFormat("en", { timeZone: d.settlementTimezone }); } catch { throw validation("Unknown timezone"); } }
  return ctx.db.tx(async (q) => {
    const p = await one<{ status: string }>(q, "select status from time_policy where id = $1 for update", [d.policyId], "Policy");
    if (p.status !== "draft") throw conflict("Approved policy versions are not edited. Create a new draft version.");
    const sets: string[] = []; const vals: unknown[] = [d.policyId];
    for (const [k, col] of Object.entries(COLUMN)) {
      const v = (d as Record<string, unknown>)[k];
      if (v !== undefined) { vals.push(v); sets.push(`${col} = $${vals.length}`); }
    }
    if (d.effectiveMonth) { vals.push(`${d.effectiveMonth}-01`); sets.push(`effective_month = $${vals.length}::date`); }
    if (sets.length) await q.query(`update time_policy set ${sets.join(", ")} where id = $1`, vals);
    await audit(q, { actorId: ctx.actor.id, action: "edit_policy", objectType: "time_policy", objectId: d.policyId, after: d, correlationId: ctx.correlationId });
  });
}

export async function createPolicyVersion(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ fromPolicyId: zId, effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/) }), input);
  requireRole(ctx.actor, "admin", "creating policy versions");
  return ctx.db.tx(async (q) => {
    const [n] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from time_policy`);
    const bid = `POL-${String(n!.n).padStart(3, "0")}`;
    const [r] = await q.query<{ id: string }>(
      `insert into time_policy(business_id, name, status, illustrative, effective_month, normal_basis, fixed_monthly_minutes, credited_activities, catch_up_threshold_credit,
         candidate_rule, external_delay_eligibility, other_documented_eligibility, allocation_method, leave_adjustment, settlement_timezone, created_by)
       select $2, name, 'draft', illustrative, $3::date, normal_basis, fixed_monthly_minutes, credited_activities, catch_up_threshold_credit,
         candidate_rule, external_delay_eligibility, other_documented_eligibility, allocation_method, leave_adjustment, settlement_timezone, $4
       from time_policy where id = $1 returning id`, [d.fromPolicyId, bid, `${d.effectiveMonth}-01`, ctx.actor.id]);
    if (!r) throw validation("Source policy not found");
    await audit(q, { actorId: ctx.actor.id, action: "create_policy_version", objectType: "time_policy", objectId: r.id, after: d, correlationId: ctx.correlationId });
    return { id: r.id, businessId: bid };
  });
}

/** Lists the policy fields still unresolved; an approved policy can still leave a field unset, which keeps months provisional. */
export function unresolvedPolicyFields(p: Record<string, unknown>) {
  const out: string[] = [];
  if (p.catch_up_threshold_credit === "unset") out.push("Whether catch-up hours earn monthly threshold credit");
  if (p.allocation_method === "unset") out.push("Which eligible intervals consume the monthly cap (allocation method)");
  if (p.leave_adjustment === "unset") out.push("How leave adjusts the normal monthly requirement");
  if (p.external_delay_eligibility === "unset") out.push("Eligibility of extra time caused by external delays");
  if (p.other_documented_eligibility === "unset") out.push("Eligibility of other documented causes");
  if (p.normal_basis === "fixed" && !p.fixed_monthly_minutes) out.push("Fixed monthly minutes");
  return out;
}

export async function approvePolicy(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ policyId: zId, acknowledgeIllustrative: z.boolean() }), input);
  requireCapability(ctx.actor, "policy_activate", "Policy activation");
  return ctx.db.tx(async (q) => {
    const p = await one<{ status: string; illustrative: boolean; effective_month: string; created_by: string | null }>(q, "select status, illustrative, effective_month::text, created_by from time_policy where id = $1 for update", [d.policyId], "Policy");
    if (p.status !== "draft") throw conflict(`This policy is already ${p.status}.`);
    if (p.created_by) forbidSelfApproval(ctx.actor, p.created_by, "policy version");
    if (p.illustrative && !d.acknowledgeIllustrative) throw validation("This policy contains illustrative values. Confirm you are activating it for demo use only.");
    await q.query("update time_policy set status = 'superseded' where status = 'approved' and effective_month = $1::date", [p.effective_month]);
    await q.query("update time_policy set status = 'approved', approved_by = $2, approved_at = $3 where id = $1", [d.policyId, ctx.actor.id, iso(ctx.now)]);
    await audit(q, { actorId: ctx.actor.id, action: "approve_policy", objectType: "time_policy", objectId: d.policyId, after: d, correlationId: ctx.correlationId });
  });
}

/** Runs the policy against the master prompt's illustrative cases so reviewers can see its effect before approval. */
export async function previewPolicy(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ policyId: zId }), input);
  const p = await one<Record<string, unknown>>(ctx.db, "select * from time_policy where id = $1", [d.policyId], "Policy");
  const tz = String(p.settlement_timezone);
  const cal = { timezone: tz, holidays: [], pattern: { 1: { shifts: [{ start: "10:00", end: "19:00" }], netMinutes: 480 } } };
  const mk = (minutes: number) => {
    const out = []; let left = minutes; let day = 2;
    while (left > 0) { const len = Math.min(600, left); const s = zonedToUtc(`2026-11-${String(day).padStart(2, "0")}`, "08:00", tz); out.push({ id: `S${day}`, projectId: "P", activity: "installation" as const, start: s, end: s + len * 60000, breaks: [], catchUp: [] }); left -= len; day++; }
    return out;
  };
  const policy = {
    id: String(p.business_id), status: p.status === "approved" ? "approved" as const : "draft" as const, illustrative: Boolean(p.illustrative),
    normalBasis: p.normal_basis as "calendar" | "fixed", fixedMonthlyMinutes: p.fixed_monthly_minutes as number | null, creditedActivities: p.credited_activities as never,
    catchUpThresholdCredit: p.catch_up_threshold_credit as never, allocationMethod: p.allocation_method as never, leaveAdjustment: p.leave_adjustment as never, settlementTimezone: tz,
  };
  const cases = [
    { name: "Q below N (scenario 14)", q: 11400, e: 1200 },
    { name: "Q above N (scenario 15)", q: 12600, e: 900 },
  ].map((c) => {
    const entries = mk(c.q);
    const cands = [{ requestId: "R1", entryId: entries[0]!.id, projectId: "P", start: entries[0]!.end - Math.min(600, c.e) * 60000, end: entries[0]!.end, decision: "eligible" as const }];
    if (c.e > 600) cands.push({ requestId: "R2", entryId: entries[1]!.id, projectId: "P", start: entries[1]!.end - (c.e - 600) * 60000, end: entries[1]!.end, decision: "eligible" as const });
    const r = computeMonth({ employeeId: "sample", month: "2026-11", policy, calendar: cal, acceptedEntries: entries, otCandidates: cands, leaveDates: [], asOf: Date.parse("2026-12-05T00:00:00Z"), completeness: { expectedDays: 0, acceptedDays: 0, reviewedMissingDays: 0 }, unresolvedExceptions: 0 });
    return { name: c.name, N: r.N, Q: r.Q, E: r.E, X: r.X, cap: r.cap, approvedOT: r.approvedOT, blockers: r.blockers };
  });
  return { unresolved: unresolvedPolicyFields(p), cases };
}

/** Rate approval creates a new approved version; illustrative rates are never relabelled in place. */
export async function approveRateVersion(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ rateId: zId, value: zQty, crewSize: z.number().int().positive().nullable().optional(), netDayMinutes: z.number().int().positive().nullable().optional(), effectiveFrom: zDate, evidence: z.string().min(5).max(500) }), input);
  requireCapability(ctx.actor, "rate_approve", "Productivity-rate approval");
  return ctx.db.tx(async (q) => {
    const r = await one<{ business_id: string }>(q, "select business_id from productivity_rate where id = $1", [d.rateId], "Rate");
    const [v] = await q.query<{ n: number }>("select max(version)+1 n from productivity_rate where business_id = $1", [r.business_id]);
    const [row] = await q.query<{ id: string }>(
      `insert into productivity_rate(business_id, version, activity, quantity_kind, unit, basis, value, crew_size, net_day_minutes, required_roles, status, approved_by, approved_at, effective_from)
       select business_id, $2, activity, quantity_kind, unit, basis, $3, coalesce($4, crew_size), coalesce($5, net_day_minutes), required_roles, 'approved', $6, $7, $8 from productivity_rate where id = $1 returning id`,
      [d.rateId, v!.n, d.value, d.crewSize ?? null, d.netDayMinutes ?? null, ctx.actor.id, iso(ctx.now), d.effectiveFrom]);
    await audit(q, { actorId: ctx.actor.id, action: "approve_rate", objectType: "productivity_rate", objectId: row!.id, after: d, reason: d.evidence, correlationId: ctx.correlationId });
    return { id: row!.id, version: v!.n };
  });
}

export async function approveKpiTarget(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ targetId: zId, targetValue: zQty, baselineValue: zQty.optional(), evidence: z.string().min(5).max(500) }), input);
  requireCapability(ctx.actor, "target_approve", "KPI target approval");
  return ctx.db.tx(async (q) => {
    await one(q, "select 1 from kpi_target where id = $1", [d.targetId], "Target");
    await q.query("update kpi_target set status = 'approved', target_value = $2, baseline_value = $3, approved_by = $4, approved_at = $5 where id = $1", [d.targetId, d.targetValue, d.baselineValue ?? null, ctx.actor.id, iso(ctx.now)]);
    await audit(q, { actorId: ctx.actor.id, action: "approve_target", objectType: "kpi_target", objectId: d.targetId, after: d, reason: d.evidence, correlationId: ctx.correlationId });
  });
}

export async function approveMetricDefinition(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ code: z.string(), formula: z.string().min(10).max(500), grain: z.string().min(2).max(80), windowText: z.string().min(2).max(80), cohort: z.string().min(2).max(120) }), input);
  requireCapability(ctx.actor, "kra_review", "Metric definition approval");
  return ctx.db.tx(async (q) => {
    const cur = await one<{ version: number; name: string; unit: string; direction: string }>(q, "select version, name, unit, direction from kpi_definition where code = $1 order by version desc limit 1", [d.code], "Metric");
    const [r] = await q.query<{ id: string }>(
      `insert into kpi_definition(code, version, name, formula, grain, unit, direction, window_text, cohort, status, approved_by, approved_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',$10,$11) returning id`,
      [d.code, cur.version + 1, cur.name, d.formula, d.grain, cur.unit, cur.direction, d.windowText, d.cohort, ctx.actor.id, iso(ctx.now)]);
    await audit(q, { actorId: ctx.actor.id, action: "approve_metric", objectType: "kpi_definition", objectId: r!.id, after: d, correlationId: ctx.correlationId });
    return { id: r!.id, version: cur.version + 1 };
  });
}
