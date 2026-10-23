import Link from "next/link";
import { session } from "@/server/session";
import { expenseSummary } from "@/server/queries/dashboard";
import { listExpenses } from "@/server/queries/expenses";
import { listProjects } from "@/server/queries/projects";
import { formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";
import { AddExpense, ExpenseForms } from "@/components/expenses/ExpenseForms";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const projectId = sp.project || undefined;
  const [summary, expenses, projects] = await Promise.all([expenseSummary(db, actor, { projectId }), listExpenses(db, actor, { projectId, state: sp.state || undefined, page: Number(sp.page) || 1 }), listProjects(db, actor)]);
  const visits = await db.query<{ id: string; business_id: string; project_id: string }>("select id, business_id, project_id from visit where project_id = any($1::uuid[]) and exec_status <> 'cancelled' order by business_id", [projects.map((p) => p.id)]);
  const pages = Math.max(1, Math.ceil(expenses.total / expenses.pageSize));
  const pageHref = (p: number) => `/expenses?${new URLSearchParams(Object.entries({ project: projectId, state: sp.state, page: String(p) }).filter(([, v]) => v) as Array<[string, string]>).toString()}`;
  return (
    <>
      <PageHeader title="Expenses" subtitle="Estimates, approved budgets and actual expenses are distinct. Money is stored in paise; shared costs are entered once and allocated so parts always sum exactly." />
      <AddExpense projects={projects.map((p) => ({ id: p.id, label: `${p.business_id} · ${p.name}` }))} visits={visits} />
      <form className="row card no-print" role="search" aria-label="Filter expenses">
        <div className="field"><label htmlFor="e-p">Project</label><select id="e-p" name="project" defaultValue={projectId ?? ""}><option value="">All in scope</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.business_id} · {p.name}</option>)}</select></div>
        <div className="field"><label htmlFor="e-s">State</label><select id="e-s" name="state" defaultValue={sp.state ?? ""}><option value="">Any</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
        <button type="submit" style={{ alignSelf: "flex-end" }}>Apply</button>
      </form>
      <section className="card" aria-labelledby="h-sum">
        <h2 id="h-sum">Estimate, budget and actual</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Project</th><th className="num">Latest estimates</th><th className="num">Approved budget</th><th className="num">Approved actual</th><th className="num">Awaiting approval</th><th className="num">vs estimate</th><th className="num">vs budget</th><th className="num">Remaining budget</th></tr></thead>
          <tbody>{summary.map((s) => (
            <tr key={s.id}><td><Link href={`/expenses?project=${s.id}`}>{s.business_id}</Link></td><td className="num">{formatMoney(s.estimate)}</td><td className="num">{formatMoney(s.budget)}</td><td className="num">{formatMoney(s.actual)}</td>
              <td className="num">{formatMoney(s.submitted)}</td><td className="num">{formatMoney(s.estimateVarianceMinor)}</td>
              <td className="num">{s.budgetVarianceMinor === null ? "N/A" : `${formatMoney(s.budgetVarianceMinor)} (${s.budgetVariancePercent === null ? "N/A" : `${s.budgetVariancePercent}%`})`}</td><td className="num">{formatMoney(s.remainingBudgetMinor)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="card stack" aria-labelledby="h-list">
        <div className="spread"><h2 id="h-list">Expense records</h2><span className="small">Approved total for these filters: <strong>{formatMoney(expenses.approvedTotalMinor)}</strong> · {expenses.total} record{expenses.total === 1 ? "" : "s"}</span></div>
        {expenses.rows.length === 0 ? <Empty>No expenses match.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th className="pin">Expense</th><th>Date</th><th>Project / visit</th><th>Category</th><th>Vendor / load</th><th className="num">Amount</th><th>Claimant</th><th>State</th><th>Allocation</th></tr></thead>
            <tbody>{expenses.rows.map((e) => (
              <tr key={e.id}>
                <th scope="row" className="pin" style={{ fontWeight: 400 }}>{e.business_id}{e.is_credit && <div className="small">Credit for {e.reverses}</div>}{e.receipt_ref && <div className="small muted">{e.receipt_ref}</div>}</th>
                <td>{e.incurred_on}</td><td>{e.project}{e.visit ? ` · ${e.visit}` : ""}</td><td>{e.category.replace(/_/g, " ")}</td><td className="small">{e.vendor ?? "None"}{e.load_ref ? ` · ${e.load_ref}` : ""}</td>
                <td className="num">{e.is_credit ? "−" : ""}{formatMoney(e.amount_minor, e.currency)}</td><td>{e.claimant}</td>
                <td><Badge state={e.state} />{e.reviewer && <div className="small muted">{e.reviewer}{e.review_note ? `: ${e.review_note}` : ""}</div>}</td>
                <td className="small">{e.allocations.map((a, i) => <div key={i}>{a.project}{a.visit ? `/${a.visit}` : ""}{a.quality_case ? `/${a.quality_case}` : ""}: {formatMoney(a.amount_minor)}</div>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {pages > 1 && (
          <nav className="row pager" aria-label="Expense pages">
            {expenses.page > 1 ? <Link href={pageHref(expenses.page - 1)} rel="prev">Newer</Link> : <span className="muted">Newer</span>}
            <span className="small">Page {expenses.page} of {pages}</span>
            {expenses.page < pages ? <Link href={pageHref(expenses.page + 1)} rel="next">Older</Link> : <span className="muted">Older</span>}
          </nav>
        )}
      </section>
      <ExpenseForms projects={projects.map((p) => ({ id: p.id, label: `${p.business_id} · ${p.name}` }))} visits={visits} expenses={expenses.rows.filter((e) => !e.is_credit).map((e) => ({ id: e.id, label: `${e.business_id} · ${formatMoney(e.amount_minor)} · ${e.category}`, projectId: e.project_id, state: e.state }))}
        canAllocate={actor.role === "manager" || actor.role === "admin"} canBudget={actor.capabilities.includes("finance_verify")} />
    </>
  );
}
