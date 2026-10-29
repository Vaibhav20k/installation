"use client";
import Link, { useLinkStatus } from "next/link";
/**
 * Navigation in two forms from one list of 8 groups (nav-config.ts): a graphite rail on desktop with a sliding
 * marker, and a thumb-reach bottom bar on phones with the rest in a "More" sheet. Pages inside a group are tabs
 * (SectionTabs). A group's count is the sum of its pages' open work.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ChartBar, DotsNine, Factory, GearSix, HardHat, Kanban, SlidersHorizontal, SquaresFour, Tray, Truck, UsersThree, Wallet, WarningDiamond, type Icon,
} from "@phosphor-icons/react";
import { SETTINGS_HREF, activeGroup, groupCount, groupHref, phoneSlots, visibleGroups, type Viewer } from "./nav-config";
import { useSlidingIndicator } from "./useSlidingIndicator";

const ICONS: Record<string, Icon> = { home: SquaresFour, sites: Kanban, dispatch: Truck, work: HardHat, inbox: Tray, money: Wallet, people: UsersThree, reports: ChartBar,
  fdispatch: Factory, complaints: WarningDiamond, setup: SlidersHorizontal };

/** Instant feedback on the tapped tab while the next screen streams in. */
function Pending() {
  const { pending } = useLinkStatus();
  return <span className={pending ? "nav-pending on" : "nav-pending"} aria-hidden />;
}

/** A count that pops once when its value changes (keyed remount); it never loops. */
function Count({ n, label }: { n: number; label?: boolean }) {
  return n > 0 ? <span key={n} className="count" aria-label={label ? `${n} waiting` : undefined}>{n}</span> : null;
}

function useNav(viewer: Viewer) {
  const path = usePathname();
  const groups = visibleGroups(viewer);
  return { path, groups, current: activeGroup(groups, path)?.id ?? null };
}

export function RailNav({ viewer, counts }: { viewer: Viewer; counts: Record<string, number> }) {
  const { groups, current } = useNav(viewer);
  const ref = useRef<HTMLElement>(null);
  useSlidingIndicator(ref, current);
  return (
    <nav aria-label="Sections" ref={ref}>
      <span className="ind" aria-hidden />
      {groups.map((g) => {
        const I = ICONS[g.id]!, on = g.id === current;
        return (
          <Link key={g.id} href={groupHref(g)} data-key={g.id} aria-current={on ? "page" : undefined}>
            <Pending /><I size={19} weight={on ? "fill" : "regular"} aria-hidden />
            <span>{g.label}</span>
            <Count n={groupCount(g, counts)} />
          </Link>
        );
      })}
    </nav>
  );
}

/** Settings is rarely used, so it lives with the person's name instead of in the menu. */
export function SettingsLink() {
  const on = usePathname().startsWith(SETTINGS_HREF);
  return (
    <Link href={SETTINGS_HREF} className="settings-link" aria-current={on ? "page" : undefined}>
      <GearSix size={17} weight={on ? "fill" : "regular"} aria-hidden /> Settings
    </Link>
  );
}

export function TabBar({ viewer, counts, identity }: { viewer: Viewer; counts: Record<string, number>; identity: React.ReactNode }) {
  const { path, groups, current } = useNav(viewer);
  const [sheet, setSheet] = useState<"closed" | "open" | "closing">("closed");
  useEffect(() => setSheet("closed"), [path]);
  const primary = phoneSlots(viewer, groups);
  const rest = groups.filter((g) => !primary.includes(g));
  const moreActive = rest.some((g) => g.id === current);
  // The sheet leaves with a quick slide (180ms in motion.css), then unmounts.
  useEffect(() => {
    if (sheet !== "closing") return;
    const t = setTimeout(() => setSheet("closed"), 190);
    return () => clearTimeout(t);
  }, [sheet]);
  const close = () => setSheet((s) => (s === "open" ? "closing" : s));
  const closing = sheet === "closing" || undefined;
  return (
    <>
      <nav aria-label="Primary" className="tabbar">
        {primary.map((g) => {
          const I = ICONS[g.id]!, on = g.id === current;
          return (
            <Link key={g.id} href={groupHref(g)} aria-current={on ? "page" : undefined}>
              <Pending /><span className="tab-ico"><I size={23} weight={on ? "fill" : "regular"} aria-hidden /></span>
              <span>{g.short}</span>
              <Count n={groupCount(g, counts)} label />
            </Link>
          );
        })}
        <button type="button" onClick={() => setSheet("open")} aria-haspopup="dialog" aria-expanded={sheet === "open"} data-on={moreActive || undefined}>
          <span className="tab-ico"><DotsNine size={23} weight={moreActive ? "fill" : "regular"} aria-hidden /></span>
          <span>More</span>
        </button>
      </nav>
      {sheet !== "closed" && (
        <>
          <div className="sheet-backdrop" data-closing={closing} onClick={close} aria-hidden />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More sections" data-closing={closing}
            onKeyDown={(e) => e.key === "Escape" && close()}>
            <div className="grabber" aria-hidden />
            <nav aria-label="More sections">
              {rest.map((g, n) => {
                const I = ICONS[g.id]!, on = g.id === current;
                return (
                  <Link key={g.id} href={groupHref(g)} aria-current={on ? "page" : undefined} autoFocus={n === 0} style={{ "--i": n } as React.CSSProperties}>
                    <Pending /><I size={22} weight={on ? "fill" : "regular"} aria-hidden />
                    <span>{g.label}<span className="sheet-sub">{g.tabs.map((t) => t.label).join(" · ")}</span></span>
                    <Count n={groupCount(g, counts)} />
                  </Link>
                );
              })}
            </nav>
            <div className="identity">{identity}</div>
          </div>
        </>
      )}
    </>
  );
}
