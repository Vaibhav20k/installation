/** Expense list and allocations in the actor's project scope. */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { projectFilter } from "./common";

export async function listExpenses(q: Queryable, actor: Actor, opts: { projectId?: string; state?: string } = {}) {
  const f = projectFilter(actor, "p", 1);
  const params = [...f.params];
  let where = f.sql;
  if (opts.projectId) { params.push(opts.projectId); where += ` and p.id = $${params.length}`; }
  if (opts.state) { params.push(opts.state); where += ` and x.state = $${params.length}`; }
  return q.query<{
    id: string; business_id: string; project_id: string; project: string; visit: string | null; category: string; vendor: string | null; load_ref: string | null; amount_minor: number; currency: string;
    incurred_on: string; receipt_ref: string | null; state: string; is_credit: boolean; reverses: string | null; claimant: string; claimant_id: string; reviewer: string | null; review_note: string | null;
    allocations: Array<{ project: string; visit: string | null; quality_case: string | null; amount_minor: number }>;
  }>(
    `select x.id, x.business_id, p.id project_id, p.business_id project, v.business_id visit, x.category, x.vendor, x.load_ref, x.amount_minor, x.currency, x.incurred_on::text, x.receipt_ref,
       x.state, x.is_credit, rx.business_id reverses, cl.name claimant, cl.id claimant_id, rv.name reviewer, x.review_note,
       coalesce((select json_agg(json_build_object('project', ap.business_id, 'visit', av.business_id, 'quality_case', aq.business_id, 'amount_minor', a.amount_minor))
         from expense_allocation a join project ap on ap.id = a.project_id left join visit av on av.id = a.visit_id left join quality_case aq on aq.id = a.quality_case_id where a.expense_id = x.id), '[]') allocations
     from expense x join project p on p.id = x.project_id join employee cl on cl.id = x.claimant_id left join employee rv on rv.id = x.reviewed_by
     left join visit v on v.id = x.visit_id left join expense rx on rx.id = x.reverses_expense_id
     where ${where} order by x.incurred_on desc, x.business_id desc limit 300`, params);
}
