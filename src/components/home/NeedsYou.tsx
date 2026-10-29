/**
 * "Needs you" on the Overview: one square card per open item, the whole card is the link to where you act.
 * A card past its due date carries an "Overdue" stamp (text, not colour alone) and a slow red pulse where
 * motion is allowed; under reduced motion it stays a static red card.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";

export interface Need { href: string; n: number; label: string; meta: string; icon: ReactNode; overdue?: boolean }

export function NeedsYou({ items, crew }: { items: Need[]; crew?: boolean }) {
  const late = items.filter((i) => i.overdue).length;
  return (
    <section className="plate home-needs" aria-labelledby="h-needs">
      <div className="plate-head">
        <h2 id="h-needs" style={{ margin: 0 }}>Needs you</h2>
        <span className="code-tag">{items.length} open{late ? ` · ${late} overdue` : ""}</span>
      </div>
      {items.length === 0 ? (
        <p className="home-allclear"><CheckCircle size={22} weight="fill" aria-hidden />
          {crew ? "Nothing needs you right now." : "Nothing is waiting on you. Decisions, staffing conflicts, clearance blockers and late handovers appear here first."}</p>
      ) : (
        <ul className="need-grid">
          {items.map((c) => (
            <li key={c.href}>
              <Link className="need-card" href={c.href} data-overdue={c.overdue ? "" : undefined}>
                <span className="need-top">
                  <span className="need-ico" aria-hidden>{c.icon}</span>
                  {c.overdue && <span className="need-late"><WarningCircle size={14} weight="fill" aria-hidden /> Overdue</span>}
                </span>
                <span className="need-n">{c.n}</span>
                <span className="need-label">{c.label}</span>
                <span className="need-meta">{c.meta}</span>
                <ArrowRight size={16} weight="bold" className="need-go" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
