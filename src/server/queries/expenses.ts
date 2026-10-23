/** Expense list and allocations in the actor's project scope. */
import type { Queryable } from "../db/client";
import type { Actor } from "../auth/permissions";
import { paging, projectFilter, type Paged } from "./common";

export type ExpenseRow = {
  id: string; business_id: string; project_id: string; project: string; visit: string | null; category: string; vendor: string | null; load_ref: string | null; amount_minor: number; currency: string;
  incurred_on: string; receipt_ref: string | null; state: string; is_credit: boolean; reverses: string | null; claimant: string; claimant_id: string; reviewer: string | null; review_note: string | null;
  allocations: Array<{ project: string; visit: string | null; quality_case: string | null; amount_minor: number }>;
};

/** One page of expenses (newest first). Totals cover every matching record, not just the page. */
export async function listExpenses(q: Queryable, actor: Actor, opts: { projectId?: string; state?: string; page?: number } = {}): Promise<Paged<ExpenseRow> & { approvedTotalMinor: number }> {
  const pg = paging(opts.page, 50);
  const f = projectFilter(actor, "p", 1);
  const params = [...f.params];
  let where = f.sql;
  if (opts.projectId) { params.push(opts.projectId); where += ` and p.id = $${params.length}`; }
  if (opts.state) { params.push(opts.state); where += ` and x.state = $${params.length}`; }
  const rows = await q.query<ExpenseRow & { total: number; approved_total: string | null }>(
    `select count(*) over ()::int total,
       sum(case when x.state = 'approved' then case when x.is_credit then -x.amount_minor else x.amount_minor end else 0 end) over () approved_total,
       x.id, x.business_id, p.id project_id, p.business_id project, v.business_id visit, x.category, x.vendor, x.load_ref, x.amount_minor, x.currency, x.incurred_on::text, x.receipt_ref,
       x.state, x.is_credit, rx.business_id reverses, cl.name claimant, cl.id claimant_id, rv.name reviewer, x.review_note,
       coalesce((select json_agg(json_build_object('project', ap.business_id, 'visit', av.business_id, 'quality_case', aq.business_id, 'amount_minor', a.amount_minor))
         from expense_allocation a join project ap on ap.id = a.project_id left join visit av on av.id = a.visit_id left join quality_case aq on aq.id = a.quality_case_id where a.expense_id = x.id), '[]') allocations
     from expense x join project p on p.id = x.project_id join employee cl on cl.id = x.claimant_id left join employee rv on rv.id = x.reviewed_by
     left join visit v on v.id = x.visit_id left join expense rx on rx.id = x.reverses_expense_id
     where ${where} order by x.incurred_on desc, x.business_id desc limit ${pg.pageSize} offset ${pg.offset}`, params);
  return { rows: rows.map(({ total: _t, approved_total: _a, ...r }) => r), total: rows[0]?.total ?? 0, page: pg.page, pageSize: pg.pageSize, approvedTotalMinor: Number(rows[0]?.approved_total ?? 0) };
}
