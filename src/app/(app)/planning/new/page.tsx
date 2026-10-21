import { session } from "@/server/session";
import { listProjects } from "@/server/queries/projects";
import { PageHeader, Notice } from "@/components/ui/Notice";
import { NewPlanForm } from "@/components/planning/NewPlanForm";

export const metadata = { title: "New plan" };

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  if (actor.role === "employee") return <Notice tone="warn" title="Not permitted">Only supervisors and above draft plans.</Notice>;
  const projects = await listProjects(db, actor);
  const orders = await db.query<{ id: string; business_id: string; project_id: string; status: string }>(
    "select id, business_id, project_id, status from sales_order where project_id = any($1::uuid[]) order by business_id", [projects.map((p) => p.id)]);
  return (
    <>
      <PageHeader title="New plan" subtitle="Step 1 of the plan wizard: choose the location-based project, its orders and the visit. Scope, estimate, skills, team and expenses follow on the visit page." />
      <NewPlanForm projects={projects.map((p) => ({ id: p.id, label: `${p.business_id} · ${p.name} (${p.customer_bid})` }))} orders={orders} defaultProject={sp.project} />
    </>
  );
}
