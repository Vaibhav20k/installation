/**
 * The workspace this request shows (docs/plans/workspaces-design.md): the remembered side if the person may open
 * it, otherwise their default. Demo mode gives everyone both sides while the app is being built.
 */
import { cookies } from "next/headers";
import type { Db } from "@/server/db/client";
import type { Actor } from "@/server/auth/permissions";
import { getSetting } from "@/server/services/context";
import { actorRoles } from "@/server/services/flow-core";
import { WORKSPACE_COOKIE, resolveWorkspace, workspacesFor, type Workspace } from "@/lib/workspace";

export interface WorkspaceView { current: Workspace; available: Workspace[]; flowRoles: string[]; demo: boolean }

export async function workspaceOf(db: Db, actor: Actor): Promise<WorkspaceView> {
  const [demo, flowRoles, jar] = await Promise.all([getSetting(db, "demo_mode", false), actorRoles(db, actor.id), cookies()]);
  const person = { role: actor.role, flowRoles };
  return { current: resolveWorkspace(jar.get(WORKSPACE_COOKIE)?.value, person, demo), available: workspacesFor(person, demo), flowRoles, demo };
}
