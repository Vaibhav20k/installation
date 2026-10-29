/**
 * The menu as 8 groups instead of 15 sections (request of 28 Oct 2026). Pages that serve the same job share a
 * group and appear as tabs inside it; no URL moved. The rail, the phone bar and the section tabs all read this.
 * Two workspaces (docs/plans/workspaces-design.md): the Installation side keeps these 8 groups; the Factory side
 * shows only factory work. Navigation only mirrors permissions; every page and action checks them again on the server.
 */
import type { Workspace } from "@/lib/workspace";

export interface Viewer { role: string; flow: boolean; flowRoles?: string[]; ws?: Workspace }
type Who = (v: Viewer) => boolean;
export interface NavTab { href: string; label: string; match: string[]; who?: Who }
export interface NavGroup { id: string; label: string; short: string; tabs: NavTab[]; who?: Who }

const staff: Who = (v) => v.role !== "employee";
const admin: Who = (v) => v.role === "admin";
const flow: Who = (v) => v.flow || v.role === "admin";
const sender: Who = (v) => !!v.flowRoles?.includes("factory_dispatch");
const tab = (href: string, label: string, who?: Who, also: string[] = []): NavTab => ({ href, label, match: [href, ...also], who });

export const GROUPS: NavGroup[] = [
  { id: "home", label: "Home", short: "Home", tabs: [tab("/", "Overview")] },
  // Which job, where, when, with whom: the site list, the crew timeline that staffs it, the order record behind it.
  { id: "sites", label: "Sites", short: "Sites", tabs: [tab("/installations", "Installations", staff), tab("/planning", "Planning", staff, ["/visits"]), tab("/projects", "Projects")] },
  { id: "dispatch", label: "Dispatch", short: "Dispatch", who: flow, tabs: [tab("/dispatch", "Dispatch")] },
  // One person's day: today, what's booked ahead, clock-in history.
  { id: "work", label: "My work", short: "Today", tabs: [tab("/my-day", "My day"), tab("/my-tasks", "My tasks"), tab("/attendance", "Attendance")] },
  // Requests waiting on someone, both directions.
  { id: "inbox", label: "Inbox", short: "Inbox", tabs: [tab("/approvals", "To approve", staff), tab("/requests", "My requests")] },
  // Time and money recorded against work; both go to approval.
  { id: "money", label: "Time & money", short: "Time", tabs: [tab("/timesheets", "Timesheets"), tab("/expenses", "Expenses")] },
  { id: "people", label: "People", short: "People", tabs: [tab("/people", "People & Skills"), tab("/skill-cards", "Skill cards", admin)] },
  { id: "reports", label: "Reports", short: "Reports", tabs: [tab("/reports", "Reports")] },
];

/** The Factory side: what to send, and the replacements to make. */
export const FACTORY_GROUPS: NavGroup[] = [
  { id: "home", label: "Home", short: "Home", tabs: [tab("/", "Overview")] },
  { id: "fdispatch", label: "Dispatch", short: "Dispatch", who: flow, tabs: [tab("/dispatch", "Dispatch"), tab("/dispatch/new", "Ready for dispatch", sender)] },
  { id: "complaints", label: "Complaints", short: "Complaints", who: flow, tabs: [tab("/complaints", "Complaints", undefined, ["/dispatch/complaints"])] },
  { id: "reports", label: "Reports", short: "Reports", tabs: [tab("/reports", "Reports")] },
  { id: "setup", label: "Setup", short: "Setup", tabs: [tab("/dispatch/setup", "Dispatch setup", admin)] },
];

export const SETTINGS_HREF = "/settings";

/** How closely a tab fits the page: the length of its matching path, or -1. The closest tab wins. */
function fit(t: NavTab, path: string) {
  return Math.max(-1, ...t.match.map((m) => (m === "/" ? (path === "/" ? 1 : -1) : path === m || path.startsWith(`${m}/`) ? m.length : -1)));
}

export const isTabCurrent = (t: NavTab, path: string) => fit(t, path) >= 0;

export function visibleGroups(v: Viewer): NavGroup[] {
  return (v.ws === "factory" ? FACTORY_GROUPS : GROUPS).filter((g) => !g.who || g.who(v))
    .map((g) => ({ ...g, tabs: g.tabs.filter((t) => !t.who || t.who(v)) }))
    .filter((g) => g.tabs.length > 0);
}

const best = <T>(items: T[], score: (x: T) => number) => {
  let top: T | undefined, s = -1;
  for (const x of items) { const n = score(x); if (n > s) { s = n; top = x; } }
  return top;
};

export const activeTab = (g: NavGroup, path: string) => best(g.tabs, (t) => fit(t, path));
export const activeGroup = (groups: NavGroup[], path: string) => best(groups, (g) => Math.max(...g.tabs.map((t) => fit(t, path))));

/** The other workspace, when this page lives only there (so the app can switch to show it); otherwise null. */
export function groupOwner(path: string, v: Viewer): Workspace | null {
  if (activeGroup(visibleGroups(v), path)) return null;
  const other: Workspace = v.ws === "factory" ? "installation" : "factory";
  return activeGroup(visibleGroups({ ...v, ws: other }), path) ? other : null;
}
export const groupHref = (g: NavGroup) => g.tabs[0]!.href;
export const groupCount = (g: NavGroup, counts: Record<string, number>) => g.tabs.reduce((n, t) => n + (counts[t.href] ?? 0), 0);

// Phone bar: the four most frequent groups for the kind of person, then More.
const SLOTS_STAFF = ["sites", "dispatch", "inbox", "home", "work"];
const SLOTS_CREW = ["work", "money", "inbox", "people"];
const SLOTS_DEPT = ["dispatch", "inbox", "work", "home"];
const SLOTS_FACTORY = ["home", "fdispatch", "complaints", "reports", "setup"];

export function phoneSlots(v: Viewer, groups: NavGroup[]) {
  const order = v.ws === "factory" ? SLOTS_FACTORY : v.role !== "employee" ? SLOTS_STAFF : v.flow ? SLOTS_DEPT : SLOTS_CREW;
  return order.map((id) => groups.find((g) => g.id === id)).filter((g): g is NavGroup => !!g).slice(0, 4);
}
