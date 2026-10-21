"use client";
import { useState } from "react";
import { createEstimate } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { formatMoney, rupeesToMinor } from "@/lib/format";

const CATEGORIES = ["meal", "accommodation", "outbound_travel", "return_travel", "local_transport", "consumables", "unloading", "additional_manpower", "rework", "other"];
const BASES: Record<string, string[]> = {
  per_person_day: ["people", "days"], per_person_night: ["people", "nights"], per_room_night: ["rooms", "nights"], per_team_night: ["teams", "nights"],
  per_trip: ["trips"], per_unit: ["units"], fixed: [],
};
interface Line { category: string; basis: string; factors: Record<string, string>; unitRate: string; scope: string }

export function ExpensesStep({ visitId, projectId, staffCount, plannedStart, plannedEnd, departure, returnAt, estimates }: {
  visitId: string; projectId: string; staffCount: number; plannedStart: string | null; plannedEnd: string | null; departure: number | null; returnAt: number | null;
  estimates: Array<{ id: string; version: number; total: number; lines: Array<{ category: string; basis: string; factors: Record<string, number>; unit_rate_minor: number; amount_minor: number; scope: string | null }> | null }>;
}) {
  const workDays = plannedStart && plannedEnd ? Math.round((Date.parse(plannedEnd) - Date.parse(plannedStart)) / 86400000) + 1 : 0;
  const nights = departure && returnAt ? Math.max(0, Math.round((new Date(returnAt).setHours(0, 0, 0, 0) - new Date(departure).setHours(0, 0, 0, 0)) / 86400000)) : 0;
  const [lines, setLines] = useState<Line[]>([{ category: "meal", basis: "per_person_day", factors: { people: String(staffCount || 3), days: String(workDays || 1) }, unitRate: "", scope: "" }]);
  const { run, pending, result } = useAction(createEstimate);
  const upd = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const toMinor = (rupees: string) => rupeesToMinor(rupees || "0");
  const preview = (l: Line) => (BASES[l.basis] ?? []).reduce((acc, k) => acc * Number(l.factors[k] || 0), 1) * toMinor(l.unitRate);
  return (
    <div className="grid cols-2">
      <section className="card stack" aria-labelledby="h-new-est">
        <h2 id="h-new-est">New estimate version</h2>
        <p className="small muted">Prefilled quantities come from the plan: {staffCount} staff, {workDays} work day(s){nights ? `, ${nights} night(s) from the itinerary` : ""}. Rates are entered by you; none are assumed. Shared accommodation is per room-night, so employee count does not multiply it again.</p>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          run({ projectId, visitId, lines: lines.map((l) => ({ category: l.category, basis: l.basis, unitRateMinor: toMinor(l.unitRate), scope: l.scope || undefined,
            factors: Object.fromEntries((BASES[l.basis] ?? []).map((k) => [k, Number(l.factors[k] || 0)])) })) });
        }}>
          {lines.map((l, i) => (
            <fieldset key={i}>
              <legend>Line {i + 1} · preview {formatMoney(preview(l))}</legend>
              <div className="fields">
                <div className="field"><label htmlFor={`c-${i}`}>Category</label><select id={`c-${i}`} value={l.category} onChange={(e) => upd(i, { category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></div>
                <div className="field"><label htmlFor={`b-${i}`}>Basis</label>
                  <select id={`b-${i}`} value={l.basis} onChange={(e) => { const basis = e.target.value; upd(i, { basis, factors: Object.fromEntries((BASES[basis] ?? []).map((k) => [k, k === "people" ? String(staffCount) : k === "days" ? String(workDays) : k === "nights" ? String(nights) : "1"])) }); }}>
                    {Object.keys(BASES).map((b) => <option key={b} value={b}>{b.replace(/_/g, " ")}</option>)}</select></div>
                {(BASES[l.basis] ?? []).map((k) => (
                  <div key={k} className="field"><label htmlFor={`${k}-${i}`}>{k}</label><input id={`${k}-${i}`} inputMode="decimal" value={l.factors[k] ?? ""} onChange={(e) => upd(i, { factors: { ...l.factors, [k]: e.target.value } })} /></div>
                ))}
                <div className="field"><label htmlFor={`r-${i}`}>Unit rate (₹)</label><input id={`r-${i}`} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={l.unitRate} onChange={(e) => upd(i, { unitRate: e.target.value })} required /></div>
              </div>
              <div className="row"><button type="button" className="danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}>Remove line</button></div>
            </fieldset>
          ))}
          <div className="row">
            <button type="button" onClick={() => setLines([...lines, { category: "accommodation", basis: "per_room_night", factors: { rooms: "1", nights: String(nights) }, unitRate: "", scope: "" }])}>Add line</button>
            <button type="submit" className="primary" disabled={pending}>Save estimate version</button>
          </div>
          <ResultNotice result={result} successText="Estimate version saved. Amounts were recalculated on the server in paise." />
        </form>
      </section>
      <section className="card stack" aria-labelledby="h-est-hist">
        <h2 id="h-est-hist">Estimate versions</h2>
        {estimates.length === 0 ? <p className="muted">No estimate yet. An estimate is not an approved budget.</p> : estimates.map((e) => (
          <div key={e.id} className="stack">
            <h3>Version {e.version} · {formatMoney(Number(e.total))}</h3>
            <div className="table-wrap"><table>
              <thead><tr><th>Category</th><th>Basis</th><th>Quantities</th><th className="num">Unit rate</th><th className="num">Amount</th></tr></thead>
              <tbody>{(e.lines ?? []).map((l, i) => (
                <tr key={i}><td>{l.category.replace(/_/g, " ")}</td><td>{l.basis.replace(/_/g, " ")}</td><td>{Object.entries(l.factors).map(([k, v]) => `${v} ${k}`).join(" × ") || "fixed"}</td>
                  <td className="num">{formatMoney(l.unit_rate_minor)}</td><td className="num">{formatMoney(l.amount_minor)}</td></tr>
              ))}</tbody>
            </table></div>
          </div>
        ))}
      </section>
    </div>
  );
}
