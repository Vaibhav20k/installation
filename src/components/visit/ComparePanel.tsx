/** Original vs revised plan for one visit: baseline, current approved, and live records side by side. */
import { hours } from "@/lib/format";

interface Snap {
  plannedStart: string | null; plannedEnd: string | null; teamSize: number;
  scope: Array<{ task: string; scoped_quantity: string; kind: string; status: string }>;
  staffing: Array<{ employee: string; state: string }>;
  requirements: Array<{ skill: string; min_level: number; headcount: number }>;
  estimate: { totalPersonMinutes: string };
}

const LV = ["", "Low", "Medium", "High"];
const fields: Array<[string, (s: Snap) => string]> = [
  ["Planned dates", (s) => `${s.plannedStart ?? "—"} → ${s.plannedEnd ?? "—"}`],
  ["Team size", (s) => String(s.teamSize)],
  ["Staffing", (s) => s.staffing.map((x) => x.employee).sort().join(", ") || "None"],
  ["Scope", (s) => s.scope.filter((x) => x.status === "active").map((x) => `${x.task} ${Number(x.scoped_quantity)}${x.kind !== "original" ? ` (${x.kind})` : ""}`).join(", ") || "None"],
  ["Skill requirements", (s) => s.requirements.map((r) => `${r.skill} ${LV[r.min_level]}+ ×${r.headcount}`).join(", ") || "None"],
  ["Estimated effort", (s) => hours(Number(s.estimate.totalPersonMinutes))],
];

export function ComparePanel({ baseline, current, live }: { baseline: Snap | null; current: Snap | null; live: Snap | null }) {
  if (!baseline && !current) return <section className="card"><h2>Original vs revised</h2><p className="muted">No approved revision yet; the first approval becomes the baseline.</p></section>;
  return (
    <section className="card stack" aria-labelledby="h-cmp">
      <h2 id="h-cmp">Original vs revised</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Field</th><th>Baseline (immutable)</th><th>Current approved</th><th>Now (draft or live records)</th></tr></thead>
        <tbody>{fields.map(([label, fn]) => {
          const b = baseline ? fn(baseline) : "—", c = current ? fn(current) : "—", n = live ? fn(live) : "—";
          return (
            <tr key={label}><th scope="row">{label}</th><td>{b}</td><td>{c}{c !== b && <span className="badge" data-tone="warn" style={{ marginLeft: 6 }}>changed</span>}</td>
              <td>{n}{n !== c && <span className="badge" data-tone="accent" style={{ marginLeft: 6 }}>pending</span>}</td></tr>
          );
        })}</tbody>
      </table></div>
      <p className="small muted">Actual time and progress stay linked to this visit; a newer revision never detaches them.</p>
    </section>
  );
}
