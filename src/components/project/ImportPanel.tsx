"use client";
import { useState } from "react";
import { applyImport, previewImport } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { Badge } from "@/components/ui/Badge";
import { when } from "@/lib/format";

interface Row { externalId: string; revision: string; projectBusinessId: string; orderRef: string; status: string; changes: string[]; reasons: string[]; plansToReview: string[] }

export function ImportPanel({ adapters, history }: { adapters: Array<{ system: string; label: string; live: boolean }>; history: Array<{ source_system: string; external_id: string; revision: string; applied_at: number; applied_by: string | null }> }) {
  const [system, setSystem] = useState(adapters[0]?.system ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const preview = useAction(previewImport, { refresh: false, onSuccess: (d) => setSelected(new Set((d as { rows: Row[] }).rows.filter((r) => r.status === "new" || r.status === "update").map((r) => r.externalId))) });
  const apply = useAction(applyImport, { onSuccess: () => preview.run({ system }) });
  const rows = preview.result?.ok ? (preview.result.data as { rows: Row[] }).rows : [];
  const out = apply.result?.ok ? (apply.result.data as { applied: string[]; skipped: string[] }) : null;
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="h-src">
        <h2 id="h-src">1. Preview</h2>
        <div className="row">
          <div className="field"><label htmlFor="im-s">Source</label><select id="im-s" value={system} onChange={(e) => setSystem(e.target.value)}>{adapters.map((a) => <option key={a.system} value={a.system}>{a.label}{a.live ? "" : " (demo)"}</option>)}</select></div>
          <button type="button" className="primary" style={{ alignSelf: "flex-end" }} onClick={() => preview.run({ system })} disabled={preview.pending}>{preview.pending ? "Reading…" : "Preview changes"}</button>
        </div>
        <ResultNotice result={preview.result?.ok ? null : preview.result} />
        {rows.length > 0 && (
          <div className="table-wrap"><table>
            <thead><tr><th>Apply</th><th>Source record</th><th>Project</th><th>Result</th><th>Changes / reasons</th><th>Approved plans to review</th></tr></thead>
            <tbody>{rows.map((r) => {
              const can = r.status === "new" || r.status === "update";
              return (
                <tr key={r.externalId}>
                  <td><input type="checkbox" aria-label={`Apply ${r.externalId}`} disabled={!can} checked={selected.has(r.externalId)} onChange={() => { const n = new Set(selected); if (n.has(r.externalId)) n.delete(r.externalId); else n.add(r.externalId); setSelected(n); }} /></td>
                  <td>{r.externalId} <span className="muted small">{r.revision}</span><div className="small muted">order ref {r.orderRef}</div></td>
                  <td>{r.projectBusinessId}</td>
                  <td><Badge state={r.status === "rejected" ? "rejected" : r.status === "unchanged" ? "closed" : r.status === "new" ? "proposed" : "pending"} label={r.status} /></td>
                  <td className="small"><ul style={{ margin: 0, paddingLeft: 16 }}>{[...r.reasons, ...r.changes].map((c) => <li key={c}>{c}</li>)}</ul></td>
                  <td className="small">{r.plansToReview.join(", ") || "—"}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
      {rows.length > 0 && (
        <section className="card stack" aria-labelledby="h-apply">
          <h2 id="h-apply">2. Apply selected ({selected.size})</h2>
          <p className="small muted">Updates change current order and component records; approved plan revisions keep their snapshot, and a review issue is raised for each affected approved plan.</p>
          <button type="button" className="primary" disabled={apply.pending || selected.size === 0} onClick={() => apply.run({ system, externalIds: [...selected] })}>{apply.pending ? "Applying…" : "Apply selected"}</button>
          <ResultNotice result={apply.result} successText="Import applied." />
          {out && <div className="small"><div>Applied: {out.applied.join("; ") || "none"}</div><div>Skipped: {out.skipped.join("; ") || "none"}</div></div>}
        </section>
      )}
      <section className="card" aria-labelledby="h-hist">
        <h2 id="h-hist">Applied source revisions</h2>
        {history.length === 0 ? <p className="muted">Nothing imported yet.</p> : <ul className="small">{history.map((h) => <li key={`${h.source_system}-${h.external_id}-${h.revision}`}>{h.source_system} {h.external_id} {h.revision} · {when(h.applied_at)} · {h.applied_by ?? "system"}</li>)}</ul>}
      </section>
    </div>
  );
}
