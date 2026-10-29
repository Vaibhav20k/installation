/**
 * The shorter menu (request of 28 Oct 2026): 15 sections merged into 8 groups, every old URL kept and reachable
 * as a tab inside exactly one group, and nobody shown a tab they cannot open.
 */
import { describe, expect, it } from "vitest";
import { GROUPS, activeGroup, groupCount, groupHref, isTabCurrent, phoneSlots, visibleGroups, type Viewer } from "@/components/nav-config";

const CREW: Viewer = { role: "employee", flow: false };
const DEPT: Viewer = { role: "employee", flow: true };
const SUPERVISOR: Viewer = { role: "supervisor", flow: false };
const IM: Viewer = { role: "manager", flow: true };
const MANAGER: Viewer = { role: "manager", flow: false };
const ADMIN: Viewer = { role: "admin", flow: false };

const OLD_URLS = ["/", "/installations", "/planning", "/visits/abc", "/projects", "/dispatch", "/dispatch/x/complaints/y", "/my-day", "/my-tasks", "/attendance", "/approvals", "/requests", "/timesheets", "/expenses", "/people", "/skill-cards", "/reports"];

const shape = (v: Viewer) => visibleGroups(v).map((g) => [g.id, g.tabs.map((t) => t.href)]);

describe("visible groups and tabs per person", () => {
  it("shows at most 8 groups, in the agreed order", () => {
    expect(GROUPS.map((g) => g.label)).toEqual(["Home", "Sites", "Dispatch", "My work", "Inbox", "Time & money", "People", "Reports"]);
    for (const v of [CREW, DEPT, SUPERVISOR, IM, MANAGER, ADMIN]) expect(visibleGroups(v).length).toBeLessThanOrEqual(8);
  });
  it("admins see every group and every tab", () => {
    expect(shape(ADMIN)).toEqual([
      ["home", ["/"]],
      ["sites", ["/installations", "/planning", "/projects"]],
      ["dispatch", ["/dispatch"]],
      ["work", ["/my-day", "/my-tasks", "/attendance"]],
      ["inbox", ["/approvals", "/requests"]],
      ["money", ["/timesheets", "/expenses"]],
      ["people", ["/people", "/skill-cards"]],
      ["reports", ["/reports"]],
    ]);
  });
  it("crew keep Projects but not the staff-only pages, Dispatch, Approvals or Skill cards", () => {
    expect(shape(CREW)).toEqual([
      ["home", ["/"]],
      ["sites", ["/projects"]],
      ["work", ["/my-day", "/my-tasks", "/attendance"]],
      ["inbox", ["/requests"]],
      ["money", ["/timesheets", "/expenses"]],
      ["people", ["/people"]],
      ["reports", ["/reports"]],
    ]);
  });
  it("department staff with a flow role also get Dispatch", () => {
    expect(visibleGroups(DEPT).map((g) => g.id)).toContain("dispatch");
    expect(visibleGroups(CREW).map((g) => g.id)).not.toContain("dispatch");
  });
  it("supervisors and managers see the staff pages; Dispatch only with a flow role", () => {
    for (const v of [SUPERVISOR, MANAGER]) {
      const s = Object.fromEntries(shape(v));
      expect(s.sites).toEqual(["/installations", "/planning", "/projects"]);
      expect(s.inbox).toEqual(["/approvals", "/requests"]);
      expect(s.people).toEqual(["/people"]);
      expect(s.dispatch).toBeUndefined();
    }
    expect(Object.fromEntries(shape(IM)).dispatch).toEqual(["/dispatch"]);
  });
});

describe("every old URL still has a home", () => {
  it("maps to exactly one group, with exactly one current tab", () => {
    for (const url of OLD_URLS) {
      const owners = GROUPS.filter((g) => g.tabs.some((t) => isTabCurrent(t, url)));
      expect(owners, url).toHaveLength(1);
      expect(owners[0]!.tabs.filter((t) => isTabCurrent(t, url)), url).toHaveLength(1);
    }
  });
  it("marks the right group current, including visits under Planning", () => {
    const g = visibleGroups(ADMIN);
    expect(activeGroup(g, "/")?.id).toBe("home");
    expect(activeGroup(g, "/visits/abc")?.id).toBe("sites");
    expect(activeGroup(g, "/dispatch/x")?.id).toBe("dispatch");
    expect(activeGroup(g, "/requests")?.id).toBe("inbox");
    expect(activeGroup(g, "/settings")).toBeUndefined();
    expect(activeGroup(g, "/installationsx")).toBeUndefined();
  });
  it("opens a group on its first tab the person can see", () => {
    expect(groupHref(visibleGroups(ADMIN).find((g) => g.id === "inbox")!)).toBe("/approvals");
    expect(groupHref(visibleGroups(CREW).find((g) => g.id === "inbox")!)).toBe("/requests");
    expect(groupHref(visibleGroups(CREW).find((g) => g.id === "sites")!)).toBe("/projects");
  });
});

describe("badges and the phone bar", () => {
  it("sums the counts of the tabs the person can see", () => {
    const counts = { "/approvals": 3, "/requests": 2, "/timesheets": 1 };
    expect(groupCount(visibleGroups(ADMIN).find((g) => g.id === "inbox")!, counts)).toBe(5);
    expect(groupCount(visibleGroups(CREW).find((g) => g.id === "inbox")!, counts)).toBe(2);
    expect(groupCount(visibleGroups(CREW).find((g) => g.id === "money")!, counts)).toBe(1);
  });
  it("gives each kind of person four slots from their own groups", () => {
    const slots = (v: Viewer) => phoneSlots(v, visibleGroups(v)).map((g) => g.id);
    expect(slots(IM)).toEqual(["sites", "dispatch", "inbox", "home"]);
    expect(slots(ADMIN)).toEqual(["sites", "dispatch", "inbox", "home"]);
    expect(slots(SUPERVISOR)).toEqual(["sites", "inbox", "home", "work"]);
    expect(slots(CREW)).toEqual(["work", "money", "inbox", "people"]);
    expect(slots(DEPT)).toEqual(["dispatch", "inbox", "work", "home"]);
  });
});
