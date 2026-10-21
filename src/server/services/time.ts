/**
 * Time recording: actual entries, breaks, submission/review, amendments, overtime requests and
 * eligibility review (phases 7 and 8). Actual time is never reduced by an eligibility decision.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { forbidSelfApproval, requireEmployeeScope, requireProjectScope, requireRole } from "../auth/permissions";
import { conflict, forbidden, validation } from "../errors";
import { zonedToUtc, localDateOf, monthOf } from "@/lib/dates";
import { contains, subtract, durationMinutes, splitAtLocalMonths, type Interval } from "@/domain/intervals";
import { decideEligibility, scheduleIntervals, validateEntry, type CalendarDef, type EligibilityPolicy, type ExtraTimeReason } from "@/domain/time";
import { assertTimesheet, type TimesheetState } from "@/domain/lifecycle";
import { idempotent, iso, one, parse, zDate, zId, zTime, zVersion, type Ctx } from "./context";

const zLocal = z.object({ date: zDate, time: zTime });
const entryShape = z.object({
  employeeId: zId,
  projectId: zId.optional(), visitId: zId.optional(), taskId: zId.optional(), orderId: zId.optional(),
  overheadCategory: z.string().max(60).optional(),
  activity: z.enum(["installation", "additional", "rework", "travel", "waiting", "other"]),
  start: zLocal, end: zLocal,
  breaks: z.array(z.object({ start: zLocal, end: zLocal })).max(6).default([]),
  timezone: z.string().default("Asia/Kolkata"),
  note: z.string().max(500).optional(),
});

export async function employeeCalendar(q: Queryable, employeeId: string): Promise<CalendarDef> {
  const c = await one<{ id: string; timezone: string; week_pattern: CalendarDef["pattern"] }>(q,
    "select c.id, c.timezone, c.week_pattern from employee e join work_calendar c on c.id = e.calendar_id where e.id = $1", [employeeId], "Employee calendar");
  const holidays = (await q.query<{ date: string }>("select date::text from holiday where calendar_id = $1", [c.id])).map((h) => h.date);
  return { timezone: c.timezone, pattern: c.week_pattern, holidays };
}

function toUtc(d: z.infer<typeof entryShape>) {
  const at = (p: { date: string; time: string }) => zonedToUtc(p.date, p.time, d.timezone);
  return { start: at(d.start), end: at(d.end), breaks: d.breaks.map((b) => ({ start: at(b.start), end: at(b.end) })) };
}

/** Inside a transaction pass its handle: the embedded database serialises transactions, so using ctx.db there would deadlock. */
async function assertCanRecordFor(ctx: Ctx, employeeId: string, q: Queryable = ctx.db) {
  if (employeeId === ctx.actor.id) return;
  requireRole(ctx.actor, "supervisor", "recording time for another employee");
  await requireEmployeeScope(q, ctx.actor, employeeId);
}

async function insertEntry(q: Queryable, ctx: Ctx, d: z.infer<typeof entryShape>, extra: { supersedesId?: string; revisionNo?: number; firstSubmittedAt?: number | null } = {}) {
  const t = toUtc(d);
  const errors = validateEntry({ id: "new", activity: d.activity, ...t });
  if (errors.length) throw validation("This time entry is not valid.", errors);
  if (!d.projectId && !d.overheadCategory) throw validation("Link the entry to a project or choose an overhead category.");
  if (d.orderId) {
    const ok = await q.query("select 1 from sales_order where id = $1 and project_id = $2", [d.orderId, d.projectId ?? null]);
    if (!ok.length) throw validation("That order does not belong to the selected project.");
  }
  // Truthful capture: work outside any booking, or on a project outside the recorder's scope, is recorded
  // as a reviewed exception rather than refused or invented. Recording for someone else still needs scope.
  let isException = false;
  if (d.projectId) {
    let inScope = true;
    try { await requireProjectScope(q, ctx.actor, d.projectId); } catch { inScope = false; }
    if (!inScope && d.employeeId !== ctx.actor.id) throw forbidden("That project is outside your scope.");
    if (!inScope || !d.visitId) isException = true;
  }
  if (d.visitId) {
    const booked = await q.query("select 1 from reservation where visit_id = $1 and employee_id = $2 and state in ('confirmed','released') and span @> tstzrange($3::timestamptz,$4::timestamptz)", [d.visitId, d.employeeId, iso(t.start), iso(t.end)]);
    if (!booked.length) isException = true;
  }
  if (isException && !d.note?.trim()) throw validation("No booking covers this time. Add a note explaining the work; it will be reviewed as an exception.", ["note: required"]);
  const [e] = await q.query<{ id: string }>(
    `insert into time_entry(employee_id, project_id, visit_id, task_id, order_id, overhead_category, activity, span, state, revision_no, supersedes_id, is_exception, exception_note, note, first_submitted_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,tstzrange($8::timestamptz,$9::timestamptz),'draft',$10,$11,$12,$13,$14,$15,$16) returning id`,
    [d.employeeId, d.projectId ?? null, d.visitId ?? null, d.taskId ?? null, d.orderId ?? null, d.overheadCategory ?? null, d.activity, iso(t.start), iso(t.end),
      extra.revisionNo ?? 1, extra.supersedesId ?? null, isException, isException ? d.note ?? null : null, d.note ?? null, extra.firstSubmittedAt ? iso(extra.firstSubmittedAt) : null, ctx.actor.id]);
  for (const b of t.breaks) await q.query("insert into break_interval(time_entry_id, span) values ($1, tstzrange($2::timestamptz,$3::timestamptz))", [e!.id, iso(b.start), iso(b.end)]);
  return { id: e!.id, isException, netMinutes: durationMinutes(subtract([{ start: t.start, end: t.end }], t.breaks)) };
}

export async function createTimeEntry(ctx: Ctx, input: unknown) {
  const d = parse(entryShape.extend({ idempotencyKey: z.string().min(8).max(80).optional() }), input);
  await assertCanRecordFor(ctx, d.employeeId);
  return ctx.db.tx((q) => idempotent(q, ctx.actor.id, d.idempotencyKey, "createTimeEntry", async () => {
    const r = await insertEntry(q, ctx, d);
    await audit(q, { actorId: ctx.actor.id, action: "create", objectType: "time_entry", objectId: r.id, after: { ...d, idempotencyKey: undefined }, correlationId: ctx.correlationId });
    return r;
  }));
}

/** Drafts are edited in place; submitted, accepted or returned entries change only through a new revision. */
export async function updateDraftEntry(ctx: Ctx, input: unknown) {
  const d = parse(entryShape.extend({ entryId: zId, version: zVersion }), input);
  return ctx.db.tx(async (q) => {
    const e = await one<{ employee_id: string; state: string; version: number }>(q, "select employee_id, state, version from time_entry where id = $1 for update", [d.entryId], "Time entry");
    await assertCanRecordFor(ctx, e.employee_id, q);
    if (e.state !== "draft") throw conflict(`A ${e.state} entry is corrected with an amendment, which keeps its history.`);
    if (e.version !== d.version) throw conflict("Someone else changed this entry. Reload before saving.");
    await q.query("delete from break_interval where time_entry_id = $1", [d.entryId]);
    await q.query("update time_entry set is_current = false, state = 'voided' where id = $1", [d.entryId]);
    const r = await insertEntry(q, ctx, { ...d, employeeId: e.employee_id });
    await audit(q, { actorId: ctx.actor.id, action: "edit_draft", objectType: "time_entry", objectId: r.id, after: d, reason: `replaces draft ${d.entryId}`, correlationId: ctx.correlationId });
    return r;
  });
}

export async function submitTimeEntries(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ entryIds: z.array(zId).min(1).max(100) }), input);
  return ctx.db.tx(async (q) => {
    for (const id of d.entryIds) {
      const e = await one<{ employee_id: string; state: TimesheetState }>(q, "select employee_id, state from time_entry where id = $1 and is_current for update", [id], "Time entry");
      await assertCanRecordFor(ctx, e.employee_id, q);
      assertTimesheet(e.state, "submitted");
      await q.query("update time_entry set state = 'submitted', first_submitted_at = coalesce(first_submitted_at, $2), version = version + 1 where id = $1", [id, iso(ctx.now)]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "submit", objectType: "time_entry", objectId: d.entryIds.join(","), correlationId: ctx.correlationId });
    return { submitted: d.entryIds.length };
  });
}

export async function reviewTimeEntry(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ entryId: zId, decision: z.enum(["accepted", "returned"]), note: z.string().max(500).optional(), resolveException: z.boolean().optional() }), input);
  requireRole(ctx.actor, "supervisor", "reviewing time");
  if (d.decision === "returned" && !d.note?.trim()) throw validation("Say what needs correcting.", ["note: required"]);
  return ctx.db.tx(async (q) => {
    const e = await one<{ employee_id: string; state: TimesheetState; is_exception: boolean; created_by: string | null }>(q, "select employee_id, state, is_exception, created_by from time_entry where id = $1 and is_current for update", [d.entryId], "Time entry");
    forbidSelfApproval(ctx.actor, e.employee_id, "time");
    // Four eyes: whoever recorded an entry on someone's behalf cannot also accept it.
    if (e.created_by) forbidSelfApproval(ctx.actor, e.created_by, "recorded time entry");
    await requireEmployeeScope(q, ctx.actor, e.employee_id);
    assertTimesheet(e.state, d.decision);
    await q.query(
      "update time_entry set state = $2, reviewed_by = $3, reviewed_at = $4, review_note = $5, exception_resolved = exception_resolved or coalesce($6, false), version = version + 1 where id = $1",
      [d.entryId, d.decision, ctx.actor.id, iso(ctx.now), d.note ?? null, e.is_exception && d.decision === "accepted" ? d.resolveException ?? true : false]);
    await audit(q, { actorId: ctx.actor.id, action: `time_${d.decision}`, objectType: "time_entry", objectId: d.entryId, reason: d.note, correlationId: ctx.correlationId });
  });
}

/**
 * Corrects a submitted, accepted or returned entry with a new revision. The old revision stays as history
 * (not current) and any final reconciliation covering it is invalidated for review.
 */
export async function amendTimeEntry(ctx: Ctx, input: unknown) {
  const d = parse(entryShape.extend({ entryId: zId, reason: z.string().min(3).max(300) }), input);
  return ctx.db.tx(async (q) => {
    const e = await one<{ employee_id: string; state: string; revision_no: number; lo: number; hi: number; first_submitted_at: number | null }>(q,
      "select employee_id, state, revision_no, lower(span) lo, upper(span) hi, first_submitted_at from time_entry where id = $1 and is_current for update", [d.entryId], "Time entry");
    await assertCanRecordFor(ctx, e.employee_id, q);
    if (!["submitted", "accepted", "returned"].includes(e.state)) throw conflict("Drafts are edited directly.");
    await q.query("update time_entry set is_current = false where id = $1", [d.entryId]);
    const r = await insertEntry(q, ctx, { ...d, employeeId: e.employee_id }, { supersedesId: d.entryId, revisionNo: e.revision_no + 1, firstSubmittedAt: e.first_submitted_at });
    const invalidated = await invalidateMonths(q, ctx, e.employee_id, [{ start: e.lo, end: e.hi }, toUtc(d)], `Time entry amended: ${d.reason}`);
    await audit(q, { actorId: ctx.actor.id, action: "amend", objectType: "time_entry", objectId: r.id, before: { entry: d.entryId, state: e.state }, after: d, reason: d.reason, correlationId: ctx.correlationId });
    return { ...r, invalidatedMonths: invalidated };
  });
}

/** Marks final reconciliations for the affected employee-months invalid and deactivates their allocations. */
export async function invalidateMonths(q: Queryable, ctx: Ctx, employeeId: string, spans: Interval[], reason: string) {
  const months = new Set<string>();
  for (const s of spans) for (const m of splitAtLocalMonths(s, "Asia/Kolkata")) months.add(m.month);
  const out: string[] = [];
  for (const m of months) {
    const rows = await q.query<{ id: string }>("update month_reconciliation set state = 'invalidated', invalidated_reason = $3 where employee_id = $1 and month = $2::date and state = 'final' returning id", [employeeId, `${m}-01`, reason]);
    for (const r of rows) {
      await q.query("update reconciliation_allocation set active = false where reconciliation_id = $1", [r.id]);
      await audit(q, { actorId: ctx.actor.id, action: "invalidate", objectType: "month_reconciliation", objectId: r.id, reason, correlationId: ctx.correlationId });
      out.push(m);
    }
  }
  return out;
}

export async function requestOvertime(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ entryId: zId, start: zLocal, end: zLocal, timezone: z.string().default("Asia/Kolkata"), claimedReason: z.string().min(3).max(500) }), input);
  return ctx.db.tx(async (q) => {
    const e = await one<{ employee_id: string; state: string; lo: number; hi: number }>(q, "select employee_id, state, lower(span) lo, upper(span) hi from time_entry where id = $1 and is_current", [d.entryId], "Time entry");
    if (e.employee_id !== ctx.actor.id) { requireRole(ctx.actor, "supervisor", "requesting overtime for another employee"); await requireEmployeeScope(q, ctx.actor, e.employee_id); }
    if (e.state === "voided") throw conflict("This entry was replaced.");
    const span = { start: zonedToUtc(d.start.date, d.start.time, d.timezone), end: zonedToUtc(d.end.date, d.end.time, d.timezone) };
    if (!(span.end > span.start)) throw validation("Requested interval must end after it starts.");
    if (!contains({ start: e.lo, end: e.hi }, span)) throw validation("The requested interval must lie inside the recorded entry.");
    const [r] = await q.query<{ id: string }>(
      "insert into ot_request(employee_id, time_entry_id, span, claimed_reason, created_by) values ($1,$2,tstzrange($3::timestamptz,$4::timestamptz),$5,$6) returning id",
      [e.employee_id, d.entryId, iso(span.start), iso(span.end), d.claimedReason, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "request_overtime", objectType: "ot_request", objectId: r!.id, after: d, correlationId: ctx.correlationId });
    return { id: r!.id, minutes: durationMinutes(span) };
  });
}

export async function policyForMonth(q: Queryable, month: string) {
  const rows = await q.query<{
    id: string; business_id: string; status: "draft" | "approved"; illustrative: boolean; normal_basis: "calendar" | "fixed"; fixed_monthly_minutes: number | null;
    credited_activities: string[]; catch_up_threshold_credit: "unset" | "include" | "exclude"; candidate_rule: EligibilityPolicy["candidateRule"];
    external_delay_eligibility: EligibilityPolicy["externalDelayEligibility"]; other_documented_eligibility: EligibilityPolicy["otherDocumentedEligibility"];
    allocation_method: "unset" | "chronological" | "manager_selected"; leave_adjustment: "unset" | "subtract_scheduled_net"; settlement_timezone: string;
  }>(
    `select id, business_id, status, illustrative, normal_basis, fixed_monthly_minutes, credited_activities, catch_up_threshold_credit, candidate_rule,
       external_delay_eligibility, other_documented_eligibility, allocation_method, leave_adjustment, settlement_timezone
     from time_policy where effective_month <= $1::date and status in ('approved','draft')
     order by (status = 'approved') desc, effective_month desc, created_at desc limit 1`, [`${month}-01`]);
  return rows[0] ?? null;
}

/** Reviewer verifies the reason; the confirmed catch-up rule is applied by the domain function and cannot be overridden. */
export async function reviewEligibility(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    requestId: zId, verifiedReason: z.enum(["original_target_catch_up", "authorized_additional_scope", "external_delay", "other_documented"]),
    authorizationRef: zId.optional(), note: z.string().max(500).optional(),
  }), input);
  requireRole(ctx.actor, "supervisor", "eligibility review");
  return ctx.db.tx(async (q) => {
    const r = await one<{ employee_id: string; lo: number; hi: number; activity: string; visit_id: string | null; entry_state: string; is_current: boolean; created_by: string | null; decision: string }>(q,
      `select o.employee_id, lower(o.span) lo, upper(o.span) hi, e.activity, e.visit_id, e.state entry_state, e.is_current, o.created_by, o.decision
       from ot_request o join time_entry e on e.id = o.time_entry_id where o.id = $1 for update of o`, [d.requestId], "Overtime request");
    forbidSelfApproval(ctx.actor, r.employee_id, "overtime request");
    if (r.created_by) forbidSelfApproval(ctx.actor, r.created_by, "overtime request you raised");
    await requireEmployeeScope(q, ctx.actor, r.employee_id);
    if (!r.is_current) throw conflict("The underlying entry was amended; review the request on the current revision.");
    const cal = await employeeCalendar(q, r.employee_id);
    const span = { start: r.lo, end: r.hi };
    const sched = scheduleIntervals(cal, localDateOf(span.start - 86_400_000, cal.timezone), localDateOf(span.end + 86_400_000, cal.timezone));
    const outside = durationMinutes(subtract([span], sched)) === durationMinutes(span);
    let authorizationRef: string | null = null;
    if (d.verifiedReason === "authorized_additional_scope" && d.authorizationRef) {
      // Approval must be an additional-scope record on this visit dated on or before the work; extra output is not proof.
      const [auth] = await q.query<{ id: string }>("select id from visit_task where id = $1 and visit_id = $2 and kind = 'additional' and created_at <= $3", [d.authorizationRef, r.visit_id, iso(span.start)]);
      if (!auth) throw validation("That authorization is not an additional-scope approval on this visit dated before the work.");
      authorizationRef = auth.id;
    }
    const month = monthOf(localDateOf(span.start, cal.timezone));
    const p = await policyForMonth(q, month);
    const policy: EligibilityPolicy = p
      ? { candidateRule: p.candidate_rule, externalDelayEligibility: p.external_delay_eligibility, otherDocumentedEligibility: p.other_documented_eligibility }
      : { candidateRule: "outside_schedule_only", externalDelayEligibility: "unset", otherDocumentedEligibility: "unset" };
    let decision = decideEligibility({ verifiedReason: d.verifiedReason as ExtraTimeReason, activity: r.activity as never, outsideSchedule: outside, authorizationRef }, policy);
    // Only the confirmed rules (catch-up exclusion, non-work activity) apply without an approved policy.
    if (p?.status !== "approved" && decision.status === "eligible") {
      decision = { status: "pending_policy", code: "policy_not_approved", explanation: "No approved time policy covers this month yet; the verified reason is kept and eligibility is decided once a policy is approved." };
    }
    await q.query(
      `update ot_request set verified_reason = $2, authorization_ref = $3, decision = $4, decision_code = $5, decision_explanation = $6, reviewer_id = $7, reviewed_at = $8, policy_id = $9 where id = $1`,
      [d.requestId, d.verifiedReason, authorizationRef, decision.status, decision.code, decision.explanation, ctx.actor.id, iso(ctx.now), p?.id ?? null]);
    // A changed decision invalidates any final month that relied on the earlier one.
    const invalidated = ["eligible", "ineligible"].includes(r.decision) ? await invalidateMonths(q, ctx, r.employee_id, [span], "Overtime eligibility re-reviewed") : [];
    await audit(q, { actorId: ctx.actor.id, action: "review_eligibility", objectType: "ot_request", objectId: d.requestId, after: { ...d, decision, invalidated }, reason: d.note, correlationId: ctx.correlationId });
    if (r.entry_state !== "accepted") return { ...decision, note: "The entry is not accepted yet; it enters monthly totals only once accepted." };
    return decision;
  });
}

export async function markReviewedMissingDay(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ employeeId: zId, date: zDate, reason: z.enum(["no_work", "leave", "reviewed_missing"]), note: z.string().max(300).optional() }), input);
  requireRole(ctx.actor, "supervisor", "reviewing missing days");
  if (d.employeeId === ctx.actor.id) throw forbidden("You cannot review your own missing timesheet days.");
  await requireEmployeeScope(ctx.db, ctx.actor, d.employeeId);
  return ctx.db.tx(async (q) => {
    await q.query(`insert into reviewed_missing_day(employee_id, date, reason, note, reviewed_by) values ($1,$2,$3,$4,$5)
      on conflict (employee_id, date) do update set reason = excluded.reason, note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = now()`,
      [d.employeeId, d.date, d.reason, d.note ?? null, ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "review_missing_day", objectType: "employee", objectId: d.employeeId, after: d, correlationId: ctx.correlationId });
  });
}
