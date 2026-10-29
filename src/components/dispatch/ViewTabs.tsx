"use client";
/**
 * The list page's views (All open, Complaints, My steps, My team, Dashboard) as pill buttons with a count badge. Dispatch is a
 * single page, so these are its primary controls: 44px targets, a filled active state, and a strip that scrolls
 * sideways on a phone instead of wrapping or widening the page. On load the active button is scrolled into the
 * strip (sideways only), so a phone never opens on a view whose button is off screen.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";

/** `unit` is what the count means to a screen reader ("waiting" by default, "open" for complaints). */
export interface ViewTab { id: string; label: string; href: string; n?: number; alert?: boolean; unit?: string }

export function ViewTabs({ items, current }: { items: ViewTab[]; current: string }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = nav.current;
    const on = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !on) return;
    const left = on.offsetLeft; // .flow-views is position: relative, so this is measured from the strip
    if (left < el.scrollLeft || left + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = left - 16;
  }, [current]);
  return (
    <nav ref={nav} className="flow-views" aria-label="Dispatch views">
      {items.map((t) => (
        <Link key={t.id} href={t.href} aria-current={t.id === current ? "page" : undefined}>
          {t.label}
          {t.n !== undefined && (
            <span className="flow-views-n" data-alert={t.alert || undefined}>
              {t.n}<span className="sr-only"> {t.unit ?? "waiting"}{t.alert ? ", some overdue" : ""}</span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
