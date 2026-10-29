/**
 * Factory and Installation workspaces (docs/plans/workspaces-design.md, decisions of 28 Oct 2026): who may open
 * which side, where each person lands, and that demo mode gives everyone the switch while the app is being built.
 */
import { describe, expect, it } from "vitest";
import { defaultWorkspace, parseWorkspace, resolveWorkspace, workspacesFor, type WsPerson } from "@/lib/workspace";

const CREW: WsPerson = { role: "employee", flowRoles: [] };
const SUPERVISOR: WsPerson = { role: "supervisor", flowRoles: [] };
const IM: WsPerson = { role: "manager", flowRoles: ["installation_manager"] };
const FACTORY: WsPerson = { role: "employee", flowRoles: ["factory_dispatch"] };
const ACCOUNTS: WsPerson = { role: "employee", flowRoles: ["accounts"] };
const MANAGEMENT: WsPerson = { role: "manager", flowRoles: ["management"] };
const ADMIN: WsPerson = { role: "admin", flowRoles: [] };

describe("who may open which workspace (real use)", () => {
  it("gives crew, supervisors and Installation Managers the Installation side only", () => {
    for (const p of [CREW, SUPERVISOR, IM]) expect(workspacesFor(p, false)).toEqual(["installation"]);
  });
  it("gives factory departments the Factory side only", () => {
    for (const p of [FACTORY, ACCOUNTS]) expect(workspacesFor(p, false)).toEqual(["factory"]);
  });
  it("gives management and admins both, with the switch", () => {
    for (const p of [MANAGEMENT, ADMIN]) expect(workspacesFor(p, false)).toEqual(["installation", "factory"]);
  });
  it("gives a supervisor who also holds a factory role both", () => {
    expect(workspacesFor({ role: "supervisor", flowRoles: ["qc"] }, false)).toEqual(["installation", "factory"]);
  });
});

describe("while the app is being built (demo mode)", () => {
  it("gives everyone both sides so the owner can try each", () => {
    for (const p of [CREW, IM, FACTORY, ADMIN]) expect(workspacesFor(p, true)).toEqual(["installation", "factory"]);
  });
});

describe("where each person lands", () => {
  it("opens management in Factory, factory departments in Factory, everyone else in Installation", () => {
    expect(defaultWorkspace(MANAGEMENT)).toBe("factory");
    expect(defaultWorkspace(FACTORY)).toBe("factory");
    for (const p of [CREW, SUPERVISOR, IM, ADMIN]) expect(defaultWorkspace(p)).toBe("installation");
  });
  it("remembers the chosen side only when the person may open it", () => {
    expect(resolveWorkspace("factory", ADMIN, false)).toBe("factory");
    expect(resolveWorkspace("factory", IM, false)).toBe("installation");
    expect(resolveWorkspace("factory", IM, true)).toBe("factory");
    expect(resolveWorkspace("installation", FACTORY, false)).toBe("factory");
    expect(resolveWorkspace(undefined, MANAGEMENT, false)).toBe("factory");
    expect(resolveWorkspace("nonsense", CREW, true)).toBe("installation");
  });
  it("parses only the two known values", () => {
    expect(parseWorkspace("factory")).toBe("factory");
    expect(parseWorkspace("installation")).toBe("installation");
    expect(parseWorkspace("FACTORY")).toBeNull();
    expect(parseWorkspace(undefined)).toBeNull();
  });
});
