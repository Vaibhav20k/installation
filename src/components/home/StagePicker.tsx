"use client";
/**
 * Stage tiles that switch instantly (feedback of 28 Oct 2026: a tap reloaded the whole page and took seconds).
 * Every tile's list is rendered once on the server and handed in; a tap only swaps which list shows and updates
 * the address (?stage=) so the view can still be shared and survives a reload. Without JavaScript the tiles are
 * plain links and still work.
 */
import { useState, type ReactNode } from "react";

export interface StageTile { key: string; href: string; label: string; overdue: boolean; empty: boolean; body: ReactNode }

export function StagePicker({ initial, tiles, panels, navLabel, stripClass, bodyClass, listClass, aside, asideLabel }: {
  initial: string; tiles: StageTile[]; panels: Record<string, ReactNode>; navLabel: string; stripClass: string;
  bodyClass?: string; listClass: string; aside?: ReactNode; asideLabel?: string;
}) {
  const [sel, setSel] = useState(initial);
  const pick = (e: React.MouseEvent<HTMLAnchorElement>, key: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // let "open in new tab" work
    e.preventDefault();
    setSel(key);
    const u = new URL(window.location.href);
    u.searchParams.set("stage", key);
    window.history.replaceState(window.history.state, "", u);
  };
  const list = <div className={listClass} aria-live="polite"><div key={sel} className="pipe-panel">{panels[sel]}</div></div>;
  return (
    <>
      <nav aria-label={navLabel}>
        <ol className={stripClass}>
          {tiles.map((t) => (
            <li key={t.key}>
              <a className="pipe-tile" href={t.href} onClick={(e) => pick(e, t.key)} aria-current={t.key === sel ? "true" : undefined}
                data-overdue={t.overdue ? "" : undefined} data-empty={t.empty ? "" : undefined} aria-label={t.label}>
                {t.body}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {bodyClass ? <div className={bodyClass}>{list}{aside && <aside className="pipe-aside" aria-label={asideLabel}>{aside}</aside>}</div> : list}
    </>
  );
}
