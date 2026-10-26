import Link from "next/link";
import { notFound } from "next/navigation";
import { GridFour, ListBullets } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { listCards, type CardFilters } from "@/server/queries/skill-cards";
import { AVAILABILITY_LABEL, type Availability } from "@/domain/availability";
import { Empty, PageHeader } from "@/components/ui/Notice";
import { CardDirectory } from "@/components/cards/CardDirectory";
import { ROLES, roleLabel } from "@/components/cards/labels";

export const metadata = { title: "Skill cards" };

const AVAILABILITY = Object.keys(AVAILABILITY_LABEL) as Availability[];
const one = <T extends string>(v: string | undefined, allowed: readonly T[]) => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);

export default async function SkillCardsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, actor } = await session();
  // Admin only: everyone else gets "not found", the same as a page that does not exist.
  if (actor.role !== "admin") notFound();
  const sp = await searchParams;
  const filters: CardFilters = {
    q: sp.q?.trim().slice(0, 60) || undefined, role: one(sp.role, ROLES), skill: sp.skill || undefined,
    minLevel: one(sp.min, ["1", "2", "3"] as const) ? Number(sp.min) : undefined, verification: one(sp.ver, ["verified", "unverified", "expired"] as const),
    city: sp.city || undefined, availability: one(sp.avail, AVAILABILITY), page: Number(sp.page) || 1,
  };
  const view = sp.view === "list" ? "list" : "grid";
  const r = await listCards(db, actor, filters, Date.now());
  const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: sp.q, role: sp.role, skill: sp.skill, min: sp.min, ver: sp.ver, city: sp.city, avail: sp.avail, view: sp.view, page: sp.page, ...over }).filter(([, v]) => v) as Array<[string, string]>);
    return `/skill-cards?${p.toString()}`;
  };
  return (
    <>
      <PageHeader title="Skill cards" subtitle="Each person's verified skills and live availability, from the employee, skill, leave and booking records. Admin only. Cards show operational skills; nobody is ranked or scored." />
      <div className="cards-toolbar card no-print">
        <form className="cards-filters" role="search" aria-label="Filter skill cards">
          {view === "list" && <input type="hidden" name="view" value="list" />}
          <div className="field"><label htmlFor="cf-q">Name or ID</label><input id="cf-q" name="q" defaultValue={sp.q ?? ""} placeholder="Search" /></div>
          <div className="field"><label htmlFor="cf-role">Role</label><select id="cf-role" name="role" defaultValue={sp.role ?? ""}><option value="">All roles</option>{ROLES.map((x) => <option key={x} value={x}>{roleLabel(x)}</option>)}</select></div>
          <div className="field"><label htmlFor="cf-skill">Skill</label><select id="cf-skill" name="skill" defaultValue={sp.skill ?? ""}><option value="">Any skill</option>{r.skills.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
          <div className="field"><label htmlFor="cf-min">Minimum level</label><select id="cf-min" name="min" defaultValue={sp.min ?? ""}><option value="">Any</option><option value="1">Low+</option><option value="2">Medium+</option><option value="3">High</option></select></div>
          <div className="field"><label htmlFor="cf-ver">Verification</label><select id="cf-ver" name="ver" defaultValue={sp.ver ?? ""}><option value="">Any</option><option value="verified">Verified and valid</option><option value="unverified">Not verified</option><option value="expired">Expired</option></select></div>
          <div className="field"><label htmlFor="cf-city">Base</label><select id="cf-city" name="city" defaultValue={sp.city ?? ""}><option value="">All</option>{r.cities.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="cf-av">Availability</label><select id="cf-av" name="avail" defaultValue={sp.avail ?? ""}><option value="">Any</option>{AVAILABILITY.map((a) => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}</select></div>
          <button type="submit">Apply</button>
        </form>
        <div className="cards-meta">
          <span>{r.total} {r.total === 1 ? "person" : "people"}{pages > 1 ? ` · page ${r.page} of ${pages}` : ""} · availability as of now</span>
          <nav className="view-switch" aria-label="View">
            <Link href={qs({ view: undefined })} aria-current={view === "grid" ? "true" : undefined}><GridFour size={16} aria-hidden /> Cards</Link>
            <Link href={qs({ view: "list" })} aria-current={view === "list" ? "true" : undefined}><ListBullets size={16} aria-hidden /> List</Link>
          </nav>
        </div>
      </div>
      {r.rows.length === 0 ? <Empty>No one matches these filters.</Empty> : <CardDirectory rows={r.rows} view={view} />}
      {pages > 1 && (
        <nav className="row pager no-print" aria-label="Card pages">
          {r.page > 1 ? <Link href={qs({ page: String(r.page - 1) })} rel="prev">Previous</Link> : <span className="muted">Previous</span>}
          <span className="small">Page {r.page} of {pages}</span>
          {r.page < pages ? <Link href={qs({ page: String(r.page + 1) })} rel="next">Next</Link> : <span className="muted">Next</span>}
        </nav>
      )}
    </>
  );
}
