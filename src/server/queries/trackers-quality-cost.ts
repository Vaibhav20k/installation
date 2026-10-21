/**
 * FTR / complaints / rework and cost / overtime / unloading tracker views.
 * Linked costs are summed from unique allocations so one expense is never counted twice.
 */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { monthBounds } from "@/lib/dates";
import { projectFilter } from "./common";
import type { TrackerView, Column } from "./trackers";

const col = (key: string, label: string, source: string): Column => ({ key, label, source });
const LABOUR = ["additional_manpower"], TRAVEL = ["outbound_travel", "return_travel", "local_transport"], MATERIAL = ["rework", "consumables"];

export async function ftrTracker(q: Queryable, actor: Actor, opts: { projectId?: string }): Promise<TrackerView> {
  const f = projectFilter(actor, "p", 1);
  const params = [...f.params];
  let where = f.sql;
  if (opts.projectId) { params.push(opts.projectId); where += ` and p.id = $${params.length}`; }
  const orders = await q.query<{
    order_id: string; order_bid: string; project_bid: string; customer_bid: string; city: string; first_start: string | null; first_status: string | null; first_transferred: boolean;
    planned_returns: number; unplanned_returns: number; return_causes: string | null; rework: boolean; complaint: boolean; categories: string | null; root_causes: string | null;
    functions: string | null; actions: string | null; owner: string | null; closed: string | null; signoff: boolean | null;
  }>(
    `select o.id order_id, o.business_id order_bid, p.business_id project_bid, c.business_id customer_bid, p.city,
       fv.planned_start::text first_start, fv.exec_status first_status,
       exists (select 1 from visit_task vt where vt.visit_id = fv.id and vt.status in ('transferred','cancelled') and vt.kind = 'original') first_transferred,
       (select count(distinct v.id)::int from visit v join visit_order vo on vo.visit_id = v.id where vo.order_id = o.id and v.visit_type <> 'fresh' and v.repeat_reason = 'planned_phasing' and v.exec_status <> 'cancelled') planned_returns,
       (select count(distinct v.id)::int from visit v join visit_order vo on vo.visit_id = v.id where vo.order_id = o.id and v.visit_type <> 'fresh' and v.repeat_reason <> 'planned_phasing' and v.exec_status <> 'cancelled') unplanned_returns,
       (select string_agg(distinct v.repeat_reason, ', ') from visit v join visit_order vo on vo.visit_id = v.id where vo.order_id = o.id and v.visit_type <> 'fresh') return_causes,
       exists (select 1 from visit_task vt join visit_order vo on vo.visit_id = vt.visit_id where vo.order_id = o.id and vt.kind = 'rework') or exists (select 1 from quality_case qc where qc.order_id = o.id and qc.kind = 'rework') rework,
       exists (select 1 from quality_case qc where qc.order_id = o.id and qc.kind = 'complaint') complaint,
       (select string_agg(distinct qc.category, ', ') from quality_case qc where qc.order_id = o.id) categories,
       (select string_agg(distinct qc.root_cause, '; ') from quality_case qc where qc.order_id = o.id) root_causes,
       (select string_agg(distinct qc.responsible_function, ', ') from quality_case qc where qc.order_id = o.id) functions,
       (select string_agg(distinct qc.corrective_action, '; ') from quality_case qc where qc.order_id = o.id) actions,
       (select string_agg(distinct e.name, ', ') from quality_case qc join employee e on e.id = qc.owner_id where qc.order_id = o.id) owner,
       (select max(qc.closed_on)::text from quality_case qc where qc.order_id = o.id) closed,
       (select bool_or(a.signed_off) from acceptance a join visit_order vo on vo.visit_id = a.visit_id where vo.order_id = o.id) signoff
     from sales_order o join project p on p.id = o.project_id join customer c on c.id = p.customer_id
     left join lateral (select v.id, v.planned_start, v.exec_status from visit v join visit_order vo on vo.visit_id = v.id where vo.order_id = o.id and v.exec_status <> 'cancelled' order by v.sequence limit 1) fv on true
     where ${where} order by o.business_id`, params);
  const costs = await q.query<{ order_id: string; category: string; amount: number }>(
    `select qc.order_id, x.category, sum(distinct_alloc.amount_minor)::bigint amount
     from (select distinct a.id, a.expense_id, a.quality_case_id, a.amount_minor from expense_allocation a) distinct_alloc
     join expense x on x.id = distinct_alloc.expense_id and x.state = 'approved' join quality_case qc on qc.id = distinct_alloc.quality_case_id
     where qc.order_id is not null group by qc.order_id, x.category`);
  const sumFor = (orderId: string, cats: string[] | null) => costs.filter((c) => c.order_id === orderId && (!cats || cats.includes(c.category))).reduce((s, c) => s + Number(c.amount), 0);
  const rows = orders.map((o) => {
    const firstDone = o.first_status === null ? null : ["completed", "closed"].includes(o.first_status) ? !o.first_transferred && o.unplanned_returns === 0 : null;
    return {
      orderId: o.order_bid, projectId: o.project_bid, customerId: o.customer_bid, site: o.city, installationDate: o.first_start,
      completedFirstVisit: firstDone === null ? "Pending" : firstDone ? "Y" : "N",
      plannedPhasedReturns: o.planned_returns, unplannedReturns: o.unplanned_returns, returnCauses: o.return_causes,
      reworkRequired: o.rework ? "Y" : "N", complaint: o.complaint ? "Y" : "N", complaintCategory: o.categories, rootCause: o.root_causes, responsibleFunction: o.functions,
      extraLabourMinor: sumFor(o.order_id, LABOUR), travelMinor: sumFor(o.order_id, TRAVEL), materialMinor: sumFor(o.order_id, MATERIAL), totalAdditionalMinor: sumFor(o.order_id, null),
      correctiveAction: o.actions, owner: o.owner, closureDate: o.closed, customerSignOff: o.signoff === null ? "Unknown" : o.signoff ? "Y" : "N",
    };
  });
  return {
    id: "ftr", title: "FTR Complaints Rework", sourceRange: "FTR Complaints Rework!A1:R1",
    columns: [
      col("orderId", "Order ID", "Order / Project ID (split)"), col("projectId", "Project ID", "Order / Project ID (split)"), col("customerId", "Customer ID", "Customer / Site (split)"),
      col("site", "Site", "Customer / Site (split)"), col("installationDate", "Installation date (first visit)", "Installation Date"),
      col("completedFirstVisit", "Completed on first visit (literal)", "Completed on First Visit? (Y/N)"), col("plannedPhasedReturns", "Planned phased returns", "Repeat Visit Count (split)"),
      col("unplannedReturns", "Unplanned returns", "Repeat Visit Count (split)"), col("returnCauses", "Return causes", "derived"), col("reworkRequired", "Rework required", "Rework Required? (Y/N)"),
      col("complaint", "Complaint", "Complaint? (Y/N)"), col("complaintCategory", "Complaint category", "Complaint Category"), col("rootCause", "Root cause", "Root Cause"),
      col("responsibleFunction", "Responsible function", "Responsible Function"), col("extraLabourMinor", "Extra labour cost (paise)", "Extra Labour Cost"), col("travelMinor", "Travel cost (paise)", "Travel Cost"),
      col("materialMinor", "Material / rework cost (paise)", "Material / Rework Cost"), col("totalAdditionalMinor", "Total additional cost (paise)", "Total Additional Cost"),
      col("correctiveAction", "Corrective action", "Corrective Action"), col("owner", "Owner", "Owner"), col("closureDate", "Closure date", "Closure Date"), col("customerSignOff", "Customer sign-off", "Customer Sign-off"),
    ],
    rows,
    notes: ["Literal first-visit completion is separate from quality-adjusted FTR; planned phased returns are not failures.", "Costs are approved expense allocations linked to quality cases, each counted once."],
  };
}

export async function costTracker(q: Queryable, actor: Actor, opts: { month: string; projectId?: string }): Promise<TrackerView & { projects: Array<Record<string, string | number | null>> }> {
  const { first, last } = monthBounds(opts.month);
  const f = projectFilter(actor, "p", 1);
  const params = [...f.params];
  let where = f.sql;
  if (opts.projectId) { params.push(opts.projectId); where += ` and p.id = $${params.length}`; }
  const projParams = [...params];
  params.push(first, last);
  const rows = await q.query<Record<string, string | number | null>>(
    `select x.incurred_on::text date, p.city location, x.business_id "expenseId", p.business_id "projectId",
       (select o.business_id from expense_allocation a join sales_order o on o.id = a.order_id where a.expense_id = x.id limit 1) "orderId", x.load_ref "loadId",
       x.category, coalesce(x.vendor, cl.name) "vendorOrSupervisor", el.amount_minor "estimateMinor",
       case when x.is_credit then -x.amount_minor else x.amount_minor end "actualMinor",
       case when el.amount_minor is null then null else (case when x.is_credit then -x.amount_minor else x.amount_minor end) - el.amount_minor end "varianceMinor",
       case when x.category = 'additional_manpower' then x.amount_minor end "additionalManpowerMinor",
       case when x.category = 'unloading' then x.amount_minor end "unloadingMinor",
       case when v.visit_type <> 'fresh' and v.repeat_reason <> 'planned_phasing' then x.amount_minor end "repeatVisitMinor",
       case x.state when 'approved' then 'Y' when 'rejected' then 'Rejected' else 'N' end "approvalAvailable", x.review_note "varianceReason",
       (select string_agg(case when s.finance_verified then 'Verified ' else 'Proposed ' end || coalesce(s.scope, ''), '; ') from savings_claim s where s.load_ref = x.load_ref and x.load_ref is not null) "savingsAction",
       cl.name owner, case when x.state = 'approved' then x.business_id || ' by ' || rv.name end "approvalReference"
     from expense x join project p on p.id = x.project_id join employee cl on cl.id = x.claimant_id left join employee rv on rv.id = x.reviewed_by
     left join estimate_line el on el.id = x.estimate_line_id left join visit v on v.id = x.visit_id
     where ${where} and x.incurred_on between $${params.length - 1}::date and $${params.length}::date order by x.incurred_on, x.business_id`, params);
  const projects = await q.query<Record<string, string | number | null>>(
    `select p.business_id "projectId", p.city location, (select approved_total_minor from budget b where b.project_id = p.id and b.is_current) "approvedBudgetMinor",
       coalesce((select sum(case when is_credit then -amount_minor else amount_minor end) from expense x where x.project_id = p.id and x.state = 'approved'), 0)::bigint "approvedActualMinor",
       coalesce((select sum(a.minutes) from reconciliation_allocation a where a.project_id = p.id and a.active), 0)::int "approvedOtMinutes",
       'N/A (no Finance-verified overtime cost records)' "overtimeCost",
       coalesce((select sum(baseline_minor - actual_minor) from savings_claim s where s.project_id = p.id and s.finance_verified), 0)::bigint "verifiedSavingsMinor",
       coalesce((select sum(proposed_saving_minor) from savings_claim s where s.project_id = p.id and not s.finance_verified), 0)::bigint "proposedSavingsMinor"
     from project p where ${where} order by p.business_id`, projParams);
  return {
    id: "cost", title: "Cost Overtime Unloading", sourceRange: "Cost Overtime Unloading!A1:R1",
    columns: [
      col("date", "Date", "Date"), col("location", "Location", "Location"), col("expenseId", "Expense ID", "derived"), col("projectId", "Project ID", "Order / Project ID / Load ID (split)"),
      col("orderId", "Order ID", "Order / Project ID / Load ID (split)"), col("loadId", "Load ID", "Order / Project ID / Load ID (split)"), col("category", "Cost category", "Cost Category"),
      col("vendorOrSupervisor", "Vendor / supervisor", "Vendor / Supervisor"), col("estimateMinor", "Linked estimate (paise)", "Approved Budget (₹) — see project budget below"),
      col("actualMinor", "Actual cost (paise)", "Actual Cost (₹)"), col("varianceMinor", "Variance vs estimate (paise)", "Variance (₹)"),
      col("additionalManpowerMinor", "Additional manpower (paise)", "Additional Manpower Cost (₹)"), col("unloadingMinor", "Unloading (paise)", "Unloading Cost (₹)"),
      col("repeatVisitMinor", "Repeat-visit cost (paise)", "Repeat Visit Cost (₹)"), col("approvalAvailable", "Approval available", "Approval Available? (Y/N)"),
      col("varianceReason", "Reason / review note", "Reason for Variance"), col("savingsAction", "Savings / avoidance", "Savings / Avoidance Action"), col("owner", "Owner", "Owner"),
      col("approvalReference", "Approval reference", "Approval Reference"),
    ],
    rows,
    projects,
    notes: ["Overtime hours and overtime cost are reported per project below; overtime cost is N/A without Finance-verified records.", "Budgets are per project and are not repeated on each expense row so totals are not multiplied.", "Proposed savings are never counted as verified savings."],
  };
}
