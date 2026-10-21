import { notFound } from "next/navigation";
import { session } from "@/server/session";
import { visitDetail } from "@/server/queries/planning";
import { skillsCatalog, staffingCandidates } from "@/server/queries/people";
import { AppError } from "@/server/errors";
import { deriveScheduleStart } from "@/domain/scheduling";
import { localDateOf } from "@/lib/dates";
import { Badge } from "@/components/ui/Badge";
import { Notice, PageHeader } from "@/components/ui/Notice";
import { ScopeStep } from "@/components/visit/ScopeStep";
import { DatesStep } from "@/components/visit/DatesStep";
import { SkillsStep } from "@/components/visit/SkillsStep";
import { ClearanceStep } from "@/components/visit/ClearanceStep";
import { TeamStep } from "@/components/visit/TeamStep";
import { ExpensesStep } from "@/components/visit/ExpensesStep";
import { ReviewStep } from "@/components/visit/ReviewStep";
import { ExecutionStep } from "@/components/visit/ExecutionStep";
import { EstimateStep } from "@/components/visit/EstimateStep";
import { TravelPanel } from "@/components/visit/TravelPanel";
import { ComparePanel } from "@/components/visit/ComparePanel";

export const metadata = { title: "Visit" };

const STEPS = [
  { id: "scope", label: "Scope" }, { id: "estimate", label: "Estimate effort" }, { id: "dates", label: "Dates & travel" }, { id: "skills", label: "Skills" },
  { id: "clearance", label: "Clearances & readiness" }, { id: "team", label: "Team options" }, { id: "expenses", label: "Expenses" }, { id: "review", label: "Review & submit" },
  { id: "execution", label: "Daily execution" },
] as const;

export default async function VisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, actor } = await session();
  const now = Date.now();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d;
  try { d = await visitDetail(db, actor, id, now); } catch (e) {
    if (e instanceof AppError) return <Notice tone={e.kind === "forbidden" ? "warn" : "bad"} title={e.kind === "forbidden" ? "Not permitted" : "Not found"}>{e.message}</Notice>;
    throw e;
  }
  const v = d.visit;
  const latest = d.revisions[0]!;
  const started = ["in_progress", "completed", "closed"].includes(v.exec_status);
  const step = (STEPS.find((s) => s.id === sp.step)?.id) ?? (started ? "execution" : "scope");
  const editable = latest.approval_state !== "submitted" && d.context.plan_status === "active";
  const skills = await skillsCatalog(db);
  const candidates = step === "team" && actor.role !== "employee" ? (await staffingCandidates(db)).map((e) => ({
    id: e.id, business_id: e.business_id, name: e.name, job_role: e.job_role,
    skills: e.skills.map((k) => `${k.verified ? "✓" : "?"}${k.code} ${["", "L", "M", "H"][k.level]}`).join(", "),
  })) : [];
  const estimates = await db.query<{ id: string; version: number; total: number; lines: Array<{ category: string; basis: string; factors: Record<string, number>; unit_rate_minor: number; amount_minor: number; scope: string | null }> }>(
    `select e.id, e.version, (select coalesce(sum(amount_minor),0)::bigint from estimate_line where estimate_id = e.id) total,
       (select json_agg(json_build_object('category', category, 'basis', basis, 'factors', factors, 'unit_rate_minor', unit_rate_minor, 'amount_minor', amount_minor, 'scope', scope)) from estimate_line where estimate_id = e.id) lines
     from estimate e where e.visit_id = $1 order by e.version desc`, [id]);
  // Schedule-start drivers come from recorded evidence only; nothing is invented when a date is missing.
  const passedOn = (code: string) => { const r = d.readiness.find((x) => x.check_code === code); return r?.result === "pass" && r.checked_at ? localDateOf(r.checked_at, v.timezone) : null; };
  const clearedOn = d.gate.ok ? d.clearances.map((c) => (c.decided_at ? localDateOf(c.decided_at, v.timezone) : null)).filter((x): x is string => !!x).sort().at(-1) ?? null : null;
  const start = deriveScheduleStart({
    requestedInstallationStart: d.context.requested_start,
    materialAvailable: passedOn("materials"),
    siteAccessDate: passedOn("site_access"),
    clearanceDate: clearedOn,
    expectedClearanceDate: d.clearances.map((c) => c.expected_date).filter((x): x is string => !!x).sort().at(-1) ?? null,
    workingWeekdays: [1, 2, 3, 4, 5, 6], mode: "draft",
  });
  return (
    <>
      <PageHeader
        title={`${v.business_id} · ${v.visit_type.replace("_", "-")} visit`}
        subtitle={<>{d.context.project} ({d.context.project_bid}) · {d.context.customer} · Plan {d.context.plan_bid} revision {latest.revision_no}{" "}
          <Badge state={latest.approval_state} /> <Badge state={v.exec_status} />{v.repeat_reason && <> · Reason: {v.repeat_reason.replace(/_/g, " ")}</>}</>}
        actions={<a className="button" href={`/api/plan-export/${id}`}>Client plan (CSV)</a>}
      />
      <nav aria-label="Plan wizard steps"><ol className="steps">
        {STEPS.map((s) => <li key={s.id}><a href={`?step=${s.id}`} aria-current={s.id === step ? "step" : undefined}>{s.label}</a></li>)}
      </ol></nav>
      {latest.approval_state === "submitted" && <Notice tone="info">Revision {latest.revision_no} is awaiting review. Editing resumes after the decision (a returned plan becomes editable through a new draft revision).</Notice>}
      {latest.approval_state === "approved" && !started && step !== "review" && step !== "team" && step !== "clearance" && <Notice tone="info">Revision {latest.revision_no} is approved. Any change starts a new revision with a reason and needs reapproval; the approved baseline stays unchanged.</Notice>}
      {step === "scope" && <ScopeStep visitId={id} scope={d.scope} tasks={d.availableTasks} orders={d.orders} editable={editable} needsReason={latest.approval_state !== "draft"} />}
      {step === "estimate" && <EstimateStep estimate={d.estimate} />}
      {step === "dates" && <DatesStep visit={{ id, version: v.version, planned_start: v.planned_start, planned_end: v.planned_end, departure_at: v.departure_at, return_at: v.return_at, team_size: v.team_size, continuity: v.continuity, exec_status: v.exec_status, outstation: v.outstation, timezone: v.timezone }}
        requested={{ date: d.context.requested_start, meaning: d.context.requested_start_meaning }} start={start} hasLiveStaff={d.staffing.some((s) => s.state !== "proposed")} needsReason={latest.approval_state !== "draft"} />}
      {step === "dates" && <TravelPanel visitId={id} legs={d.travel} timezone={v.timezone} needsReason={latest.approval_state !== "draft"} />}
      {step === "skills" && <SkillsStep visitId={id} skills={skills} requirements={d.requirements} needsReason={latest.approval_state !== "draft"} editable={editable} />}
      {step === "clearance" && <ClearanceStep visitId={id} clearances={d.clearances} exceptions={d.exceptions} readiness={d.readiness} gate={d.gate} readinessGate={d.readinessGate} />}
      {step === "team" && <TeamStep visitId={id} staffing={d.staffing} coverage={d.coverage} approval={latest.approval_state} execStatus={v.exec_status} gate={d.gate} needsReason={latest.approval_state !== "draft"} role={actor.role} candidates={candidates} />}
      {step === "expenses" && <ExpensesStep visitId={id} projectId={v.project_id} staffCount={d.staffing.length} plannedStart={v.planned_start} plannedEnd={v.planned_end} departure={v.departure_at} returnAt={v.return_at} estimates={estimates} />}
      {step === "review" && <ReviewStep planId={v.plan_id} revisions={d.revisions} scopeCount={d.scope.length} staffCount={d.staffing.length} hasDates={!!(v.planned_start && v.planned_end)} estimate={d.estimate} coverage={d.coverage} gate={d.gate} role={actor.role} />}
      {step === "review" && <ComparePanel baseline={d.comparison.baseline} current={d.comparison.current} live={d.comparison.live} />}
      {step === "execution" && <ExecutionStep visit={{ id, version: v.version, exec_status: v.exec_status, planned_start: v.planned_start, planned_end: v.planned_end, timezone: v.timezone }} scope={d.scope} targets={d.targets} progress={d.progress} delays={d.delays} acceptance={d.acceptance}
        gate={d.gate} readinessGate={d.readinessGate} role={actor.role} />}
    </>
  );
}
