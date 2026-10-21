import { session } from "@/server/session";
import { listProjects } from "@/server/queries/projects";
import { Badge, DemoTag } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";
import { NewProjectForm } from "@/components/project/ScopeForms";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const rows = await listProjects(db, actor, { search: sp.q?.slice(0, 60) || undefined });
  return (
    <>
      <PageHeader title="Projects" subtitle="Customer → location-based project → orders → order items → components → installation tasks. Only projects in your scope are listed."
        actions={actor.role === "manager" || actor.role === "admin" ? <a className="button" href="/projects/import">Import orders</a> : undefined} />
      {(actor.role === "manager" || actor.role === "admin") && <NewProjectForm customers={(await db.query<{ id: string; business_id: string; name: string }>("select id, business_id, name from customer order by business_id")).map((c) => ({ id: c.id, label: `${c.business_id} · ${c.name}` }))} />}
      <form className="row card no-print" role="search" aria-label="Search projects">
        <div className="field" style={{ minWidth: 260 }}><label htmlFor="p-q">Search by ID, project or customer</label><input id="p-q" name="q" defaultValue={sp.q ?? ""} /></div>
        <button type="submit" style={{ alignSelf: "flex-end" }}>Search</button>
      </form>
      {rows.length === 0 ? <Empty>No projects in your scope{sp.q ? " match that search" : ""}.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th className="pin">Project</th><th>Customer</th><th>Site</th><th>Manager</th><th className="num">Orders</th><th className="num">Open visits</th><th>Next visit</th><th>Status</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <th scope="row" className="pin" style={{ fontWeight: 400 }}><a href={`/projects/${p.id}`}>{p.business_id}</a><div className="small">{p.name}</div></th>
              <td>{p.customer} <span className="muted small">{p.customer_bid}</span></td><td>{p.city}</td><td>{p.manager ?? "None"}</td>
              <td className="num">{p.orders}</td><td className="num">{p.open_visits}</td><td>{p.next_visit ?? "None"}</td>
              <td><Badge state={p.status === "active" ? "scheduled" : p.status} label={p.status} /> {p.is_demo && <DemoTag />}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
