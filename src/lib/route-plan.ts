/**
 * Route planning for the installations map (request of 28 Oct 2026): from the person's current location, the
 * best order to drive to several chosen sites, using the free public OSRM "trip" service on OpenStreetMap roads.
 * Only map points go to the router (never addresses or names), and nothing is stored. The router is a boundary:
 * `fetcher` is injected so tests never call the internet.
 */

/** Google Maps directions links take at most 9 waypoints plus the destination. */
export const MAX_STOPS = 10;
export const DEFAULT_ROUTER = process.env.NEXT_PUBLIC_ROUTER_URL || "https://router.project-osrm.org";
const TIMEOUT_MS = 15_000;

export interface LatLng { lat: number; lng: number }
export interface Stop extends LatLng { id: string; name: string }
export interface Leg { stop: Stop; legKm: number; legMin: number; cumKm: number; cumMin: number }
export interface PlannedRoute { order: Leg[]; totalKm: number; totalMin: number; geometry: { type: "LineString"; coordinates: Array<[number, number]> } }

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

const valid = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const pt = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
const km = (m: number) => Math.round(m / 100) / 10;
const min = (s: number) => Math.round(s / 60);

export function tripUrl(base: string, start: LatLng, stops: Stop[]) {
  const coords = [start, ...stops].map(pt).join(";");
  const q = new URLSearchParams({ source: "first", roundtrip: "false", destination: "any", geometries: "geojson", overview: "full", steps: "false" });
  return `${base.replace(/\/+$/, "")}/trip/v1/driving/${coords}?${q}`;
}

interface OsrmTrip { code?: string; waypoints?: Array<{ waypoint_index: number }>; trips?: Array<{ distance: number; duration: number; geometry: PlannedRoute["geometry"]; legs: Array<{ distance: number; duration: number }> }> }

export function parseTrip(raw: unknown, stops: Stop[]): PlannedRoute {
  const r = raw as OsrmTrip;
  if (r?.code === "NoSegment") throw new Error("One of the sites (or your location) could not be reached by road. Check its map pin.");
  if (r?.code === "NoTrips") throw new Error("There is no driving route between these places.");
  const trip = r?.trips?.[0];
  if (r?.code !== "Ok" || !trip || r.waypoints?.length !== stops.length + 1 || trip.legs.length !== stops.length) {
    throw new Error("The route service gave an answer we could not use. Try again, or with fewer sites.");
  }
  // waypoints[i] is input i (0 = your location); waypoint_index is its position in the best order.
  const byPosition = stops.map((s, i) => ({ s, pos: r.waypoints![i + 1]!.waypoint_index })).sort((a, b) => a.pos - b.pos);
  let cumKm = 0, cumMin = 0;
  const order = byPosition.map(({ s }, j) => {
    const leg = trip.legs[j]!;
    const legKm = km(leg.distance), legMin = min(leg.duration);
    cumKm = Math.round((cumKm + legKm) * 10) / 10; cumMin += legMin;
    return { stop: s, legKm, legMin, cumKm, cumMin };
  });
  return { order, totalKm: km(trip.distance), totalMin: cumMin, geometry: trip.geometry };
}

export async function planRoute(fetcher: Fetcher, start: LatLng | null, stops: Stop[], base = DEFAULT_ROUTER): Promise<PlannedRoute> {
  if (!start || !valid(start)) throw new Error("Tap \"Use my location\" first: the route starts at your location.");
  if (!stops.length) throw new Error("Choose at least one site to visit.");
  if (stops.length > MAX_STOPS) throw new Error(`Choose up to ${MAX_STOPS} sites for one route.`);
  const bad = stops.find((s) => !valid(s));
  if (bad) throw new Error(`${bad.name} has no valid map point. Set its location first.`);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Awaited<ReturnType<Fetcher>>;
  try {
    res = await fetcher(tripUrl(base, start, stops), { signal: ctl.signal });
  } catch {
    throw new Error("Could not reach the route service (no connection, or it took too long). Try again.");
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    throw new Error(res.status === 429 ? "The free route service is busy. Wait a few seconds and try again." : "The route service is not answering right now. Try again shortly.");
  }
  return parseTrip(await res.json(), stops);
}

/** Opens turn-by-turn navigation in Google Maps (app or web) with the stops in the planned order. */
export function googleMapsUrl(start: LatLng, ordered: LatLng[]) {
  const f = (p: LatLng) => `${p.lat},${p.lng}`;
  const q = new URLSearchParams({ api: "1", origin: f(start), destination: f(ordered[ordered.length - 1]!), travelmode: "driving" });
  if (ordered.length > 1) q.set("waypoints", ordered.slice(0, -1).map(f).join("|"));
  return `https://www.google.com/maps/dir/?${q}`;
}

export function formatDrive(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
