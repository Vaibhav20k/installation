/** Timeline board: employee rows, day columns; work, holds, proposals and leave are visually and textually distinct. */
import { addDays, weekday } from "@/lib/dates";
import { when } from "@/lib/format";

interface Segment { kind: "proposed" | "held" | "confirmed" | "leave"; label: string; start: number; end: number; visitId: string | null; note?: string }
interface Row { id: string; business_id: string; name: string; job_role: string; base_city: string; segments: Segment[] }

const KIND_TEXT: Record<Segment["kind"], string> = { confirmed: "Confirmed", held: "Held (blocking, expires)", proposed: "Proposed (not reserved)", leave: "Leave" };

export function Board({ from, days, start, end, rows }: { from: string; days: number; start: number; end: number; rows: Row[] }) {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const nameCol = 200, dayCol = 44;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / (end - start)) * 100));
  return (
    <div className="stack">
      <div className="legend" aria-label="Legend">
        <span><i className="swatch" style={{ background: "var(--ink)" }} /> Confirmed</span>
        <span><i className="swatch" style={{ background: "var(--plate-3)", border: "1.5px solid var(--ink)" }} /> Held (blocking until expiry)</span>
        <span><i className="swatch" style={{ border: "1.5px dashed var(--rule-strong)" }} /> Proposed (does not reserve)</span>
        <span><i className="swatch" style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)" }} /> Approved leave</span>
        <span>Outstation bookings include travel and occupancy until return.</span>
      </div>
      <div className="board" role="region" aria-label="Staffing timeline" tabIndex={0}>
        <div className="board-grid" style={{ gridTemplateColumns: `${nameCol}px repeat(${days}, minmax(${dayCol}px, 1fr))`, minWidth: nameCol + days * dayCol }}>
          <div className="board-cell board-day board-name" style={{ zIndex: 4 }}>Employee</div>
          {dates.map((d) => (
            <div key={d} className={`board-cell board-day${weekday(d) === 0 ? " weekend" : ""}`} title={d}>
              {d.slice(8)}<br /><span className="muted">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][weekday(d)]}</span>
            </div>
          ))}
          {rows.map((r) => (
            <div key={r.id} className="board-row">
              <div className="board-cell board-name"><a href={`/people/${r.id}`}>{r.name}</a><small>{r.business_id} · {r.job_role.replace(/_/g, " ")}</small></div>
              <div className="board-cell" style={{ gridColumn: `span ${days}`, position: "relative", backgroundImage: "linear-gradient(90deg, transparent calc(100% - 1px), var(--rule) 0)", backgroundSize: `${100 / days}% 100%` }}>
                {r.segments.map((s, i) => {
                  const left = pct(s.start), right = pct(s.end);
                  const text = `${KIND_TEXT[s.kind]}: ${s.label}, ${when(s.start)} to ${when(s.end)}${s.note ? ` (${s.note})` : ""}`;
                  const style = { left: `${left}%`, width: `${Math.max(right - left, 1.5)}%`, top: s.kind === "leave" ? 5 : undefined };
                  return s.visitId
                    ? <a key={i} className="seg" data-kind={s.kind} href={`/visits/${s.visitId}`} style={style} title={text} aria-label={text}>{s.label}</a>
                    : <span key={i} className="seg" data-kind={s.kind} style={style} title={text} role="img" aria-label={text}>{s.label}</span>;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {rows.length === 0 && <p className="muted">No employees match these filters.</p>}
    </div>
  );
}
