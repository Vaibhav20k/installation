"use client";
/**
 * Management planning sheet: one row per visit with expandable employee allocations.
 * Identifying columns are pinned; column visibility and saved filters are per-viewer conveniences.
 */
import { Fragment, useEffect, useState } from "react";

export interface SheetRowView {
  visitId: string; visit: string; customerId: string; projectBid: string; orders: string; products: string; site: string; manager: string | null; visitType: string; execStatus: string;
  approval: string; revision: number; skills: string; requestedStart: string | null; requestedMeaning: string | null; departure: string; plannedStart: string | null; plannedEnd: string | null;
  returnAt: string; workPersonDays: number | null; team: string; staffed: number; teamSize: number; continuity: string; clearances: string; estimate: string; budget: string;
  conflicts: string[]; nextAction: string; owner: string | null; due: string | null; allocations: Array<{ employee: string; role: string; state: string }>;
}

const COLUMNS: Array<{ key: keyof SheetRowView | "dates"; label: string; default: boolean }> = [
  { key: "customerId", label: "Customer ID", default: true }, { key: "projectBid", label: "Project ID", default: true }, { key: "orders", label: "Order IDs", default: true },
  { key: "products", label: "Product / components", default: false }, { key: "site", label: "Site", default: true }, { key: "manager", label: "Manager", default: false },
  { key: "visitType", label: "Visit type", default: true }, { key: "skills", label: "Skill requirement", default: false }, { key: "requestedStart", label: "Proposed start", default: false },
  { key: "departure", label: "Departure", default: false }, { key: "dates", label: "Planned work", default: true }, { key: "returnAt", label: "Return / release", default: false },
  { key: "workPersonDays", label: "Work person-days", default: true }, { key: "team", label: "Team", default: true }, { key: "continuity", label: "Continuity", default: false },
  { key: "clearances", label: "Clearances", default: true }, { key: "estimate", label: "Estimate", default: true }, { key: "budget", label: "Project budget", default: false },
  { key: "conflicts", label: "Conflicts", default: true }, { key: "nextAction", label: "Next action", default: true }, { key: "owner", label: "Owner", default: true }, { key: "due", label: "Due", default: true },
];
const STORE = "im.sheet.columns";

export function Sheet({ rows, exportHref }: { rows: SheetRowView[]; exportHref: string }) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(COLUMNS.filter((c) => c.default).map((c) => c.key)));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "plannedStart", dir: 1 });
  useEffect(() => {
    try { const s = localStorage.getItem(STORE); if (s) setVisible(new Set(JSON.parse(s) as string[])); } catch { /* storage unavailable */ }
  }, []);
  const toggle = (k: string) => {
    const next = new Set(visible);
    if (next.has(k)) next.delete(k); else next.add(k);
    setVisible(next);
    try { localStorage.setItem(STORE, JSON.stringify([...next])); } catch { /* storage unavailable */ }
  };
  const cols = COLUMNS.filter((c) => visible.has(c.key));
  const sorted = [...rows].sort((a, b) => {
    const av = String((a as unknown as Record<string, unknown>)[sort.key] ?? ""), bv = String((b as unknown as Record<string, unknown>)[sort.key] ?? "");
    return av.localeCompare(bv, undefined, { numeric: true }) * sort.dir;
  });
  const cell = (r: SheetRowView, k: string) => {
    if (k === "dates") return r.plannedStart ? `${r.plannedStart} → ${r.plannedEnd}` : "Not set";
    if (k === "conflicts") return r.conflicts.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{r.conflicts.map((c) => <li key={c}>{c}</li>)}</ul> : "None";
    if (k === "team") return `${r.staffed}/${r.teamSize}${r.team ? `: ${r.team}` : ""}`;
    if (k === "requestedStart") return r.requestedStart ? `${r.requestedStart} (${(r.requestedMeaning ?? "").replace("_", " ")})` : "—";
    const v = (r as unknown as Record<string, unknown>)[k];
    return v === null || v === undefined || v === "" ? "—" : String(v).replace(/_/g, " ");
  };
  return (
    <div className="stack">
      <div className="spread no-print">
        <details>
          <summary>Columns ({cols.length} of {COLUMNS.length} shown)</summary>
          <fieldset className="row" style={{ marginTop: 8 }}>
            <legend className="sr-only">Visible columns</legend>
            {COLUMNS.map((c) => (
              <label key={c.key} className="check small"><input type="checkbox" checked={visible.has(c.key)} onChange={() => toggle(c.key)} /> {c.label}</label>
            ))}
          </fieldset>
        </details>
        <a className="button" href={exportHref}>Export CSV (same filters)</a>
      </div>
      <div className="table-wrap" role="region" aria-label="Planning sheet" tabIndex={0}>
        <table>
          <caption className="sr-only">One row per visit. Expand a row to see employee allocations; summaries are not multiplied by employee rows.</caption>
          <thead>
            <tr>
              <th className="pin" scope="col">
                <button type="button" className="link" onClick={() => setSort({ key: "visit", dir: sort.key === "visit" ? (sort.dir === 1 ? -1 : 1) : 1 })} aria-label="Sort by visit">Visit</button>
              </th>
              <th scope="col">Status</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === (c.key === "dates" ? "plannedStart" : c.key) ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" className="link" onClick={() => { const key = c.key === "dates" ? "plannedStart" : c.key; setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1 }); }}>{c.label}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Fragment key={r.visitId}>
                <tr>
                  <th scope="row" className="pin" style={{ fontWeight: 400 }}>
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <button type="button" className="link" aria-expanded={open.has(r.visitId)} aria-label={`${open.has(r.visitId) ? "Hide" : "Show"} allocations for ${r.visit}`}
                        onClick={() => { const n = new Set(open); if (n.has(r.visitId)) n.delete(r.visitId); else n.add(r.visitId); setOpen(n); }}>{open.has(r.visitId) ? "▾" : "▸"}</button>
                      <a href={`/visits/${r.visitId}`}>{r.visit}</a>
                    </div>
                  </th>
                  <td><span className="small">{r.approval} r{r.revision}<br />{r.execStatus.replace("_", " ")}</span></td>
                  {cols.map((c) => <td key={c.key} className={c.key === "workPersonDays" ? "num" : undefined}>{cell(r, c.key)}</td>)}
                </tr>
                {open.has(r.visitId) && (r.allocations.length ? r.allocations : [{ employee: "No staff selected", role: "", state: "" }]).map((a) => (
                  <tr key={`${r.visitId}-${a.employee}`} className="sub">
                    <td className="pin" />
                    <td colSpan={cols.length + 1}>{a.employee}{a.role && ` · ${a.role.replace(/_/g, " ")} · ${a.state}`}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted">No visits match these filters.</p>}
    </div>
  );
}
