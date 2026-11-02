/**
 * Who punched where and when at a site. Location is sensitive, so access is narrower than project scope: crew see only
 * their own punches (not co-workers on the same site), managers and supervisors their projects, Admin and the
 * Installation Head everyone. Filters only ever narrow this.
 */
import type { Queryable } from "../db/client";
import { projectScopeSql, type Actor } from "../auth/permissions";
import { distanceMeters, type PunchPlace, type PunchRow } from "@/domain/punch-report";

const LIMIT = 5000;
const ID = /^[0-9a-f-]{36}$/i;

type Stored = { latitude?: unknown; longitude?: unknown; accuracy?: unknown } | string | null;

function place(raw: Stored, siteLat: unknown, siteLng: unknown): PunchPlace | null {
  const l = typeof raw === "string" ? (JSON.parse(raw) as Exclude<Stored, string>) : raw;
  if (!l || typeof l.latitude !== "number" || typeof l.longitude !== "number") return null;
  const hasSite = siteLat !== null && siteLng !== null;
  return {
    latitude: l.latitude, longitude: l.longitude, accuracy: typeof l.accuracy === "number" ? Math.round(l.accuracy) : null,
    distanceM: hasSite ? distanceMeters(l.latitude, l.longitude, Number(siteLat), Number(siteLng)) : null,
  };
}

export async function punchReport(q: Queryable, actor: Actor, f: { from: string; to: string; employee?: string; project?: string }) {
  const params: unknown[] = [actor.id, f.from, f.to];
  const scope = projectScopeSql(actor, "p", "$1");
  const access = actor.role === "admin" ? "$1::uuid is not null"
    : actor.role === "employee" ? "(sp.employee_id = $1 or exists (select 1 from flow_role_member hm where hm.employee_id = $1 and hm.role_code = 'installation_head'))"
    : `(sp.employee_id = $1 or ${scope.sql})`;
  const base = `from site_presence sp join employee e on e.id = sp.employee_id join project p on p.id = sp.project_id
    where not sp.voided and ${access} and (sp.check_in_at at time zone p.timezone)::date between $2::date and $3::date`;

  const [people, projects] = await Promise.all([
    q.query<{ id: string; business_id: string; name: string }>(`select distinct e.id, e.business_id, e.name ${base} order by e.name`, params),
    q.query<{ id: string; name: string }>(`select distinct p.id, p.name ${base} order by p.name`, params),
  ]);

  let filter = "";
  const all = [...params];
  if (f.employee && ID.test(f.employee)) { all.push(f.employee); filter += ` and sp.employee_id = $${all.length}`; }
  if (f.project && ID.test(f.project)) { all.push(f.project); filter += ` and sp.project_id = $${all.length}`; }
  const rows = await q.query<{ id: string; date: string; business_id: string; name: string; designation: string | null; project: string; city: string | null; timezone: string;
    check_in_at: number; check_out_at: number | null; source: string; missed_checkout: boolean; check_in_location: Stored; check_out_location: Stored; site_lat: unknown; site_lng: unknown }>(
    `select sp.id, to_char(sp.check_in_at at time zone p.timezone, 'YYYY-MM-DD') date, e.business_id, e.name, coalesce(e.designation_code, e.job_role) designation, p.name project, p.city, p.timezone,
            sp.check_in_at, sp.check_out_at, sp.source, sp.missed_checkout, sp.check_in_location, sp.check_out_location, p.latitude site_lat, p.longitude site_lng
     ${base}${filter} order by sp.check_in_at desc limit ${LIMIT + 1}`, all);

  const shown = rows.slice(0, LIMIT).map((r): PunchRow => {
    const inAt = Number(r.check_in_at), outAt = r.check_out_at === null ? null : Number(r.check_out_at);
    return {
      id: r.id, date: r.date, business_id: r.business_id, name: r.name, designation: (r.designation ?? "").replace(/_/g, " "), project: r.project, city: r.city ?? "", timezone: r.timezone,
      check_in_at: inAt, check_out_at: outAt, hours: outAt === null ? null : Math.round(((outAt - inAt) / 3_600_000) * 100) / 100, source: r.source, missed: r.missed_checkout,
      in: place(r.check_in_location, r.site_lat, r.site_lng), out: place(r.check_out_location, r.site_lat, r.site_lng),
    };
  });
  return { rows: shown, truncated: rows.length > LIMIT, people, projects };
}
