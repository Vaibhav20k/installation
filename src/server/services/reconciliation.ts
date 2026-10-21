/**
 * Monthly reconciliation: reconcileMonth (provisional), finalizeMonth and reopenMonth (phase 8).
 * Internal approval tracking only; no wage or payroll calculation.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { forbidSelfApproval, requireEmployeeScope, requireRole } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { computeMonth, type ReconEntry, type ReconPolicy, type OtCandidate } from "@/domain/reconciliation";
import { localMonthInterval, intersect } from "@/domain/intervals";
import { addDays, datesBetween, localDateOf, monthBounds, weekday } from "@/lib/dates";
import type { Activity } from "@/domain/time";
import { employeeCalendar, policyForMonth } from "./time";
import { iso, parse, zId, type Ctx } from "./context";

const zMonth = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM");

export async function gatherMonth(q: Queryable, employeeId: string, month: string, now: number, managerSelection?: string[]) {
  const p = await policyForMonth(q, month);
  const cal = await employeeCalendar(q, employeeId);
  const tz = p?.settlement_timezone ?? cal.timezone;
  const monthIv = localMonthInterval(month, tz);
  const range = [iso(monthIv.start), iso(monthIv.end)];

  const entries = await q.query<{ id: string; project_id: string | null; activity: Activity; lo: number; hi: number }>(
    `select id, project_id, activity, lower(span) lo, upper(span) hi from time_entry
     where employee_id = $1 and is_current and state = 'accepted' and span && tstzrange($2::timestamptz,$3::timestamptz) order by lower(span), id`, [employeeId, ...range]);
  const ids = entries.map((e) => e.id);
  const breaks = ids.length ? await q.query<{ time_entry_id: string; lo: number; hi: number }>("select time_entry_id, lower(span) lo, upper(span) hi from break_interval where time_entry_id = any($1::uuid[])", [ids]) : [];
  const requests = ids.length ? await q.query<{ id: string; time_entry_id: string; lo: number; hi: number; decision: OtCandidate["decision"]; verified_reason: string | null }>(
    "select id, time_entry_id, lower(span) lo, upper(span) hi, decision, verified_reason from ot_request where time_entry_id = any($1::uuid[]) order by lower(span), id", [ids]) : [];

  const acceptedEntries: ReconEntry[] = entries.map((e) => ({
    id: e.id, projectId: e.project_id, activity: e.activity, start: e.lo, end: e.hi,
    breaks: breaks.filter((b) => b.time_entry_id === e.id).map((b) => ({ start: b.lo, end: b.hi })),
    catchUp: requests.filter((r) => r.time_entry_id === e.id && r.verified_reason === "original_target_catch_up").map((r) => ({ start: r.lo, end: r.hi })),
  }));
  const otCandidates: OtCandidate[] = requests.map((r) => ({
    requestId: r.id, entryId: r.time_entry_id, projectId: entries.find((e) => e.id === r.time_entry_id)!.project_id, start: r.lo, end: r.hi, decision: r.decision,
  }));

  const { first, last } = monthBounds(month);
  const leaveRows = await q.query<{ lo: number; hi: number }>("select lower(span) lo, upper(span) hi from leave_record where employee_id = $1 and status = 'approved' and span && tstzrange($2::timestamptz,$3::timestamptz)", [employeeId, ...range]);
  const leaveDates = [...new Set(leaveRows.flatMap((l) => intersect([{ start: l.lo, end: l.hi }], [monthIv]))
    .flatMap((iv) => datesBetween(localDateOf(iv.start, tz), localDateOf(iv.end - 1, tz))))];

  // Reporting obligation grain: one accepted timesheet per assigned working date (confirmed bookings), excluding leave.
  const booked = await q.query<{ lo: number; hi: number }>(
    `select lower(r.span) lo, upper(r.span) hi from reservation r join visit v on v.id = r.visit_id
     where r.employee_id = $1 and r.state in ('confirmed','released') and v.exec_status <> 'cancelled' and r.span && tstzrange($2::timestamptz,$3::timestamptz)`, [employeeId, ...range]);
  const working = (dt: string) => !!cal.pattern[weekday(dt)] && !cal.holidays.includes(dt);
  const expected = new Set<string>();
  for (const b of booked) for (const iv of intersect([{ start: b.lo, end: b.hi }], [monthIv])) {
    for (const dt of datesBetween(localDateOf(iv.start, tz), localDateOf(iv.end - 1, tz))) if (working(dt) && !leaveDates.includes(dt) && dt >= first && dt <= last) expected.add(dt);
  }
  const acceptedDates = new Set(entries.map((e) => localDateOf(e.lo, tz)));
  const reviewed = new Set((await q.query<{ date: string }>("select date::text from reviewed_missing_day where employee_id = $1 and date between $2 and $3", [employeeId, first, last])).map((r) => r.date));
  const exp = [...expected];
  const completeness = {
    expectedDays: exp.length,
    acceptedDays: exp.filter((dt) => acceptedDates.has(dt)).length,
    reviewedMissingDays: exp.filter((dt) => !acceptedDates.has(dt) && reviewed.has(dt)).length,
  };
  const [exc] = await q.query<{ n: number }>(
    "select count(*)::int n from time_entry where employee_id = $1 and is_current and state <> 'voided' and is_exception and not exception_resolved and span && tstzrange($2::timestamptz,$3::timestamptz)", [employeeId, ...range]);

  const policy: ReconPolicy | null = p && {
    id: p.business_id, status: p.status, illustrative: p.illustrative, normalBasis: p.normal_basis, fixedMonthlyMinutes: p.fixed_monthly_minutes,
    creditedActivities: p.credited_activities as Activity[], catchUpThresholdCredit: p.catch_up_threshold_credit, allocationMethod: p.allocation_method,
    leaveAdjustment: p.leave_adjustment, settlementTimezone: p.settlement_timezone,
  };
  const result = computeMonth({
    employeeId, month, policy, calendar: cal, acceptedEntries, otCandidates, managerSelection, leaveDates, asOf: now, completeness, unresolvedExceptions: exc!.n,
  });
  return { result, policyRowId: p?.id ?? null, sourceEntryIds: ids, missingDates: exp.filter((dt) => !acceptedDates.has(dt) && !reviewed.has(dt)).sort(), nextMonthStart: addDays(last, 1) };
}

async function storeRevision(q: Queryable, employeeId: string, month: string, state: "provisional" | "final", g: Awaited<ReturnType<typeof gatherMonth>>, actorId: string | null) {
  const [n] = await q.query<{ n: number }>("select coalesce(max(revision),0)+1 n from month_reconciliation where employee_id = $1 and month = $2::date", [employeeId, `${month}-01`]);
  const [r] = await q.query<{ id: string }>(
    `insert into month_reconciliation(employee_id, month, revision, policy_id, state, totals, source_entry_ids, calc_version, blockers, finalized_by, finalized_at)
     values ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [employeeId, `${month}-01`, n!.n, g.policyRowId, state, JSON.stringify(g.result), g.sourceEntryIds, g.result.calcVersion, JSON.stringify(g.result.blockers),
      state === "final" ? actorId : null, state === "final" ? new Date().toISOString() : null]);
  return { id: r!.id, revision: n!.n };
}

export async function reconcileMonth(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ employeeId: zId, month: zMonth, managerSelection: z.array(zId).optional() }), input);
  await requireEmployeeScope(ctx.db, ctx.actor, d.employeeId);
  return ctx.db.tx(async (q) => {
    const g = await gatherMonth(q, d.employeeId, d.month, ctx.now, d.managerSelection);
    const stored = await storeRevision(q, d.employeeId, d.month, "provisional", g, ctx.actor.id);
    return { ...g.result, reconciliationId: stored.id, revision: stored.revision, state: "provisional" as const, missingDates: g.missingDates };
  });
}

export async function finalizeMonth(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ employeeId: zId, month: zMonth, managerSelection: z.array(zId).optional() }), input);
  requireRole(ctx.actor, "manager", "finalizing monthly reconciliation");
  forbidSelfApproval(ctx.actor, d.employeeId, "monthly reconciliation");
  return ctx.db.tx(async (q) => {
    await requireEmployeeScope(q, ctx.actor, d.employeeId);
    const existing = await q.query("select 1 from month_reconciliation where employee_id = $1 and month = $2::date and state = 'final'", [d.employeeId, `${d.month}-01`]);
    if (existing.length) throw conflict("This month is already final. Reopen it with a reason to change it.");
    const g = await gatherMonth(q, d.employeeId, d.month, ctx.now, d.managerSelection);
    if (!g.result.canFinalize) throw conflict("This month cannot be finalized yet.", g.result.blockers);
    if (g.result.approvedOT > (g.result.cap ?? 0) || g.result.approvedOT > g.result.E) throw validation("Allocation exceeds the eligible minutes or cap.");
    const stored = await storeRevision(q, d.employeeId, d.month, "final", g, ctx.actor.id);
    for (const a of g.result.allocations) {
      // The exclusion constraint guarantees no minute is allocated twice, even under concurrent approvals.
      await q.query(
        `insert into reconciliation_allocation(reconciliation_id, employee_id, ot_request_id, time_entry_id, project_id, span, minutes) values ($1,$2,$3,$4,$5,tstzrange($6::timestamptz,$7::timestamptz),$8)`,
        [stored.id, d.employeeId, a.requestId, a.entryId, a.projectId, iso(a.start), iso(a.end), a.minutes]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "finalize", objectType: "month_reconciliation", objectId: stored.id, after: { month: d.month, approvedOT: g.result.approvedOT, cap: g.result.cap }, correlationId: ctx.correlationId });
    return { ...g.result, reconciliationId: stored.id, revision: stored.revision, state: "final" as const };
  });
}

/** reopenApprovedRecord for a month: the final row is invalidated (kept), allocations deactivated, with a reason. */
export async function reopenMonth(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ employeeId: zId, month: zMonth, reason: z.string().min(5).max(500) }), input);
  requireRole(ctx.actor, "manager", "reopening a finalized month");
  return ctx.db.tx(async (q) => {
    await requireEmployeeScope(q, ctx.actor, d.employeeId);
    const rows = await q.query<{ id: string }>("update month_reconciliation set state = 'invalidated', invalidated_reason = $3 where employee_id = $1 and month = $2::date and state = 'final' returning id", [d.employeeId, `${d.month}-01`, d.reason]);
    if (!rows.length) throw conflict("There is no final reconciliation to reopen.");
    await q.query("update reconciliation_allocation set active = false where reconciliation_id = $1", [rows[0]!.id]);
    await audit(q, { actorId: ctx.actor.id, action: "reopen", objectType: "month_reconciliation", objectId: rows[0]!.id, reason: d.reason, correlationId: ctx.correlationId });
  });
}
