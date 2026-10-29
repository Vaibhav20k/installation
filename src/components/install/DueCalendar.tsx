"use client";
/**
 * Handover calendar beside the plan list. Each marked date carries a short count chip ("2 due", "1 late") so a busy
 * day never clutters; hovering, focusing or tapping a date opens the list of installations due that day. Late
 * installations (past their handover date, unfinished) are red and blink gently, static under reduced motion.
 * Month changes happen in the browser from data already loaded, so moving between months is instant.
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CaretLeft, CaretRight, WarningCircle } from "@phosphor-icons/react";

export interface DueItem { visit_id: string; due: string; late: boolean; days_late: number; customer: string; name: string; project: string; visit: string; status: string }

const WD = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const nice = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]!.slice(0, 3)}`;

export function DueCalendar({ items, today }: { items: DueItem[]; today: string }) {
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [dir, setDir] = useState<"next" | "prev" | "none">("none");
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const leave = useRef<number | undefined>(undefined);

  const byDate = useMemo(() => {
    const map = new Map<string, DueItem[]>();
    for (const i of items) map.set(i.due, [...(map.get(i.due) ?? []), i]);
    return map;
  }, [items]);
  const late = items.filter((i) => i.late).sort((a, b) => a.due.localeCompare(b.due));

  const first = new Date(Date.UTC(ym.y, ym.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(ym.y, ym.m, i + 1))];
  while (cells.length % 7) cells.push(null);
  const monthKey = `${ym.y}-${ym.m}`;
  const inMonth = items.filter((i) => i.due.startsWith(iso(ym.y, ym.m, 1).slice(0, 7)));

  const go = (n: number, to?: { y: number; m: number }) => {
    setDir(n > 0 ? "next" : "prev");
    setPinned(null); setHover(null);
    setYm(to ?? (({ y, m }) => { const d = new Date(Date.UTC(y, m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; })(ym));
  };
  const open = pinned ?? hover;
  const openList = open ? byDate.get(open) ?? [] : [];
  const enter = (d: string) => { window.clearTimeout(leave.current); setHover(d); };
  const exit = () => { leave.current = window.setTimeout(() => setHover(null), 160); };

  return (
    <section className="due-cal" aria-labelledby="h-due-cal">
      <div className="due-cal-head">
        <h2 id="h-due-cal">Handovers due</h2>
        <div className="due-cal-nav">
          <button type="button" onClick={() => go(-1)} aria-label="Previous month"><CaretLeft size={16} weight="bold" aria-hidden /></button>
          <button type="button" className="due-month" onClick={() => go(0, { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })} title="Back to this month">{MONTHS[ym.m]} {ym.y}</button>
          <button type="button" onClick={() => go(1)} aria-label="Next month"><CaretRight size={16} weight="bold" aria-hidden /></button>
        </div>
      </div>
      <p className="due-cal-sum" aria-live="polite">
        {inMonth.length ? `${inMonth.length} due in ${MONTHS[ym.m]}` : `Nothing due in ${MONTHS[ym.m]}`}
        {late.length > 0 && <> · <button type="button" className="due-late-link" onClick={() => { const d = late[0]!.due; go(0, { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1 }); setPinned(d); }}><WarningCircle size={14} weight="fill" aria-hidden /> {late.length} late</button></>}
      </p>
      <div className="due-grid due-wd" aria-hidden>{WD.map((w, i) => <span key={i}>{w}</span>)}</div>
      <div key={monthKey} className="due-grid due-days" data-dir={dir} aria-label={`${MONTHS[ym.m]} ${ym.y}`} role="group">
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} className="due-cell" data-empty aria-hidden />;
          const list = byDate.get(d) ?? [];
          const lateN = list.filter((x) => x.late).length;
          const label = `${nice(d)}${list.length ? `: ${list.length} handover${list.length === 1 ? "" : "s"} due${lateN ? `, ${lateN} late` : ""}` : ""}`;
          return (
            <button key={d} type="button" className="due-cell" aria-label={label} aria-pressed={pinned === d}
              data-today={d === today || undefined} data-marked={list.length > 0 || undefined} data-late={lateN > 0 || undefined} data-open={open === d || undefined}
              onMouseEnter={() => list.length && enter(d)} onMouseLeave={exit} onFocus={() => list.length && setHover(d)} onBlur={exit}
              onClick={() => list.length && setPinned(pinned === d ? null : d)}>
              <span className="due-num">{Number(d.slice(8))}</span>
              {list.length > 0 && <span className="due-chip">{lateN ? `${lateN} late` : `${list.length} due`}</span>}
            </button>
          );
        })}
      </div>
      <div className="due-pop" data-show={!!open && openList.length > 0} onMouseEnter={() => window.clearTimeout(leave.current)} onMouseLeave={exit} aria-live="polite">
        {open && openList.length > 0 && (
          <>
            <div className="due-pop-head"><strong>{nice(open)}</strong><span>{openList.length} installation{openList.length === 1 ? "" : "s"}</span></div>
            <ul>
              {openList.map((i) => (
                <li key={i.visit_id} data-late={i.late || undefined}>
                  <Link href={`/installations/${i.visit_id}`}>
                    <span className="due-pop-title">{i.name}</span>
                    <span className="due-pop-meta">{i.customer} · {i.visit} · {i.project}</span>
                    {i.late ? <span className="due-pop-late">Late by {i.days_late} day{i.days_late === 1 ? "" : "s"}</span> : <span className="due-pop-meta">{i.status.replace("_", " ")}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <ul className="due-legend" aria-label="Legend">
        <li><span className="due-chip">2 due</span> handovers due that day</li>
        <li><span className="due-chip" data-late>1 late</span> past due, not finished</li>
      </ul>
    </section>
  );
}
