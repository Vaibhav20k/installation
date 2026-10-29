import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Inbox ordering (28 Oct 2026 review): whatever needs the viewer's decision sits at the top of the page, oldest
 * first; queues that hold only someone else's items follow; empty queues fold into one quiet line at the bottom.
 */
export interface QueueInfo {
  id: string;
  title: string;
  /** Singular and plural noun for the summary chip, e.g. ["expense", "expenses"]. */
  noun: [string, string];
  /** Items this viewer can decide. */
  mine: number;
  /** Items shown in the queue, including ones the viewer cannot decide (their own, or manager-only). */
  items: number;
  /** Epoch ms of the oldest item the viewer can decide; Infinity when unknown. */
  oldest: number;
}

const rank = (q: QueueInfo) => (q.mine > 0 ? 0 : q.items > 0 ? 1 : 2);

export function sortQueues<T extends QueueInfo>(queues: T[]): T[] {
  return [...queues].sort((a, b) => rank(a) - rank(b) || a.oldest - b.oldest);
}

export const plural = (n: number, noun: [string, string]) => `${n} ${n === 1 ? noun[0] : noun[1]}`;

/** Compact "3 waiting for you" strip; each chip jumps to its queue. `base` is "" on /approvals, "/approvals" elsewhere. */
export function WaitingStrip({ queues, base = "", clearText = "Nothing is waiting for you. All clear." }: { queues: QueueInfo[]; base?: string; clearText?: string | null }) {
  const mine = sortQueues(queues).filter((q) => q.mine > 0);
  const total = mine.reduce((a, q) => a + q.mine, 0);
  if (total === 0) return clearText ? <p className="wait-strip" data-state="clear" role="status">{clearText}</p> : null;
  return (
    <nav className="wait-strip" data-state="waiting" aria-label="Waiting for you">
      <p className="wait-total"><span className="wait-n">{total}</span> waiting for you</p>
      <ul className="wait-chips">
        {mine.map((q) => {
          const label = plural(q.mine, q.noun);
          return <li key={q.id}>{base ? <Link className="wait-chip" href={`${base}#${q.id}`}>{label}</Link> : <a className="wait-chip" href={`#${q.id}`}>{label}</a>}</li>;
        })}
      </ul>
    </nav>
  );
}

/** One approval queue as a card. Count pill is loud only when the viewer has something to decide. */
export function Queue({ q, note, children }: { q: QueueInfo; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="card stack queue" id={q.id} aria-labelledby={`h-${q.id}`} data-mine={q.mine > 0 || undefined}>
      <div className="queue-head">
        <h2 id={`h-${q.id}`}>{q.title}</h2>
        <span className="queue-count" aria-label={q.mine > 0 ? `${q.mine} for you to decide` : `${q.items} waiting`}>
          {q.mine > 0 ? `${q.mine} for you` : q.items > 0 ? `${q.items} waiting on others` : "0"}
        </span>
      </div>
      {note}
      {children}
    </section>
  );
}

/** Empty queues collapse to a single quiet line instead of a card each. */
export function QuietQueues({ queues }: { queues: QueueInfo[] }) {
  if (queues.length === 0) return null;
  return (
    <p className="queue-quiet">
      <strong>Nothing waiting:</strong>{" "}
      {queues.map((q, i) => <span key={q.id} id={q.id}>{q.title}{i < queues.length - 1 ? " · " : ""}</span>)}
    </p>
  );
}
