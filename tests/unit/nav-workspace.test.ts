/**
 * Menus per workspace (docs/plans/workspaces-design.md): the Factory side shows only factory work, the
 * Installation side keeps today's 8 groups, and a page is marked in the group whose tab fits it most closely.
 */
import { describe, expect, it } from "vitest";
import { activeGroup, activeTab, groupOwner, phoneSlots, visibleGroups, type Viewer } from "@/components/nav-config";

const FACTORY: Viewer = { role: "employee", flow: true, flowRoles: ["factory_dispatch"], ws: "factory" };
const ACCOUNTS: Viewer = { role: "employee", flow: true, flowRoles: ["accounts"], ws: "factory" };
const ADMIN_F: Viewer = { role: "admin", flow: false, flowRoles: [], ws: "factory" };
const IM: Viewer = { role: "manager", flow: true, flowRoles: ["installation_manager"], ws: "installation" };

const shape = (v: Viewer) => visibleGroups(v).map((g) => [g.id, g.tabs.map((t) => t.href)]);

describe("the Factory menu", () => {
  it("holds only factory work: Home, Dispatch, Complaints, Reports", () => {
    expect(shape(FACTORY)).toEqual([["home", ["/"]], ["fdispatch", ["/dispatch", "/dispatch/new"]], ["complaints", ["/complaints"]], ["reports", ["/reports"]]]);
  });
  it("shows Ready for dispatch only to the factory dispatch role", () => {
    expect(Object.fromEntries(shape(ACCOUNTS)).fdispatch).toEqual(["/dispatch"]);
  });
  it("adds Setup for administrators", () => {
    expect(visibleGroups(ADMIN_F).map((g) => g.id)).toEqual(["home", "fdispatch", "complaints", "reports", "setup"]);
  });
  it("puts Home, Dispatch, Complaints and Reports on the phone bar", () => {
    expect(phoneSlots(FACTORY, visibleGroups(FACTORY)).map((g) => g.id)).toEqual(["home", "fdispatch", "complaints", "reports"]);
  });
  it("never shows site pages", () => {
    const ids = visibleGroups(ADMIN_F).map((g) => g.id);
    for (const site of ["sites", "work", "inbox", "money", "people"]) expect(ids).not.toContain(site);
  });
});

describe("the most specific tab wins", () => {
  it("marks a complaint page under Complaints on the Factory side and under Dispatch on the Installation side", () => {
    expect(activeGroup(visibleGroups(FACTORY), "/dispatch/complaints/abc")?.id).toBe("complaints");
    expect(activeGroup(visibleGroups(IM), "/dispatch/complaints/abc")?.id).toBe("dispatch");
  });
  it("marks Ready for dispatch, not Dispatch, on its own page", () => {
    const g = activeGroup(visibleGroups(FACTORY), "/dispatch/new")!;
    expect(activeTab(g, "/dispatch/new")?.href).toBe("/dispatch/new");
    expect(activeTab(g, "/dispatch/x")?.href).toBe("/dispatch");
  });
});

describe("which side a page belongs to", () => {
  it("names the other side for pages that live only there, and none for shared pages", () => {
    expect(groupOwner("/installations", ADMIN_F)).toBe("installation");
    expect(groupOwner("/installations", FACTORY)).toBeNull(); // a factory employee cannot open it at all
    expect(groupOwner("/complaints", IM)).toBe("factory");
    expect(groupOwner("/dispatch/x", IM)).toBeNull();
    expect(groupOwner("/", FACTORY)).toBeNull();
    expect(groupOwner("/settings", FACTORY)).toBeNull();
  });
});
