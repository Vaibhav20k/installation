import { session } from "@/server/session";
import { flowVisibility } from "@/server/services/flow-core";
import { factoryComplaints, parseQueueFilter } from "@/server/queries/factory-pipeline";
import { Notice, PageHeader } from "@/components/ui/Notice";
import { ComplaintQueue } from "@/components/factory/ComplaintQueue";

export const metadata = { title: "Complaints" };

/** The factory's Complaints queue: phase chips, then the detailed steps inside the phase. Same scope as Dispatch. */
export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<{ phase?: string; show?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const vis = await flowVisibility(db, actor);
  if (!vis.all && !vis.roles.length && actor.role === "employee") return <Notice tone="warn" title="Not permitted">Dispatch and complaints are for department staff and installation managers.</Notice>;
  const list = await factoryComplaints(db, actor, Date.now());
  const { show, phase } = parseQueueFilter(sp, list);
  return (
    <div className="stack">
      <PageHeader title="Complaints" subtitle="Missing and damaged items, and the step each replacement is at. Tap one to open it." />
      <ComplaintQueue list={list} show={show} phase={phase} hasRoles={vis.roles.some((r) => r !== "installation_manager")} />
    </div>
  );
}
