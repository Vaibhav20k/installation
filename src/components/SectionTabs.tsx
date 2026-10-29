"use client";
/**
 * The pages of the current menu group as tabs (for example Sites: Installations · Planning · Projects), shown
 * above every page of a group with more than one page the person can open. A pill slides to the active tab.
 */
import Link from "next/link";
import { useRef } from "react";
import { usePathname } from "next/navigation";
import { activeGroup, activeTab, visibleGroups, type Viewer } from "./nav-config";
import { useSlidingIndicator } from "./useSlidingIndicator";

export function SectionTabs({ viewer, counts }: { viewer: Viewer; counts: Record<string, number> }) {
  const path = usePathname();
  const group = activeGroup(visibleGroups(viewer), path);
  const active = group ? activeTab(group, path)?.href ?? null : null;
  const ref = useRef<HTMLElement>(null);
  useSlidingIndicator(ref, group && group.tabs.length > 1 ? active : null);
  if (!group || group.tabs.length < 2) return null;
  return (
    <nav className="section-tabs" aria-label={group.label} ref={ref}>
      <span className="ind" aria-hidden />
      {group.tabs.map((t) => (
        <Link key={t.href} href={t.href} data-key={t.href} aria-current={t.href === active ? "page" : undefined}>
          {t.label}
          {(counts[t.href] ?? 0) > 0 && <span key={counts[t.href]} className="count">{counts[t.href]}</span>}
        </Link>
      ))}
    </nav>
  );
}
