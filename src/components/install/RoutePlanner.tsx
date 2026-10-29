"use client";
/**
 * "Plan a route" on the installations map: start from your current location (read once, only when you tap, never
 * saved), tick the sites to visit, and the free OSRM router returns the best order with the road path, distance
 * and drive time per leg. "Start navigation" hands the ordered stops to Google Maps for turn-by-turn directions.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { Crosshair, NavigationArrow, Path, X } from "@phosphor-icons/react";
import type { Map as MlMap, Marker } from "maplibre-gl";
import { MAX_STOPS, formatDrive, googleMapsUrl, planRoute, type LatLng, type PlannedRoute, type Stop } from "@/lib/route-plan";

interface Site { project_id: string; name: string; city: string; lat: number | null; lng: number | null }

const LOCATION_ERRORS: Record<number, string> = {
  1: "Location is blocked for this app. Allow location in your browser settings, then tap again.",
  2: "Your phone could not find its location. Move to an open spot or turn on location, then tap again.",
  3: "Finding your location took too long. Tap again.",
};

export function RoutePlanner({ sites, mapRef, libRef, mapReady }: { sites: Site[]; mapRef: RefObject<MlMap | null>; libRef: RefObject<typeof import("maplibre-gl") | null>; mapReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<(LatLng & { accuracy: number }) | null>(null);
  const [locating, setLocating] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const marks = useRef<Marker[]>([]);
  const stops: Stop[] = sites.filter((s) => picked.includes(s.project_id) && s.lat !== null && s.lng !== null).map((s) => ({ id: s.project_id, name: s.name, lat: s.lat!, lng: s.lng! }));

  const locate = () => {
    setError("");
    if (!window.isSecureContext) { setError("Your location needs a secure (https) connection to the app. Open it through its https address."); return; }
    if (!navigator.geolocation) { setError("This browser cannot share its location."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); setRoute(null); setMe({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }); },
      (e) => { setLocating(false); setError(LOCATION_ERRORS[e.code] ?? "Could not get your location. Tap again."); },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };
  const toggle = (id: string) => { setRoute(null); setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_STOPS ? p : [...p, id])); };
  const find = async () => {
    setBusy(true); setError("");
    try { setRoute(await planRoute((u, i) => fetch(u, i), me, stops)); } catch (e) { setError((e as Error).message); setRoute(null); } finally { setBusy(false); }
  };

  // Draw (or clear) the route: the road path, a "You" marker and the stop numbers on the map.
  useEffect(() => {
    const m = mapRef.current, ml = libRef.current;
    if (!mapReady || !m || !ml) return;
    for (const x of marks.current) x.remove();
    marks.current = [];
    const data = route ? { type: "Feature" as const, properties: {}, geometry: route.geometry } : { type: "FeatureCollection" as const, features: [] };
    const src = m.getSource("route") as { setData?: (d: unknown) => void } | undefined;
    if (src?.setData) src.setData(data);
    else {
      m.addSource("route", { type: "geojson", data });
      m.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 } });
      m.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#1f6feb", "line-width": 5 } });
    }
    if (me) {
      const el = document.createElement("div"); el.className = "route-you"; el.setAttribute("aria-label", "You are here");
      marks.current.push(new ml.Marker({ element: el }).setLngLat([me.lng, me.lat]).addTo(m));
    }
    if (route) {
      route.order.forEach((o, i) => {
        const el = document.createElement("div"); el.className = "route-stop"; el.textContent = String(i + 1); el.setAttribute("aria-label", `Stop ${i + 1}: ${o.stop.name}`);
        marks.current.push(new ml.Marker({ element: el, anchor: "bottom", offset: [16, -40] }).setLngLat([o.stop.lng, o.stop.lat]).addTo(m));
      });
      const b = new ml.LngLatBounds();
      for (const c of route.geometry.coordinates) b.extend(c);
      m.fitBounds(b, { padding: 60, maxZoom: 13, duration: 800 });
    }
  }, [route, me, mapReady, mapRef, libRef]);
  useEffect(() => () => { for (const x of marks.current) x.remove(); }, []);

  const clear = () => { setRoute(null); setPicked([]); setError(""); };
  const missing = !me ? "Use your location first" : !stops.length ? "Choose at least one site" : null;

  if (!open) return <button type="button" className="route-open" onClick={() => setOpen(true)} disabled={!mapReady}><Path size={18} aria-hidden /> Plan a route</button>;
  return (
    <section className="route-panel" aria-labelledby="h-route">
      <div className="spread"><h3 id="h-route" className="section-label" style={{ margin: 0 }}>Plan a route</h3>
        <button type="button" className="icon-btn" aria-label="Close route planner" onClick={() => { clear(); setOpen(false); }}><X size={16} /></button></div>
      <ol className="route-steps">
        <li>
          <button type="button" className="route-locate" onClick={locate} disabled={locating}><Crosshair size={18} aria-hidden /> {locating ? "Finding you…" : me ? "Update my location" : "Use my location"}</button>
          {me && <span className="small muted">Found, within about {me.accuracy} m.</span>}
        </li>
        <li>
          <span className="small">Sites to visit ({picked.length}/{MAX_STOPS})</span>
          <ul className="route-sites">
            {sites.map((s) => (
              <li key={s.project_id}><label data-on={picked.includes(s.project_id) || undefined}>
                <input type="checkbox" checked={picked.includes(s.project_id)} disabled={!picked.includes(s.project_id) && picked.length >= MAX_STOPS} onChange={() => toggle(s.project_id)} />
                <span>{s.name}<span className="small muted"> · {s.city}</span></span>
              </label></li>
            ))}
          </ul>
        </li>
      </ol>
      <button type="button" className="primary route-find" onClick={find} disabled={!!missing || busy}>{busy ? "Finding the best route…" : missing ?? `Find best route (${stops.length} site${stops.length === 1 ? "" : "s"})`}</button>
      {error && <p className="notice" data-tone="warn" role="alert" style={{ margin: 0 }}>{error}</p>}
      {route && (
        <div className="route-result" aria-live="polite">
          <p className="route-total"><strong>{route.totalKm} km</strong> · about {formatDrive(route.totalMin)} driving</p>
          <ol className="route-legs">
            {route.order.map((o, i) => (
              <li key={o.stop.id}><span className="route-n">{i + 1}</span>
                <span><strong>{o.stop.name}</strong><span className="small muted">{o.legKm} km · {formatDrive(o.legMin)} from {i === 0 ? "you" : `stop ${i}`} · arrive after about {formatDrive(o.cumMin)}</span></span></li>
            ))}
          </ol>
          <a className="button primary route-go" href={googleMapsUrl(me!, route.order.map((o) => o.stop))} target="_blank" rel="noreferrer"><NavigationArrow size={18} aria-hidden /> Start navigation (Google Maps)</a>
          <button type="button" className="link small" onClick={clear}>Clear route</button>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>Drive times are estimates without live traffic. Your location and the chosen sites&apos; map points go to the free OSRM route service to work out the roads; nothing is saved. Routes © OSRM, OpenStreetMap contributors.</p>
    </section>
  );
}
