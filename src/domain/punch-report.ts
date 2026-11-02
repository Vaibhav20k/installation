/**
 * Punch location report: the date range, distance from the site and the download's columns. Distance is a plain
 * measurement for a person to judge; it is not geofencing and does not prove or disprove attendance.
 */

export interface PunchPlace { latitude: number; longitude: number; accuracy: number | null; distanceM: number | null }
export interface PunchRow {
  id: string; date: string; business_id: string; name: string; designation: string; project: string; city: string; timezone: string;
  check_in_at: number; check_out_at: number | null; hours: number | null; source: string; missed: boolean;
  in: PunchPlace | null; out: PunchPlace | null;
}

const MAX_DAYS = 92;
const DAY_MS = 86_400_000;
const validDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** Valid dates in order, at most 92 days; otherwise this month so far. */
export function punchRange(sp: { from?: string; to?: string }, today: string) {
  let from = validDate(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  let to = validDate(sp.to) ? sp.to : today;
  if (from > to) [from, to] = [to, from];
  const earliest = new Date(Date.parse(`${to}T00:00:00Z`) - MAX_DAYS * DAY_MS).toISOString().slice(0, 10);
  return { from: from < earliest ? earliest : from, to };
}

/** Great-circle distance in whole metres. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(a)));
}

/** Metres up to 1 km, then km with one decimal: easy to read at a glance. */
export const distanceText = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} km`);

export const mapLink = (p: { latitude: number; longitude: number }) => `https://www.google.com/maps?q=${p.latitude},${p.longitude}`;

export const punchTime = (ms: number, tz: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(ms);

export function punchStatus(r: Pick<PunchRow, "source" | "missed" | "check_out_at">) {
  if (r.missed) return "Did not punch out";
  if (r.source === "correction") return "Entered by supervisor";
  return r.check_out_at ? "" : "On site or not punched out";
}

export function punchCsv(rows: readonly PunchRow[]) {
  const place = (p: PunchPlace | null) => (p ? [p.latitude, p.longitude, p.accuracy ?? "", p.distanceM ?? "", mapLink(p)] : ["", "", "", "", ""]);
  const placeHeaders = (w: string) => [`${w} latitude`, `${w} longitude`, `${w} accuracy (m)`, `${w} distance from site (m)`, `${w} map`];
  return {
    headers: ["Date", "Employee no.", "Name", "Designation", "Project", "City", "Clock-in time", ...placeHeaders("Clock-in"), "Clock-out time", ...placeHeaders("Clock-out"), "Hours", "Note"],
    rows: rows.map((r) => [
      r.date, r.business_id, r.name, r.designation, r.project, r.city, punchTime(r.check_in_at, r.timezone), ...place(r.in),
      r.check_out_at ? punchTime(r.check_out_at, r.timezone) : "", ...place(r.out), r.hours ?? "", punchStatus(r),
    ]),
  };
}
