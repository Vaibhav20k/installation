"use client";
import { closeAction, closeQualityCase, createIssue, openQualityCase, reopenQualityCase } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { useState } from "react";
import { AttachToRecord, EvidenceUploader, attachmentNote, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import { Badge } from "@/components/ui/Badge";

const FUNCTIONS = ["Factory", "Purchase", "Logistics", "Services", "Site", "Installation", "Customer", "Unknown"];

export function QualityPanel({ projectId, quality, issues, orders, actorId }: {
  projectId: string; actorId: string; orders: Array<{ id: string; business_id: string }>;
  quality: Array<{ id: string; business_id: string; kind: string; category: string; status: string; reported_on: string; responsible_function: string | null; closed_on: string | null }>;
  issues: Array<{ id: string; business_id: string; function: string; category: string; status: string; due_date: string | null; owner: string | null; next_action: string | null; version: number }>;
}) {
  const qDraft = useEvidenceDraft("quality.case");
  const [qNote, setQNote] = useState("");
  const open = useAction(openQualityCase, { onSuccess: async (d) => setQNote(attachmentNote(await qDraft.attach("quality_case", (d as { id: string }).id))) });
  const close = useAction(closeQualityCase);
  const reopen = useAction(reopenQualityCase);
  const iDraft = useEvidenceDraft("issue.raise");
  const [iNote, setINote] = useState("");
  const issue = useAction(createIssue, { onSuccess: async (d) => setINote(attachmentNote(await iDraft.attach("issue", (d as { id: string }).id))) });
  const closeIssue = useAction(closeAction);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return (
    <div className="grid cols-2">
      <section className="card stack" aria-labelledby="h-qc">
        <h2 id="h-qc">Complaints and rework</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Case</th><th>Kind</th><th>Reported</th><th>Function</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{quality.map((q) => (
            <tr key={q.id}>
              <td>{q.business_id}<div className="small muted">{q.category}</div></td><td>{q.kind}</td><td>{q.reported_on}</td><td>{q.responsible_function ?? "Unknown"}</td>
              <td><Badge state={q.status} />{q.closed_on && <div className="small muted">closed {q.closed_on}</div>}</td>
              <td>
                {q.status !== "closed" && <form className="row" onSubmit={(e) => { e.preventDefault(); close.run({ caseId: q.id, closedOn: today, closureEvidence: String(new FormData(e.currentTarget).get("ev")) }); }}>
                  <label className="sr-only" htmlFor={`qe-${q.id}`}>Closure evidence</label><input id={`qe-${q.id}`} name="ev" placeholder="Closure evidence" required style={{ width: 150 }} /><button type="submit">Close</button></form>}
                <AttachToRecord parentType="quality_case" id={q.id} context="quality.closure" label="Photos or video" />
                {q.status === "closed" && <button type="button" onClick={() => reopen.run({ caseId: q.id, reportedOn: today, category: "Repeat complaint" })}>Reopen (new linked case)</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        <ResultNotice result={close.result ?? reopen.result} />
        <form className="form" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          open.run({ projectId, orderId: String(f.get("o") || "") || undefined, kind: String(f.get("k")), category: String(f.get("c")), reportedOn: String(f.get("d")),
            rootCause: String(f.get("rc") || "") || undefined, responsibleFunction: String(f.get("fn") || "") || undefined, correctiveAction: String(f.get("ca") || "") || undefined });
        }}>
          <h3>Record a case</h3>
          <div className="fields">
            <div className="field"><label htmlFor="q-k">Kind</label><select id="q-k" name="k"><option value="complaint">Complaint</option><option value="rework">Rework</option></select></div>
            <div className="field"><label htmlFor="q-o">Order</label><select id="q-o" name="o"><option value="">Project level</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.business_id}</option>)}</select></div>
            <div className="field"><label htmlFor="q-c">Category</label><input id="q-c" name="c" required minLength={2} /></div>
            <div className="field"><label htmlFor="q-d">Reported on</label><input id="q-d" type="date" name="d" defaultValue={today} required /></div>
            <div className="field"><label htmlFor="q-f">Responsible function</label><select id="q-f" name="fn" defaultValue=""><option value="">Unknown</option>{FUNCTIONS.map((f) => <option key={f}>{f}</option>)}</select></div>
          </div>
          <div className="field"><label htmlFor="q-rc">Root cause</label><input id="q-rc" name="rc" /></div>
          <div className="field"><label htmlFor="q-ca">Corrective action</label><input id="q-ca" name="ca" /></div>
          <EvidenceUploader draft={qDraft} />
          <button type="submit" disabled={open.pending}>Record case</button>
          <ResultNotice result={open.result} successText={`Case recorded.${qNote}`} />
        </form>
        <p className="small muted">A later complaint opens a linked case; the original acceptance date is never rewritten.</p>
      </section>
      <section className="card stack" aria-labelledby="h-iss">
        <h2 id="h-iss">Cross-functional issues and actions</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Issue</th><th>Function</th><th>Owner / next action</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>{issues.map((i) => (
            <tr key={i.id}>
              <td>{i.business_id}<div className="small muted">{i.category}</div></td><td>{i.function}</td><td>{i.owner ?? "—"}<div className="small">{i.next_action ?? ""}</div></td>
              <td>{i.due_date ?? "—"}{i.status !== "closed" && i.due_date && i.due_date < today && <div><Badge state="expired" label="Overdue" /></div>}</td>
              <td><Badge state={i.status === "closed" ? "closed" : "open"} label={i.status.replace("_", " ")} />
                {i.status !== "closed" && <form className="row" style={{ marginTop: 4 }} onSubmit={(e) => { e.preventDefault(); closeIssue.run({ issueId: i.id, closedOn: today, closureEvidence: String(new FormData(e.currentTarget).get("ev")), version: i.version }); }}>
                  <label className="sr-only" htmlFor={`ie-${i.id}`}>Closure evidence</label><input id={`ie-${i.id}`} name="ev" placeholder="Evidence" required style={{ width: 120 }} /><button type="submit">Close</button></form>}
                <AttachToRecord parentType="issue" id={i.id} context="issue.action" label="Photos or video" />
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        <ResultNotice result={closeIssue.result} successText="Action closed with evidence." />
        <form className="form" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          issue.run({ projectId, orderId: String(f.get("o") || "") || undefined, raisedOn: today, function: String(f.get("fn")), category: String(f.get("c")), description: String(f.get("d")),
            ownerId: actorId, nextAction: String(f.get("na") || "") || undefined, dueDate: String(f.get("due") || "") || undefined, impact: String(f.get("im") || "") || undefined });
        }}>
          <h3>Raise an issue</h3>
          <div className="fields">
            <div className="field"><label htmlFor="i-f">Function</label><select id="i-f" name="fn">{FUNCTIONS.map((f) => <option key={f}>{f}</option>)}</select></div>
            <div className="field"><label htmlFor="i-o">Order</label><select id="i-o" name="o"><option value="">Project level</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.business_id}</option>)}</select></div>
            <div className="field"><label htmlFor="i-c">Category</label><input id="i-c" name="c" required minLength={2} /></div>
            <div className="field"><label htmlFor="i-due">Due date</label><input id="i-due" type="date" name="due" /></div>
          </div>
          <div className="field"><label htmlFor="i-d">Description</label><textarea id="i-d" name="d" required minLength={5} /></div>
          <div className="field"><label htmlFor="i-im">Impact on installation</label><input id="i-im" name="im" /></div>
          <div className="field"><label htmlFor="i-na">Next action</label><input id="i-na" name="na" /></div>
          <EvidenceUploader draft={iDraft} />
          <p className="small muted">You are recorded as the named owner of this action.</p>
          <button type="submit" disabled={issue.pending}>Raise issue</button>
          <ResultNotice result={issue.result} successText={`Issue raised.${iNote}`} />
        </form>
      </section>
    </div>
  );
}
