"use client";
/**
 * Named filter sets for the planning sheet, kept in this browser only (a per-viewer convenience, like column choice).
 * Filters stay in the URL, so a saved set is just a link; nothing operational is stored here.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "@phosphor-icons/react";

const STORE = "im.sheet.filters";
type Saved = Array<{ name: string; query: string }>;

function load(): Saved {
  try { const s = localStorage.getItem(STORE); return s ? (JSON.parse(s) as Saved).filter((x) => typeof x.name === "string" && typeof x.query === "string") : []; } catch { return []; }
}
function store(list: Saved) {
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* storage unavailable: the set lasts for this visit only */ }
}

export function SavedFilters({ query }: { query: string }) {
  const [saved, setSaved] = useState<Saved>([]);
  const [name, setName] = useState("");
  useEffect(() => setSaved(load()), []);
  const save = () => {
    const n = name.trim();
    if (!n) return;
    const next = [...saved.filter((s) => s.name !== n), { name: n, query }].slice(-12);
    setSaved(next); store(next); setName("");
  };
  const remove = (n: string) => { const next = saved.filter((s) => s.name !== n); setSaved(next); store(next); };
  return (
    <div className="saved-filters no-print" aria-label="Saved filters">
      {saved.length > 0 && (
        <ul className="row" style={{ listStyle: "none", margin: 0, padding: 0, flexWrap: "wrap" }}>
          {saved.map((s) => (
            <li key={s.name} className="saved-filter">
              <Link href={`/planning?${s.query}`} aria-current={s.query === query ? "true" : undefined}>{s.name}</Link>
              <button type="button" className="icon-btn" onClick={() => remove(s.name)} aria-label={`Delete saved filter ${s.name}`}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="sr-only" htmlFor="sf-name">Name for the current filters</label>
        <input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name these filters" maxLength={40} style={{ width: 200 }} />
        <button type="submit" disabled={!name.trim()}>Save filters</button>
      </form>
    </div>
  );
}
