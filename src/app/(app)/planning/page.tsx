import Link from "next/link";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { planningBoard, planningSheet } from "@/server/queries/planning";
import { listProjects } from "@/server/queries/projects";
import { skillsCatalog } from "@/server/queries/people";
import { addDays, isLocalDate, localDateOf, weekday } from "@/lib/dates";
import { formatMoney, TZ, when } from "@/lib/format";
import { Board } from "@/components/planning/Board";
import { Sheet, type SheetRowView } from "@/components/planning/Sheet";
import { PageHeader, Tabs } from "@/components/ui/Notice";

export const metadata = { title: "Planning" };

const ROLES = ["site_supervisor", "carpenter", "helper", "senior_technician", "technician", "junior_technician", "assistant_technician", "stone_technician"];

export default async function PlanningPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const now = Date.now();
  const view = sp.view === "sheet" ? "sheet" : "board";
  const today = localDateOf(now, TZ);
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const from = sp.from && isLocalDate(sp.from) ? sp.from : monday;
  const span = sp.span === "month" ? 28 : 14;
  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...extra }).filter(([, v]) => v !== undefined && v !== "") as Array<[string, string]>);
    return `/planning?${p.toString()}`;
  };
  const [projects, skills] = await Promise.all([listProjects(db, actor), skillsCatalog(db)]);
  return (
    <>
      <PageHeader title="Planning" subtitle="Employee timeline and the management planning sheet share the same reservation records."
        actions={actor.role !== "employee" ? <Link className="button primary" href="/planning/new">New plan</Link> : undefined} />
      <Tabs current={view} items={[{ id: "board", label: "Timeline", href: qs({ view: "board" }) }, { id: "sheet", label: "Planning sheet", href: qs({ view: "sheet" }) }]} />
      {view === "board" ? await renderBoard() : await renderSheet()}
    </>
  );

  async function renderBoard() {
    const board = await planningBoard(db, actor, { from, days: span, role: sp.role || undefined, skill: sp.skill || undefined, projectId: sp.project || undefined }, now);
    return (
      <>
        <form className="card row no-print" role="search" aria-label="Timeline filters">
          <input type="hidden" name="view" value="board" />
          <div className="field"><label htmlFor="b-from">From</label><input id="b-from" type="date" name="from" defaultValue={from} /></div>
          <div className="field"><label htmlFor="b-span">Range</label><select id="b-span" name="span" defaultValue={sp.span ?? "2w"}><option value="2w">2 weeks</option><option value="month">4 weeks</option></select></div>
          <div className="field"><label htmlFor="b-role">Job role</label><select id="b-role" name="role" defaultValue={sp.role ?? ""}><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></div>
          <div className="field"><label htmlFor="b-skill">Verified skill</label><select id="b-skill" name="skill" defaultValue={sp.skill ?? ""}><option value="">Any</option>{skills.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}</select></div>
          <div className="field"><label htmlFor="b-project">Project</label><select id="b-project" name="project" defaultValue={sp.project ?? ""}><option value="">All</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.business_id}</option>)}</select></div>
          <button type="submit" style={{ alignSelf: "flex-end" }}>Apply</button>
          <div className="row" style={{ alignSelf: "flex-end" }}>
            <Link className="button" href={qs({ from: addDays(from, -span) })}><CaretLeft size={16} aria-hidden /> Earlier</Link>
            <Link className="button" href={qs({ from: monday })}>This week</Link>
            <Link className="button" href={qs({ from: addDays(from, span) })}>Later <CaretRight size={16} aria-hidden /></Link>
          </div>
        </form>
        <Board from={board.from} days={board.days} start={board.start} end={board.end} rows={board.rows} />
        <p className="small muted">To assign people, open a visit and use its team step; it applies the same availability and skill checks as suggestions. Drag-and-drop is not used.</p>
      </>
    );
  }

  async function renderSheet() {
    const rows = await planningSheet(db, actor, { projectId: sp.project || undefined, status: sp.status || undefined }, now);
    const filtered = sp.conflicts === "1" ? rows.filter((r) => r.conflicts.length) : rows;
    const view: SheetRowView[] = filtered.map((r) => ({
      ...r, departure: when(r.departure), returnAt: when(r.returnAt), estimate: formatMoney(r.estimateMinor), budget: formatMoney(r.budgetMinor),
    }));
    const exportParams = new URLSearchParams(Object.entries({ project: sp.project, status: sp.status, conflicts: sp.conflicts }).filter(([, v]) => v) as Array<[string, string]>);
    return (
      <>
        <form className="card row no-print" role="search" aria-label="Sheet filters">
          <input type="hidden" name="view" value="sheet" />
          <div className="field"><label htmlFor="s-project">Project</label><select id="s-project" name="project" defaultValue={sp.project ?? ""}><option value="">All</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.business_id} · {p.name}</option>)}</select></div>
          <div className="field"><label htmlFor="s-status">Execution status</label>
            <select id="s-status" name="status" defaultValue={sp.status ?? ""}><option value="">Any</option>{["unscheduled", "scheduled", "in_progress", "on_hold", "completed"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
          <label className="check" style={{ alignSelf: "flex-end" }}><input type="checkbox" name="conflicts" value="1" defaultChecked={sp.conflicts === "1"} /> Only rows with conflicts</label>
          <button type="submit" style={{ alignSelf: "flex-end" }}>Apply</button>
        </form>
        <Sheet rows={view} exportHref={`/api/export/sheet?${exportParams.toString()}`} />
      </>
    );
  }
}
