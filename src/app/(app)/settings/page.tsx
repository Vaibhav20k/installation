import { Fragment } from "react";
import { session } from "@/server/session";
import { unresolvedPolicyFields } from "@/server/services/settings";
import { when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Notice, PageHeader, Tabs } from "@/components/ui/Notice";
import { PolicyEditor } from "@/components/settings/PolicyEditor";
import { RateApproval, TargetApproval } from "@/components/settings/Approvals";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const tab = ["policies", "rates", "kpi", "calendars", "general"].includes(sp.tab ?? "") ? sp.tab! : "policies";
  return (
    <>
      <PageHeader title="Settings" subtitle="Policies, rates, calendars and KPI targets are versioned. Approvals are protected separately from editing; demo values are illustrative and are not approved company settings." />
      <Tabs current={tab} items={[
        { id: "policies", label: "Time policies", href: "/settings?tab=policies" }, { id: "rates", label: "Productivity rates", href: "/settings?tab=rates" },
        { id: "kpi", label: "KPI definitions & targets", href: "/settings?tab=kpi" }, { id: "calendars", label: "Work calendars", href: "/settings?tab=calendars" }, { id: "general", label: "General", href: "/settings?tab=general" },
      ]} />
      {tab === "policies" && await (async () => {
        const rows = await db.query<Record<string, unknown> & { id: string; business_id: string; name: string; status: string; illustrative: boolean; effective_month: string; approved_at: number | null; approver: string | null }>(
          `select p.*, p.effective_month::text effective_month, e.name approver from time_policy p left join employee e on e.id = p.approved_by order by p.effective_month desc, p.business_id desc`);
        return (
          <div className="stack">
            <Notice tone="warn">The monthly threshold is a configurable internal policy, not a statutory payroll rule. A month stays provisional while any field it needs is unset. The confirmed original-target catch-up exclusion is built in and is not a setting.</Notice>
            {rows.map((p) => (
              <section key={p.id} className="card stack" aria-labelledby={`pol-${p.id}`}>
                <div className="spread"><h2 id={`pol-${p.id}`}>{p.business_id} · {p.name}</h2><span><Badge state={p.status === "approved" ? "approved" : p.status === "superseded" ? "voided" : "draft"} label={p.status} /> {p.illustrative && <Badge state="illustrative" label="Illustrative" />}</span></div>
                <p className="small muted">Effective from {p.effective_month}{p.approver ? ` · approved by ${p.approver} ${when(p.approved_at)}` : ""}</p>
                {unresolvedPolicyFields(p).length > 0 && <Notice tone="warn" title="Unresolved fields" items={unresolvedPolicyFields(p)} />}
                <PolicyEditor policy={{
                  id: p.id, status: p.status, normalBasis: String(p.normal_basis), fixedMonthlyMinutes: p.fixed_monthly_minutes as number | null, creditedActivities: p.credited_activities as string[],
                  catchUpThresholdCredit: String(p.catch_up_threshold_credit), candidateRule: String(p.candidate_rule), externalDelayEligibility: String(p.external_delay_eligibility),
                  otherDocumentedEligibility: String(p.other_documented_eligibility), allocationMethod: String(p.allocation_method), leaveAdjustment: String(p.leave_adjustment), settlementTimezone: String(p.settlement_timezone),
                }} canEdit={actor.role === "admin"} canApprove={actor.capabilities.includes("policy_activate")} />
              </section>
            ))}
          </div>
        );
      })()}
      {tab === "rates" && await (async () => {
        const rates = await db.query<{ id: string; business_id: string; version: number; activity: string; quantity_kind: string; unit: string; basis: string; value: string; crew_size: number | null; net_day_minutes: number | null; status: string; effective_from: string; approver: string | null }>(
          `select r.id, r.business_id, r.version, r.activity, r.quantity_kind, r.unit, r.basis, r.value::float::text value, r.crew_size, r.net_day_minutes, r.status, r.effective_from::text, e.name approver
           from productivity_rate r left join employee e on e.id = r.approved_by order by r.business_id, r.version desc`);
        const templates = await db.query<{ activity: string; quantity_kind: string; role: string; hours_per_unit: string | null; fixed_hours: string | null; status: string }>(
          "select activity, quantity_kind, role, hours_per_unit::float::text, fixed_hours::float::text, status from role_template order by activity, quantity_kind, role");
        return (
          <div className="stack">
            <Notice tone="warn">Seeded rates and role templates are unverified examples. Approving creates a new version with evidence; an illustrative row is never relabelled as approved.</Notice>
            <div className="table-wrap"><table>
              <thead><tr><th>Rate</th><th>Activity</th><th>Quantity kind / unit</th><th>Basis</th><th className="num">Value</th><th className="num">Crew</th><th className="num">Net minutes per rate-day</th><th>Status</th><th>Effective</th></tr></thead>
              <tbody>{rates.map((r) => <tr key={r.id}><td>{r.business_id} v{r.version}</td><td>{r.activity}</td><td>{r.quantity_kind.replace(/_/g, " ")} / {r.unit}</td><td>{r.basis.replace("_", " ")}</td><td className="num">{r.value}</td><td className="num">{r.crew_size ?? "—"}</td><td className="num">{r.net_day_minutes ?? "—"}</td><td><Badge state={r.status} />{r.approver && <div className="small muted">{r.approver}</div>}</td><td>{r.effective_from}</td></tr>)}</tbody>
            </table></div>
            {actor.capabilities.includes("rate_approve") ? <RateApproval rates={rates.map((r) => ({ id: r.id, label: `${r.business_id} v${r.version} · ${r.activity} ${r.quantity_kind} (${r.status})` }))} /> : <p className="small muted">Approving rates needs the rate-approve capability.</p>}
            <h2>Role-hour templates</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>Activity</th><th>Quantity kind</th><th>Role</th><th className="num">Hours per unit</th><th className="num">Fixed hours</th><th>Status</th></tr></thead>
              <tbody>{templates.map((t, i) => <tr key={i}><td>{t.activity}</td><td>{t.quantity_kind.replace(/_/g, " ")}</td><td>{t.role.replace(/_/g, " ")}</td><td className="num">{t.hours_per_unit ?? "—"}</td><td className="num">{t.fixed_hours ?? "—"}</td><td><Badge state={t.status} /></td></tr>)}</tbody>
            </table></div>
            <p className="small muted">Role templates are an alternative estimation method to rate-based effort; the two are never added for the same work.</p>
          </div>
        );
      })()}
      {tab === "kpi" && await (async () => {
        const defs = await db.query<{ code: string; version: number; name: string; formula: string; unit: string; direction: string; status: string; grain: string | null; window_text: string | null; cohort: string | null }>(
          "select distinct on (code) code, version, name, formula, unit, direction, status, grain, window_text, cohort from kpi_definition order by code, version desc");
        const targets = await db.query<{ id: string; kpi_code: string; baseline_text: string | null; target_text: string | null; status: string; target_value: string | null }>(
          "select id, kpi_code, baseline_text, target_text, status, target_value::float::text from kpi_target order by kpi_code");
        return (
          <div className="stack">
            <Notice tone="warn">Workbook rows are preserved verbatim as reference text. A target becomes active only when an authorized person approves a numeric value with evidence for a confirmed period and population.</Notice>
            <div className="table-wrap"><table>
              <thead><tr><th>KPI</th><th>Definition</th><th>Grain / window / cohort</th><th>Reference baseline</th><th>Reference target</th><th>Target status</th></tr></thead>
              <tbody>{defs.map((d) => { const t = targets.find((x) => x.kpi_code === d.code); return (
                <tr key={d.code}><td><strong>{d.name}</strong><div className="small muted">{d.code} v{d.version} · <Badge state={d.status === "approved" ? "approved" : "draft"} label={d.status} /></div></td><td className="small">{d.formula}</td>
                  <td className="small">{d.grain ?? "not set"} / {d.window_text ?? "not set"} / {d.cohort ?? "not set"}</td><td className="small">{t?.baseline_text ?? "—"}</td><td className="small">{t?.target_text ?? "—"}</td>
                  <td><Badge state={t?.status === "approved" ? "approved" : "illustrative"} label={t?.status ?? "none"} />{t?.target_value && <div className="small">{t.target_value}</div>}</td></tr>
              ); })}</tbody>
            </table></div>
            <TargetApproval targets={targets.map((t) => ({ id: t.id, label: `${t.kpi_code}: ${t.target_text}` }))} metrics={defs.map((d) => ({ code: d.code, label: d.name, formula: d.formula }))}
              canApproveTarget={actor.capabilities.includes("target_approve")} canApproveMetric={actor.capabilities.includes("kra_review")} />
          </div>
        );
      })()}
      {tab === "calendars" && await (async () => {
        const cals = await db.query<{ id: string; name: string; timezone: string; week_pattern: Record<string, { shifts: Array<{ start: string; end: string }>; netMinutes: number }>; is_illustrative: boolean; version: number }>("select id, name, timezone, week_pattern, is_illustrative, version from work_calendar");
        const hol = await db.query<{ calendar_id: string; date: string; name: string }>("select calendar_id, date::text, name from holiday order by date");
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        return cals.map((c) => (
          <section key={c.id} className="card stack" aria-labelledby={`cal-${c.id}`}>
            <div className="spread"><h2 id={`cal-${c.id}`}>{c.name} (v{c.version})</h2>{c.is_illustrative && <Badge state="illustrative" label="Illustrative" />}</div>
            <p className="small muted">Timezone {c.timezone}. Normal day/month hours, breaks and holidays are unresolved business decisions; these values are examples.</p>
            <div className="table-wrap"><table>
              <thead><tr><th>Day</th><th>Shifts</th><th className="num">Net minutes</th></tr></thead>
              <tbody>{days.map((d, i) => { const p = c.week_pattern[String(i)]; return <tr key={d}><td>{d}</td><td>{p ? p.shifts.map((s) => `${s.start}–${s.end}`).join(", ") : "Not a working day"}</td><td className="num">{p?.netMinutes ?? 0}</td></tr>; })}</tbody>
            </table></div>
            <p className="small">Holidays: {hol.filter((h) => h.calendar_id === c.id).map((h) => `${h.date} (${h.name})`).join(", ") || "none"}</p>
          </section>
        ));
      })()}
      {tab === "general" && await (async () => {
        const rows = await db.query<{ key: string; value: unknown }>("select key, value from app_setting order by key");
        return (
          <section className="card">
            <dl className="facts">{rows.map((r) => <Fragment key={r.key}><dt>{r.key.replace(/_/g, " ")}</dt><dd className="small">{typeof r.value === "object" ? <code>{JSON.stringify(r.value)}</code> : String(r.value)}</dd></Fragment>)}</dl>
            <p className="small muted">Changing these requires a database migration or seed change in this demo; they are recorded in docs/decisions.md.</p>
          </section>
        );
      })()}
    </>
  );
}
