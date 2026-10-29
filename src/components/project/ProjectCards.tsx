import Link from "next/link";
/** Project list as site plates (same look as the installation site cards), plus the Cards | List switch. */
import { CaretRight, ListBullets, MapPin, SquaresFour } from "@phosphor-icons/react/dist/ssr";
import { shortDate } from "@/domain/install-schedule";
import { Badge, DemoTag } from "@/components/ui/Badge";

export interface ProjectCardRow {
  id: string; business_id: string; name: string; city: string; site_address: string; status: string; customer: string; customer_bid: string;
  manager: string | null; orders: number; open_visits: number; next_visit: string | null; visits_total: number; visits_done: number; is_demo: boolean;
}

const STATUS: Record<string, { label: string; tone: "accent" | "warn" | "ok" | "neutral" }> = {
  active: { label: "Active", tone: "accent" }, on_hold: { label: "On hold", tone: "warn" }, closed: { label: "Closed", tone: "ok" }, cancelled: { label: "Cancelled", tone: "neutral" },
};

export function ProjectStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" as const };
  return <Badge state={status} label={s.label} tone={s.tone} />;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isDate = (d: string | null): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d);

export function ProjectViewSwitch({ view, q }: { view: "cards" | "list"; q?: string }) {
  const tail = q ? `q=${encodeURIComponent(q)}` : "";
  return (
    <nav className="view-switch" aria-label="Project views">
      <Link href={`/projects${tail ? `?${tail}` : ""}`} aria-current={view === "cards" ? "true" : undefined}><SquaresFour size={16} aria-hidden /> Cards</Link>
      <Link href={`/projects?view=list${tail ? `&${tail}` : ""}`} aria-current={view === "list" ? "true" : undefined}><ListBullets size={16} aria-hidden /> List</Link>
    </nav>
  );
}

export function ProjectCards({ rows }: { rows: ProjectCardRow[] }) {
  return (
    <ul className="project-grid">
      {rows.map((p) => <li key={p.id}><ProjectCard p={p} /></li>)}
    </ul>
  );
}

function ProjectCard({ p }: { p: ProjectCardRow }) {
  const pct = p.visits_total ? Math.round((p.visits_done / p.visits_total) * 100) : 0;
  const next = isDate(p.next_visit) ? shortDate(p.next_visit.slice(0, 10)) : null;
  return (
    <Link className="plate site-card project-card" href={`/projects/${p.id}`}>
      <div className="plate-head">
        <span className="code-tag"><span className="nw">{p.customer_bid}</span> · <span className="nw">{p.business_id}</span></span>
        <span className="project-card-tags">{p.is_demo && <DemoTag />}<ProjectStatus status={p.status} /></span>
      </div>
      <h3 className="plate-title">{p.customer.replace(/^Demo Customer /, "")}</h3>
      <p className="plate-sub">{p.name}</p>
      <dl className="site-facts">
        <div><dt>Site</dt><dd className="team-line"><MapPin size={16} aria-hidden /> {p.city}{p.site_address ? <span className="muted"> · {p.site_address}</span> : null}</dd></div>
        <div><dt>Next visit</dt><dd>{next ?? <span className="muted">Nothing booked</span>}</dd></div>
        <div><dt>Work</dt><dd>{plural(p.orders, "order")} · {plural(p.open_visits, "open visit")}</dd></div>
        {p.manager ? <div><dt>Manager</dt><dd>{p.manager}</dd></div> : null}
      </dl>
      <div className="site-progress">
        <div className="meter" role="img" aria-label={`${p.visits_done} of ${p.visits_total} visits done`}><span style={{ transform: `scaleX(${pct / 100})` }} /></div>
        <span className="code">{pct}%</span>
        <span className="small muted">{p.visits_total ? `${p.visits_done} of ${plural(p.visits_total, "visit")} done` : "No visits yet"}</span>
        <CaretRight size={18} className="callout-go" aria-hidden />
      </div>
    </Link>
  );
}
