"use client";
import { useRef, useState } from "react";
import { allocateExpense, approveBudget, recordExpenseCredit, submitExpense } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { rupeesToMinor } from "@/lib/format";

const CATEGORIES = ["meal", "accommodation", "outbound_travel", "return_travel", "local_transport", "consumables", "unloading", "additional_manpower", "rework", "other"];

export function ExpenseForms({ projects, visits, expenses, canAllocate, canBudget }: {
  projects: Array<{ id: string; label: string }>; visits: Array<{ id: string; business_id: string; project_id: string }>;
  expenses: Array<{ id: string; label: string; projectId: string; state: string }>; canAllocate: boolean; canBudget: boolean;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const submit = useAction(submitExpense, { onSuccess: () => { token.current = null; } });
  const credit = useAction(recordExpenseCredit);
  const alloc = useAction(allocateExpense);
  const budget = useAction(approveBudget);
  const token = useRef<string | null>(null);
  const [targets, setTargets] = useState<Array<{ projectId: string; visitId: string; weight: string }>>([{ projectId: projects[0]?.id ?? "", visitId: "", weight: "1" }]);
  return (
    <div className="grid cols-2">
      <section className="card stack" aria-labelledby="h-sub">
        <h2 id="h-sub">Submit an expense</h2>
        <form className="form" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          submit.run({ projectId, visitId: String(f.get("v") || "") || undefined, category: String(f.get("c")), vendor: String(f.get("vendor") || "") || undefined, loadRef: String(f.get("load") || "") || undefined,
            amountMinor: rupeesToMinor(String(f.get("amt"))), incurredOn: String(f.get("d")), receiptRef: String(f.get("r") || "") || undefined, idempotencyKey: (token.current ??= `exp-${crypto.randomUUID()}`) });
        }}>
          <div className="fields">
            <div className="field"><label htmlFor="x-p">Project</label><select id="x-p" value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            <div className="field"><label htmlFor="x-v">Visit</label><select id="x-v" name="v"><option value="">Project level</option>{visits.filter((v) => v.project_id === projectId).map((v) => <option key={v.id} value={v.id}>{v.business_id}</option>)}</select></div>
            <div className="field"><label htmlFor="x-c">Category</label><select id="x-c" name="c">{CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></div>
            <div className="field"><label htmlFor="x-a">Amount (₹)</label><input id="x-a" name="amt" inputMode="decimal" pattern="\d+(\.\d{1,2})?" required /></div>
            <div className="field"><label htmlFor="x-d">Date incurred</label><input id="x-d" type="date" name="d" required /></div>
            <div className="field"><label htmlFor="x-r">Receipt reference</label><input id="x-r" name="r" /></div>
            <div className="field"><label htmlFor="x-vn">Vendor</label><input id="x-vn" name="vendor" /></div>
            <div className="field"><label htmlFor="x-l">Load ID (unloading)</label><input id="x-l" name="load" /></div>
          </div>
          <p className="small muted">Enter a shared cost (for example two rooms for three nights) once; do not repeat it per employee. Receipts are referenced, not uploaded.</p>
          <button type="submit" className="primary" disabled={submit.pending}>Submit expense</button>
          <ResultNotice result={submit.result} successText="Submitted for approval by a manager other than you." />
        </form>
      </section>
      <section className="card stack" aria-labelledby="h-more">
        <h2 id="h-more">Credits, allocation and budget</h2>
        <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); credit.run({ expenseId: String(f.get("x")), amountMinor: rupeesToMinor(String(f.get("amt"))), reason: String(f.get("why")) }); }}>
          <h3>Record a refund / credit</h3>
          <div className="fields">
            <div className="field"><label htmlFor="cr-x">Original expense</label><select id="cr-x" name="x">{expenses.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
            <div className="field"><label htmlFor="cr-a">Credit amount (₹)</label><input id="cr-a" name="amt" inputMode="decimal" required /></div>
          </div>
          <div className="field"><label htmlFor="cr-w">Reason</label><input id="cr-w" name="why" required minLength={3} /></div>
          <button type="submit" disabled={credit.pending || expenses.length === 0}>Record credit</button>
          <ResultNotice result={credit.result} successText="Credit recorded as a linked record." />
        </form>
        {canAllocate && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); alloc.run({ expenseId: String(f.get("x")), targets: targets.map((t) => ({ projectId: t.projectId, visitId: t.visitId || undefined, weight: Number(t.weight) })) }); }}>
            <h3>Split an expense</h3>
            <div className="field"><label htmlFor="al-x">Expense</label><select id="al-x" name="x">{expenses.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
            {targets.map((t, i) => (
              <div key={i} className="row">
                <label className="sr-only" htmlFor={`al-p-${i}`}>Target project {i + 1}</label>
                <select id={`al-p-${i}`} value={t.projectId} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, projectId: e.target.value, visitId: "" } : x)))} style={{ width: "auto" }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                <label className="sr-only" htmlFor={`al-v-${i}`}>Target visit {i + 1}</label>
                <select id={`al-v-${i}`} value={t.visitId} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, visitId: e.target.value } : x)))} style={{ width: "auto" }}><option value="">Project level</option>{visits.filter((v) => v.project_id === t.projectId).map((v) => <option key={v.id} value={v.id}>{v.business_id}</option>)}</select>
                <label className="sr-only" htmlFor={`al-w-${i}`}>Weight {i + 1}</label>
                <input id={`al-w-${i}`} value={t.weight} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} inputMode="decimal" style={{ width: 80 }} />
                <button type="button" className="danger" onClick={() => setTargets(targets.filter((_, j) => j !== i))} disabled={targets.length === 1}>Remove</button>
              </div>
            ))}
            <div className="row"><button type="button" onClick={() => setTargets([...targets, { projectId: projects[0]?.id ?? "", visitId: "", weight: "1" }])}>Add target</button><button type="submit" disabled={alloc.pending || expenses.length === 0}>Allocate</button></div>
            <ResultNotice result={alloc.result} successText="Allocated; parts sum exactly to the expense, including leftover paise." />
          </form>
        )}
        {canBudget && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); budget.run({ projectId: String(f.get("p")), approvedTotalMinor: rupeesToMinor(String(f.get("amt"))) }); }}>
            <h3>Approve project budget (Finance)</h3>
            <div className="fields">
              <div className="field"><label htmlFor="bg-p">Project</label><select id="bg-p" name="p">{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
              <div className="field"><label htmlFor="bg-a">Approved total (₹)</label><input id="bg-a" name="amt" inputMode="decimal" required /></div>
            </div>
            <button type="submit" disabled={budget.pending}>Approve budget</button>
            <ResultNotice result={budget.result} successText="Budget approved; the previous budget is kept as history." />
          </form>
        )}
      </section>
    </div>
  );
}
