/**
 * One list row on the Factory home: what the record is, how long it has waited, and either the viewer's one button
 * or a quiet "Waiting for ..." when the step belongs to someone else. Server component; reuses the `.pipe-row` look.
 */
import Link from "next/link";
import { CaretRight, Clock } from "@phosphor-icons/react/dist/ssr";
import { PriorityTag } from "@/components/dispatch/PriorityTag";
import type { FactoryRow } from "@/server/queries/factory-pipeline";

export const days = (n: number) => (n === 0 ? "since today" : `${n} day${n === 1 ? "" : "s"}`);

function Main({ r }: { r: FactoryRow }) {
  const body = (
    <>
      <span className="pipe-row-title">{r.title}</span>
      <span className="pipe-row-meta"><span className="code-tag">{r.code}</span> {r.what}</span>
      <span className="pipe-row-tags">
        {r.days !== null && <span className="pipe-age" data-overdue={r.overdue || undefined}><Clock size={13} aria-hidden /> {r.stage_label}, {days(r.days)}</span>}
        {r.overdue && <span className="pipe-flag" data-tone="bad">Overdue</span>}
        <PriorityTag priority={r.priority} />
      </span>
    </>
  );
  return r.href ? <Link className="pipe-row-main" href={r.href}>{body}</Link> : <div className="pipe-row-main">{body}</div>;
}

export function FactoryRowItem({ r }: { r: FactoryRow }) {
  return (
    <li className="pipe-row fac-row" data-overdue={r.overdue ? "" : undefined}>
      <Main r={r} />
      {r.action
        ? <Link className="button primary pipe-go" href={r.action.href}>{r.action.label}<CaretRight size={14} weight="bold" aria-hidden /></Link>
        : <span className="pipe-wait">{r.waiting}</span>}
    </li>
  );
}
