"use client";
import Link, { useLinkStatus } from "next/link";
/**
 * Navigation in two forms from one list: a graphite index rail on desktop and a thumb-reach
 * bottom bar on phones, with the rest of the catalogue in a "More" sheet. Counts show each
 * section's open extent (the tab-board discipline).
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ChartBar, CalendarDots, Clock, ClockCountdown, Cube, DotsNine, GearSix, HardHat, IdentificationCard, Kanban, ListChecks, Receipt, SealCheck, SquaresFour, Tray, UsersThree, type Icon,
} from "@phosphor-icons/react";

interface Item { href: string; label: string; short: string; icon: Icon; staff?: boolean; admin?: boolean }

const ITEMS: Item[] = [
  { href: "/installations", label: "Installations", short: "Sites", icon: Kanban, staff: true },
  { href: "/", label: "Dashboard", short: "Overview", icon: SquaresFour },
  { href: "/my-day", label: "My day", short: "Today", icon: HardHat },
  { href: "/attendance", label: "My attendance", short: "Attendance", icon: ClockCountdown },
  { href: "/my-tasks", label: "My tasks", short: "Tasks", icon: ListChecks },
  { href: "/requests", label: "My requests", short: "Requests", icon: Tray },
  { href: "/planning", label: "Planning", short: "Plan", icon: CalendarDots, staff: true },
  { href: "/approvals", label: "Approvals", short: "Approve", icon: SealCheck, staff: true },
  { href: "/projects", label: "Projects", short: "Projects", icon: Cube },
  { href: "/timesheets", label: "Timesheets", short: "Time", icon: Clock },
  { href: "/people", label: "People & Skills", short: "People", icon: UsersThree },
  { href: "/skill-cards", label: "Skill cards", short: "Cards", icon: IdentificationCard, admin: true },
  { href: "/expenses", label: "Expenses", short: "Expenses", icon: Receipt },
  { href: "/reports", label: "Reports", short: "Reports", icon: ChartBar },
  { href: "/settings", label: "Settings", short: "Settings", icon: GearSix },
];

// Phone bar: the four most frequent actions for the role, then More.
const PRIMARY_STAFF = ["/installations", "/", "/planning", "/approvals"];
const PRIMARY_CREW = ["/my-day", "/attendance", "/my-tasks", "/requests"];

/** Instant feedback on the tapped tab while the next screen streams in (no placeholder screen). */
function Pending() {
  const { pending } = useLinkStatus();
  return <span className={pending ? "nav-pending on" : "nav-pending"} aria-hidden />;
}

function useNav(role: string) {
  const path = usePathname();
  const isCurrent = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`) || (href === "/planning" && path.startsWith("/visits")));
  // Navigation only mirrors permissions; every page and action checks them again on the server.
  const visible = ITEMS.filter((i) => (!i.staff || role !== "employee") && (!i.admin || role === "admin"));
  return { path, isCurrent, visible };
}

export function RailNav({ role, counts }: { role: string; counts: Record<string, number> }) {
  const { isCurrent, visible } = useNav(role);
  return (
    <nav aria-label="Sections">
      {visible.map((i) => (
        <Link key={i.href} href={i.href} aria-current={isCurrent(i.href) ? "page" : undefined}>
          <Pending /><i.icon size={19} weight={isCurrent(i.href) ? "fill" : "regular"} aria-hidden />
          <span>{i.label}</span>
          {(counts[i.href] ?? 0) > 0 ? <span className="count">{counts[i.href]}</span> : <span />}
        </Link>
      ))}
    </nav>
  );
}

export function TabBar({ role, counts, identity }: { role: string; counts: Record<string, number>; identity: React.ReactNode }) {
  const { path, isCurrent, visible } = useNav(role);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const primary = (role === "employee" ? PRIMARY_CREW : PRIMARY_STAFF).map((h) => visible.find((i) => i.href === h)).filter((i): i is Item => !!i);
  const rest = visible.filter((i) => !primary.includes(i));
  const moreActive = rest.some((i) => isCurrent(i.href));
  const count = (href: string) => counts[href] ?? 0;
  return (
    <>
      <nav aria-label="Primary" className="tabbar">
        {primary.map((i) => (
          <Link key={i.href} href={i.href} aria-current={isCurrent(i.href) ? "page" : undefined}>
            <Pending /><i.icon size={23} weight={isCurrent(i.href) ? "fill" : "regular"} aria-hidden />
            <span>{i.short}</span>
            {count(i.href) > 0 && <span className="count" aria-label={`${count(i.href)} waiting`}>{count(i.href)}</span>}
          </Link>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more}>
          <DotsNine size={23} weight={moreActive ? "fill" : "regular"} aria-hidden />
          <span>More</span>
        </button>
      </nav>
      {more && (
        <>
          <div className="sheet-backdrop" onClick={() => setMore(false)} aria-hidden />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More sections" onKeyDown={(e) => e.key === "Escape" && setMore(false)}>
            <div className="grabber" aria-hidden />
            <nav aria-label="More sections">
              {rest.map((i, n) => (
                <Link key={i.href} href={i.href} aria-current={isCurrent(i.href) ? "page" : undefined} autoFocus={n === 0}>
                  <Pending /><i.icon size={22} aria-hidden />
                  {i.label}
                  {count(i.href) > 0 && <span className="count">{count(i.href)}</span>}
                </Link>
              ))}
            </nav>
            <div className="identity">{identity}</div>
          </div>
        </>
      )}
    </>
  );
}
