/**
 * Factory and Installation workspaces (docs/plans/workspaces-design.md, decisions of 28 Oct 2026). One set of
 * records, two sides: each person works on the side of their job. The workspace only decides what is shown;
 * every page and action still checks rights on the server.
 */

export type Workspace = "installation" | "factory";
export const WORKSPACES: Workspace[] = ["installation", "factory"];
export const WORKSPACE_COOKIE = "im_workspace";
export const WORKSPACE_LABEL: Record<Workspace, string> = { installation: "Installation", factory: "Factory" };

/** Department roles that work in the factory or its office (every flow role except the Installation Manager). */
const FACTORY_ROLES = ["factory_dispatch", "accounts", "qc", "planning", "management", "store", "purchase", "production", "packaging"];

export interface WsPerson { role: string; flowRoles: string[] }

export const parseWorkspace = (v: string | undefined | null): Workspace | null => (v === "installation" || v === "factory" ? v : null);

/**
 * Which sides a person may open. While demo mode is on (the app is still being built), everyone gets both so the
 * owner can try each side with any demo identity.
 */
export function workspacesFor(p: WsPerson, demo: boolean): Workspace[] {
  if (demo || p.role === "admin" || p.flowRoles.includes("management")) return [...WORKSPACES];
  const factory = p.flowRoles.some((r) => FACTORY_ROLES.includes(r));
  const installation = !factory || p.role !== "employee" || p.flowRoles.includes("installation_manager");
  return WORKSPACES.filter((w) => (w === "factory" ? factory : installation));
}

/** Where a person opens: management and factory departments in Factory, everyone else in Installation. */
export function defaultWorkspace(p: WsPerson): Workspace {
  if (p.role === "admin") return "installation";
  if (p.flowRoles.includes("management")) return "factory";
  return workspacesFor(p, false).includes("installation") ? "installation" : "factory";
}

/** The remembered side if the person may open it, otherwise their default (or the only side they have). */
export function resolveWorkspace(cookie: string | undefined, p: WsPerson, demo: boolean): Workspace {
  const can = workspacesFor(p, demo);
  const chosen = parseWorkspace(cookie);
  if (chosen && can.includes(chosen)) return chosen;
  const d = defaultWorkspace(p);
  return can.includes(d) ? d : can[0]!;
}
