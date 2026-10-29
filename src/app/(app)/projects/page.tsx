import Link from "next/link";
import { session } from "@/server/session";
import { listProjects } from "@/server/queries/projects";
import { DemoTag } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";
import { NewProjectForm } from "@/components/project/ScopeForms";
import { ProjectCards, ProjectStatus, ProjectViewSwitch } from "@/components/project/ProjectCards";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const q = sp.q?.slice(0, 60) || undefined;
  const view = sp.view === "list" ? "list" : "cards";
  const rows = await listProjects(db, actor, { search: q });
  return (
    <>
      <PageHeader title="Projects" subtitle="Each project is one customer site, with its orders, visits and team. You see only the projects you work on."
        actions={actor.role === "manager" || actor.role === "admin" ? <Link className="button" href="/projects/import">Import orders</Link> : undefined} />
      {(actor.role === "manager" || actor.role === "admin") && <NewProjectForm customers={(await db.query<{ id: string; business_id: string; name: string }>("select id, business_id, name from customer order by business_id")).map((c) => ({ id: c.id, label: `${c.business_id} · ${c.name}` }))} />}
      <form className="row card no-print projects-search" role="search" aria-label="Search projects">
        {view === "list" && <input type="hidden" name="view" value="list" />}
        <div className="field"><label htmlFor="p-q">Search by customer, project or ID</label><input id="p-q" name="q" defaultValue={sp.q ?? ""} /></div>
        <button type="submit">Search</button>
      </form>
      <div className="overview-bar">
        <ProjectViewSwitch view={view} q={q} />
        <span className="range-note">{rows.length} project{rows.length === 1 ? "" : "s"}{q ? ` matching “${q}”` : ""}</span>
      </div>
      {rows.length === 0 ? <Empty>No projects in your scope{sp.q ? " match that search" : ""}.</Empty> : view === "cards" ? <ProjectCards rows={rows} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th className="pin">Project</th><th>Customer</th><th>Site</th><th>Manager</th><th className="num">Orders</th><th className="num">Open visits</th><th>Next visit</th><th>Status</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <th scope="row" className="pin" style={{ fontWeight: 400 }}><Link href={`/projects/${p.id}`}>{p.business_id}</Link><div className="small">{p.name}</div></th>
              <td>{p.customer} <span className="muted small">{p.customer_bid}</span></td><td>{p.city}</td><td>{p.manager ?? "None"}</td>
              <td className="num">{p.orders}</td><td className="num">{p.open_visits}</td><td>{p.next_visit ?? "None"}</td>
              <td><ProjectStatus status={p.status} /> {p.is_demo && <DemoTag />}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
