"use client";
/**
 * Installations map: MapLibre GL with free OpenFreeMap vector tiles (no key, no account). The map library and its
 * styles load only when this view opens. One pin per site; late handovers blink red. Hover or tap a pin for its
 * installations; the site list beside the map flies to a pin. Managers place a site by clicking the map or by
 * pasting coordinates / a map link. Nothing is geocoded: a site without a pin is listed as "not on the map yet".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RoutePlanner } from "./RoutePlanner";
import { Crosshair, MapPin, WarningCircle } from "@phosphor-icons/react";
import type { Map as MlMap, Marker, Popup } from "maplibre-gl";
import { setSiteLocation } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";

export interface MapVisit { visit_id: string; visit: string; ordinal: string; status: string; late: boolean; due: string | null }
export interface MapSite { project_id: string; name: string; customer: string; city: string; address: string; lat: number | null; lng: number | null; visits: MapVisit[] }

const STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const INDIA: [number, number] = [78.9, 22.6];

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/** "28.43, 77.10", or a Google / OpenStreetMap link containing the coordinates. */
export function parseLocation(text: string): { latitude: number; longitude: number } | null {
  const t = decodeURIComponent(text.trim());
  const pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|mlat)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/];
  for (const p of pats) {
    const m = p.exec(t);
    if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { latitude: lat, longitude: lng }; }
  }
  const osm = /mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/.exec(t);
  return osm ? { latitude: Number(osm[1]), longitude: Number(osm[2]) } : null;
}

function popupNode(s: MapSite) {
  const root = document.createElement("div");
  root.className = "map-pop";
  const h = document.createElement("strong"); h.textContent = s.name; root.append(h);
  const sub = document.createElement("span"); sub.className = "map-pop-sub"; sub.textContent = `${s.customer} · ${s.address}, ${s.city}`; root.append(sub);
  for (const v of s.visits) {
    const a = document.createElement("a"); a.href = `/installations/${v.visit_id}`; if (v.late) a.dataset.late = "true";
    const t = document.createElement("span"); t.textContent = `${v.visit} · ${v.ordinal}`; a.append(t);
    const m = document.createElement("span"); m.className = "map-pop-meta";
    m.textContent = v.late ? `Overdue handover${v.due ? `, due ${v.due}` : ""}` : `${v.status.replace("_", " ")}${v.due ? ` · handover ${v.due}` : ""}`;
    a.append(m); root.append(a);
  }
  return root;
}

export function LiveMap({ sites, canEdit }: { sites: MapSite[]; canEdit: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const pins = useRef(new Map<string, { marker: Marker; popup: Popup }>());
  const draft = useRef<Marker | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [active, setActive] = useState<string | null>(null);
  const [placing, setPlacing] = useState<MapSite | null>(null);
  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const placed = useMemo(() => sites.filter((s) => s.lat !== null && s.lng !== null), [sites]);
  const unplaced = sites.filter((s) => s.lat === null || s.lng === null);
  const lateSites = placed.filter((s) => s.visits.some((v) => v.late)).length;

  // Load the library and the map once.
  useEffect(() => {
    let cancelled = false, guard: number | undefined;
    (async () => {
      try {
        const [ml] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
        if (cancelled || !box.current) return;
        lib.current = ml;
        // The tile worker is served by the app (see /api/map-worker); the version keeps browser caches correct.
        ml.setWorkerUrl(`/api/map-worker?v=${ml.getVersion()}`);
        const m = new ml.Map({ container: box.current, style: isDark() ? STYLE.dark : STYLE.light, center: INDIA, zoom: 3.6, attributionControl: { compact: true }, cooperativeGestures: false, fadeDuration: 150 });
        m.addControl(new ml.NavigationControl({ visualizePitch: false }), "top-right");
        // If the map has not drawn in 20 s (offline, blocked tiles, no WebGL), say so instead of spinning forever.
        guard = window.setTimeout(() => { if (!cancelled) setState((st) => (st === "loading" ? "failed" : st)); }, 20_000);
        m.on("load", () => { window.clearTimeout(guard); if (!cancelled) setState("ready"); });
        m.on("error", (e) => { if (!m.loaded() && !cancelled && String(e.error?.message ?? "").includes("style")) setState("failed"); });
        map.current = m;
      } catch { if (!cancelled) setState("failed"); }
    })();
    return () => { cancelled = true; window.clearTimeout(guard); map.current?.remove(); map.current = null; pins.current.clear(); };
  }, []);

  // Pins follow the data: added, moved or removed without rebuilding the map.
  useEffect(() => {
    const m = map.current, ml = lib.current;
    if (state !== "ready" || !m || !ml) return;
    for (const [id, p] of pins.current) if (!placed.some((s) => s.project_id === id)) { p.marker.remove(); pins.current.delete(id); }
    for (const s of placed) {
      const late = s.visits.filter((v) => v.late).length;
      const existing = pins.current.get(s.project_id);
      if (existing) { existing.marker.setLngLat([s.lng!, s.lat!]); existing.popup.setDOMContent(popupNode(s)); continue; }
      const el = document.createElement("button");
      el.type = "button"; el.className = "map-pin"; if (late) el.dataset.late = "true";
      el.setAttribute("aria-label", `${s.name}: ${s.visits.length} installation${s.visits.length === 1 ? "" : "s"}${late ? `, ${late} late` : ""}`);
      el.textContent = late ? `${late} late` : String(s.visits.length);
      const popup = new ml.Popup({ offset: 18, closeButton: true, maxWidth: "300px", className: "map-popup" }).setDOMContent(popupNode(s));
      const marker = new ml.Marker({ element: el, anchor: "bottom" }).setLngLat([s.lng!, s.lat!]).setPopup(popup).addTo(m);
      // Hover previews on a mouse; a tap or click toggles it (the marker's own behaviour).
      el.addEventListener("mouseenter", () => { if (!popup.isOpen() && window.matchMedia("(hover: hover)").matches) marker.togglePopup(); });
      el.addEventListener("click", () => setActive(s.project_id));
      pins.current.set(s.project_id, { marker, popup });
    }
    if (placed.length) {
      const b = new ml.LngLatBounds();
      for (const s of placed) b.extend([s.lng!, s.lat!]);
      m.fitBounds(b, { padding: 70, maxZoom: 12, duration: 700 });
    }
  }, [state, placed]);

  // Placing a site: clicks on the map drop a draggable draft pin.
  useEffect(() => {
    const m = map.current, ml = lib.current;
    if (state !== "ready" || !m || !ml || !placing) return;
    m.getCanvas().style.cursor = "crosshair";
    const drop = (lngLat: { lng: number; lat: number }) => {
      setPoint({ latitude: lngLat.lat, longitude: lngLat.lng });
      if (!draft.current) {
        const el = document.createElement("div"); el.className = "map-pin"; el.dataset.draft = "true"; el.textContent = "New";
        draft.current = new ml.Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat(lngLat).addTo(m);
        draft.current.on("dragend", () => { const p = draft.current!.getLngLat(); setPoint({ latitude: p.lat, longitude: p.lng }); });
      } else draft.current.setLngLat(lngLat);
    };
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => drop(e.lngLat);
    m.on("click", onClick);
    return () => { m.off("click", onClick); m.getCanvas().style.cursor = ""; draft.current?.remove(); draft.current = null; };
  }, [state, placing]);

  const flyTo = (s: MapSite) => {
    setActive(s.project_id);
    const m = map.current, p = pins.current.get(s.project_id);
    if (!m || !p) return;
    m.flyTo({ center: [s.lng!, s.lat!], zoom: Math.max(m.getZoom(), 12), duration: 900, essential: false });
    for (const [, o] of pins.current) if (o.popup.isOpen()) o.popup.remove();
    window.setTimeout(() => { if (!p.popup.isOpen()) p.marker.togglePopup(); }, 450);
  };

  return (
    <div className="live-map">
      <div className="live-map-canvas">
        <div ref={box} className="live-map-box" aria-label="Map of installation sites" role="region" />
        {state === "loading" && <div className="live-map-veil" role="status"><span className="live-map-spinner" aria-hidden /> Loading the map…</div>}
        {state === "failed" && <div className="live-map-veil" role="alert">The map could not load (no connection, or this browser has WebGL turned off). The site list still works.</div>}
        {placing && <div className="live-map-hint" role="status"><Crosshair size={16} aria-hidden /> Click the map where {placing.name} is. Drag the pin to adjust.</div>}
      </div>
      <aside className="live-map-side" aria-label="Sites">
        <p className="small muted" style={{ margin: 0 }}>{placed.length} site{placed.length === 1 ? "" : "s"} on the map{lateSites ? ` · ${lateSites} with a late handover` : ""}</p>
        {placed.length > 0 && <RoutePlanner sites={placed} mapRef={map} libRef={lib} mapReady={state === "ready"} />}
        <ul className="map-sites">
          {placed.map((s) => {
            const late = s.visits.some((v) => v.late);
            return (
              <li key={s.project_id}>
                <button type="button" className="map-site" data-active={active === s.project_id || undefined} data-late={late || undefined} onClick={() => flyTo(s)}>
                  <span className="map-site-title">{late ? <WarningCircle size={15} weight="fill" aria-hidden /> : <MapPin size={15} aria-hidden />} {s.name}</span>
                  <span className="map-site-meta">{s.city} · {s.visits.length} installation{s.visits.length === 1 ? "" : "s"}{late ? " · late" : ""}</span>
                </button>
                {canEdit && <button type="button" className="link small" onClick={() => { setPlacing(s); setPoint(null); }}>Move pin</button>}
              </li>
            );
          })}
        </ul>
        {unplaced.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <h3 className="section-label">Not on the map yet <span className="code">{unplaced.length}</span></h3>
            <ul className="map-sites">
              {unplaced.map((s) => (
                <li key={s.project_id}>
                  <div className="map-site" data-unplaced>
                    <span className="map-site-title">{s.name}</span>
                    <span className="map-site-meta">{s.address}, {s.city}</span>
                    {s.visits.map((v) => <a key={v.visit_id} className="small" href={`/installations/${v.visit_id}`}>{v.visit}{v.late ? " · overdue handover" : ""}</a>)}
                  </div>
                  {canEdit && <button type="button" className="link small" onClick={() => { setPlacing(s); setPoint(null); }}>Set location</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {placing && <PlaceForm site={placing} point={point} mapReady={state === "ready"} onDone={() => { setPlacing(null); setPoint(null); }} />}
      </aside>
    </div>
  );
}

function PlaceForm({ site, point, mapReady, onDone }: { site: MapSite; point: { latitude: number; longitude: number } | null; mapReady: boolean; onDone: () => void }) {
  const save = useAction(setSiteLocation, { onSuccess: onDone });
  const [text, setText] = useState("");
  const typed = text ? parseLocation(text) : null;
  const chosen = typed ?? point;
  return (
    <form className="form map-place" onSubmit={(e) => { e.preventDefault(); if (chosen) save.run({ projectId: site.project_id, location: chosen }); }}>
      <h3 style={{ margin: 0 }}>Location of {site.name}</h3>
      <p className="small muted" style={{ margin: 0 }}>{mapReady ? "Click the map, or paste coordinates or a Google Maps link." : "Paste coordinates or a Google Maps link."}</p>
      <div className="field"><label htmlFor="mp-t">Coordinates or map link</label><input id="mp-t" value={text} onChange={(e) => setText(e.target.value)} placeholder="28.4356, 77.1057" inputMode="text" autoCapitalize="none" autoCorrect="off" /></div>
      {text && !typed && <p className="small" style={{ margin: 0, color: "var(--warn)" }}>Those aren&apos;t coordinates we can read. Try &quot;28.4356, 77.1057&quot;.</p>}
      {chosen && <p className="small code" style={{ margin: 0 }}>{chosen.latitude.toFixed(5)}, {chosen.longitude.toFixed(5)}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="primary" disabled={!chosen || save.pending}>{save.pending ? "Saving…" : "Save location"}</button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
      <ResultNotice result={save.result} successText="Location saved." />
    </form>
  );
}
