import Link from "next/link";
import { DownloadSimple, MapPin } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { punchReport } from "@/server/queries/punch-locations";
import { distanceText, mapLink, punchRange, punchStatus, punchTime, type PunchPlace, type PunchRow } from "@/domain/punch-report";
import { localDateOf } from "@/lib/dates";
import { TZ } from "@/lib/format";
import { Empty, Notice, PageHeader } from "@/components/ui/Notice";

export const metadata = { title: "Punch locations" };

function Place({ p, at, tz }: { p: PunchPlace | null; at: number | null; tz: string }) {
  if (at === null) return <span className="muted">Not punched</span>;
  return (
    <span className="punch-place">
      <strong className="num">{punchTime(at, tz)}</strong>
      {p ? (
        <>
          <a href={mapLink(p)} target="_blank" rel="noreferrer"><MapPin size={14} weight="fill" aria-hidden /> Open map</a>
          <span className="small muted">
            {p.distanceM === null ? "Site has no map pin" : `${distanceText(p.distanceM)} from site`}
            {p.accuracy !== null ? ` · accurate to ${distanceText(p.accuracy)}` : ""}
          </span>
        </>
      ) : <span className="small muted">No location recorded</span>}
    </span>
  );
}

function Row({ r }: { r: PunchRow }) {
  const note = punchStatus(r);
  return (
    <tr>
      <td data-label="Date"><span className="num punch-date">{r.date}</span></td>
      <td data-label="Person"><strong>{r.name}</strong><div className="small muted">{r.business_id} · {r.designation}</div></td>
      <td data-label="Site">{r.project}<div className="small muted">{r.city}</div></td>
      <td data-label="Clock in"><Place p={r.in} at={r.check_in_at} tz={r.timezone} /></td>
      <td data-label="Clock out"><Place p={r.out} at={r.check_out_at} tz={r.timezone} /></td>
      <td data-label="Hours" className="num">{r.hours ?? "–"}{note && <div className="small muted">{note}</div>}</td>
    </tr>
  );
}

export default async function PunchLocations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const { from, to } = punchRange(sp, localDateOf(Date.now(), TZ));
  const r = await punchReport(db, actor, { from, to, employee: sp.employee, project: sp.project });
  const noPlace = r.rows.filter((x) => !x.in).length;
  const query = new URLSearchParams({ from, to, ...(sp.employee ? { employee: sp.employee } : {}), ...(sp.project ? { project: sp.project } : {}) }).toString();
  return (
    <div className="stack">
      <PageHeader title="Punch locations" subtitle="Where and when people punched in and out at a site. Dates are in the site's local time."
        actions={r.rows.length > 0 && <Link className="button" href={`/api/export/punches?${query}`} prefetch={false}><DownloadSimple size={16} aria-hidden /> Download CSV</Link>} />
      <form className="punch-filters plate" role="search" aria-label="Filter punches">
        <div className="field"><label htmlFor="pf-from">From</label><input id="pf-from" type="date" name="from" defaultValue={from} /></div>
        <div className="field"><label htmlFor="pf-to">To</label><input id="pf-to" type="date" name="to" defaultValue={to} /></div>
        <div className="field"><label htmlFor="pf-person">Person</label>
          <select id="pf-person" name="employee" defaultValue={sp.employee ?? ""}><option value="">Everyone</option>{r.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.business_id}</option>)}</select></div>
        <div className="field"><label htmlFor="pf-project">Site</label>
          <select id="pf-project" name="project" defaultValue={sp.project ?? ""}><option value="">All sites</option>{r.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <button type="submit" className="primary">Show</button>
      </form>
      {r.truncated && <Notice tone="warn" title="Too many punches to show">Showing the latest 5,000. Choose fewer days, one person or one site.</Notice>}
      {r.rows.length === 0 ? <Empty>No site punches between {from} and {to}. Punches appear here once people punch in at a site.</Empty> : (
        <>
          <p className="small muted punch-note">
            {r.rows.length.toLocaleString("en-IN")} punch{r.rows.length === 1 ? "" : "es"}{noPlace ? `, ${noPlace} without a location` : ""}. Distance is a guide, not proof: phone GPS can be off, especially indoors. Open map sends that point to Google Maps.
          </p>
          <div className="table-wrap">
            <table className="rows-mobile">
              <thead><tr><th scope="col">Date</th><th scope="col">Person</th><th scope="col">Site</th><th scope="col">Clock in</th><th scope="col">Clock out</th><th scope="col">Hours</th></tr></thead>
              <tbody>{r.rows.map((x) => <Row key={x.id} r={x} />)}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
