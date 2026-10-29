import Link from "next/link";
import { session } from "@/server/session";
import { expenseSummary } from "@/server/queries/dashboard";
import { listExpenses } from "@/server/queries/expenses";
import { listProjects } from "@/server/queries/projects";
import { formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";
import { ActionButton } from "@/components/ui/ActionButton";
import { approveExpense } from "../../actions";
import { AddExpense, ExpenseForms } from "@/components/expenses/ExpenseForms";
import { Queue } from "@/components/approvals/Queue";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const isManager = actor.role === "manager" || actor.role === "admin";
  const projectId = sp.project || undefined;
  const [summary, expenses, projects, submitted] = await Promise.all([
    expenseSummary(db, actor, { projectId }), listExpenses(db, actor, { projectId, state: sp.state || undefined, page: Number(sp.page) || 1 }), listProjects(db, actor),
    listExpenses(db, actor, { state: "submitted" }),
  ]);
  const visits = await db.query<{ id: string; business_id: string; project_id: string }>("select id, business_id, project_id from visit where project_id = any($1::uuid[]) and exec_status <> 'cancelled' order by business_id", [projects.map((p) => p.id)]);
  // Waiting for this viewer: other people's submitted claims, oldest first (managers only; the server re-checks on approve).
  const toApprove = isManager ? submitted.rows.filter((e) => e.claimant_id !== actor.id).reverse() : [];
  const ownWaiting = submitted.rows.filter((e) => e.claimant_id === actor.id).length;
  const pages = Math.max(1, Math.ceil(expenses.total / expenses.pageSize));
  const pageHref = (p: number) => `/expenses?${new URLSearchParams(Object.entries({ project: projectId, state: sp.state, page: String(p) }).filter(([, v]) => v) as Array<[string, string]>).toString()}`;
  const projectOptions = projects.map((p) => ({ id: p.id, label: `${p.business_id} · ${p.name}` }));
  return (
    <div className="inbox-page">
      <PageHeader title="Expenses" subtitle="Add what you spent on a job with its receipt. A manager other than you approves it before it counts." />
      {toApprove.length > 0 && (
        <Queue q={{ id: "approve", title: "Waiting for your approval", noun: ["expense", "expenses"], mine: toApprove.length, items: toApprove.length, oldest: 0 }}
          note={submitted.total > submitted.rows.length ? <p className="small muted" style={{ margin: 0 }}>Showing the newest {submitted.rows.length} of {submitted.total}. <Link href="/approvals#expenses">Open all in To approve</Link>.</p> : undefined}>
          <div className="table-wrap"><table className="rows-mobile">
            <thead><tr><th>Expense</th><th>Claimed by</th><th>Project</th><th>Type</th><th>Date</th><th className="num">Amount</th><th>Decision</th></tr></thead>
            <tbody>{toApprove.map((x) => (
              <tr key={x.id}><td data-label="Expense">{x.business_id}{x.is_credit && <div className="small">Credit for {x.reverses}</div>}{x.receipt_ref && <div className="small muted">{x.receipt_ref}</div>}</td>
                <td data-label="Claimed by">{x.claimant}</td><td data-label="Project">{x.project}{x.visit ? ` · ${x.visit}` : ""}</td><td data-label="Type">{x.category.replace(/_/g, " ")}</td><td data-label="Date">{x.incurred_on}</td>
                <td data-label="Amount" className="num">{x.is_credit ? "−" : ""}{formatMoney(x.amount_minor, x.currency)}</td>
                <td data-label="Decision"><div className="row"><ActionButton action={approveExpense} input={{ expenseId: x.id, decision: "approved" }} label="Approve" tone="primary" successText="Approved." />
                  <ActionButton action={approveExpense} input={{ expenseId: x.id, decision: "rejected", note: "Rejected from expenses page: receipt or scope not verified" }} label="Reject" tone="danger" confirm="Reject this expense? The person who claimed it sees the reason." /></div></td></tr>
            ))}</tbody>
          </table></div>
        </Queue>
      )}
      <AddExpense projects={projectOptions} visits={visits} />
      {ownWaiting > 0 && <p className="small muted" role="status" style={{ margin: 0 }}>{ownWaiting === 1 ? "1 of your claims is" : `${ownWaiting} of your claims are`} waiting for a manager.</p>}
      <form className="row card no-print inbox-filter" role="search" aria-label="Filter expenses">
        <div className="field"><label htmlFor="e-p">Project</label><select id="e-p" name="project" defaultValue={projectId ?? ""}><option value="">All in scope</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.business_id} · {p.name}</option>)}</select></div>
        <div className="field"><label htmlFor="e-s">Status</label><select id="e-s" name="state" defaultValue={sp.state ?? ""}><option value="">Any</option><option value="submitted">Waiting for approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
        <button type="submit">Apply</button>
      </form>
      <section className="card stack" aria-labelledby="h-list">
        <div className="inbox-head"><h2 id="h-list">Expense records</h2><span className="small">Approved total: <strong>{formatMoney(expenses.approvedTotalMinor)}</strong> · {expenses.total} record{expenses.total === 1 ? "" : "s"}</span></div>
        {expenses.rows.length === 0 ? <Empty>No expenses match these filters. Use Add expense to record one.</Empty> : (
          <div className="table-wrap"><table className="rows-mobile">
            <thead><tr><th className="pin">Expense</th><th>Date</th><th>Project / visit</th><th>Type</th><th>Vendor / load</th><th className="num">Amount</th><th>Claimed by</th><th>Status</th><th>Split</th></tr></thead>
            <tbody>{expenses.rows.map((e) => (
              <tr key={e.id} data-needs={(isManager && e.state === "submitted" && e.claimant_id !== actor.id) || undefined}>
                <th scope="row" className="pin" style={{ fontWeight: 400 }}>{e.business_id}{e.is_credit && <div className="small">Credit for {e.reverses}</div>}{e.receipt_ref && <div className="small muted">{e.receipt_ref}</div>}</th>
                <td data-label="Date">{e.incurred_on}</td><td data-label="Project / visit">{e.project}{e.visit ? ` · ${e.visit}` : ""}</td><td data-label="Type">{e.category.replace(/_/g, " ")}</td><td data-label="Vendor / load" className="small">{e.vendor ?? "None"}{e.load_ref ? ` · ${e.load_ref}` : ""}</td>
                <td data-label="Amount" className="num">{e.is_credit ? "−" : ""}{formatMoney(e.amount_minor, e.currency)}</td><td data-label="Claimed by">{e.claimant}</td>
                <td data-label="Status"><span><Badge state={e.state} />{e.reviewer && <div className="small muted">{e.reviewer}{e.review_note ? `: ${e.review_note}` : ""}</div>}</span></td>
                <td data-label="Split" className="small"><span>{e.allocations.length === 0 ? "None" : e.allocations.map((a, i) => <div key={i}>{a.project}{a.visit ? `/${a.visit}` : ""}{a.quality_case ? `/${a.quality_case}` : ""}: {formatMoney(a.amount_minor)}</div>)}</span></td>
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
      <section className="card stack" aria-labelledby="h-sum">
        <h2 id="h-sum" style={{ margin: 0 }}>Estimate, budget and actual</h2>
        <p className="small muted" style={{ margin: 0 }}>Estimates, approved budgets and approved spending are kept apart. Shared costs are entered once and split so the parts always add up exactly.</p>
        {summary.length === 0 ? <Empty>No projects in your scope yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th className="pin">Project</th><th className="num">Latest estimates</th><th className="num">Approved budget</th><th className="num">Approved actual</th><th className="num">Awaiting approval</th><th className="num">vs estimate</th><th className="num">vs budget</th><th className="num">Remaining budget</th></tr></thead>
            <tbody>{summary.map((s) => (
              <tr key={s.id}><th scope="row" className="pin" style={{ fontWeight: 400 }}><Link href={`/expenses?project=${s.id}`}>{s.business_id}</Link></th><td className="num">{formatMoney(s.estimate)}</td><td className="num">{formatMoney(s.budget)}</td><td className="num">{formatMoney(s.actual)}</td>
                <td className="num">{formatMoney(s.submitted)}</td><td className="num">{formatMoney(s.estimateVarianceMinor)}</td>
                <td className="num">{s.budgetVarianceMinor === null ? "N/A" : `${formatMoney(s.budgetVarianceMinor)} (${s.budgetVariancePercent === null ? "N/A" : `${s.budgetVariancePercent}%`})`}</td><td className="num">{formatMoney(s.remainingBudgetMinor)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <ExpenseForms projects={projectOptions} visits={visits} expenses={expenses.rows.filter((e) => !e.is_credit).map((e) => ({ id: e.id, label: `${e.business_id} · ${formatMoney(e.amount_minor)} · ${e.category}`, projectId: e.project_id, state: e.state }))}
        canAllocate={isManager} canBudget={actor.capabilities.includes("finance_verify")} />
    </div>
  );
}
