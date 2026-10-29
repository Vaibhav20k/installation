/**
 * Route planning on the map (request of 28 Oct 2026): from the person's current location, the best order to
 * visit several chosen sites, using the OSRM "trip" service. The router is mocked here; no test calls the internet.
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_STOPS, formatDrive, googleMapsUrl, parseTrip, planRoute, tripUrl, type Stop } from "@/lib/route-plan";

const START = { lat: 28.4595, lng: 77.0266 }; // Gurugram
const STOPS: Stop[] = [
  { id: "noida", name: "Kapoor - Noida", lat: 28.524, lng: 77.354 },
  { id: "gurugram", name: "Mehta - Gurugram", lat: 28.4356, lng: 77.1057 },
  { id: "jaipur", name: "Mehta - Jaipur", lat: 26.9118, lng: 75.74 },
];

// Shape of an OSRM trip response: waypoints in input order (0 = start) with their position in the trip.
const OK = {
  code: "Ok",
  waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }, { waypoint_index: 3 }],
  trips: [{
    distance: 330_500, duration: 21_900,
    geometry: { type: "LineString", coordinates: [[77.0266, 28.4595], [77.1057, 28.4356], [77.354, 28.524], [75.74, 26.9118]] },
    legs: [{ distance: 9_500, duration: 1_200 }, { distance: 41_000, duration: 3_300 }, { distance: 280_000, duration: 17_400 }],
  }],
};

describe("tripUrl", () => {
  it("puts the start first, keeps it fixed, ends anywhere and asks for the road shape", () => {
    const u = new URL(tripUrl("https://router.example", START, STOPS));
    expect(u.pathname).toBe("/trip/v1/driving/77.026600,28.459500;77.354000,28.524000;77.105700,28.435600;75.740000,26.911800");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ source: "first", roundtrip: "false", destination: "any", geometries: "geojson", overview: "full" });
  });
});

describe("parseTrip", () => {
  it("orders the stops by the router's best order, with distance and time per leg and in total", () => {
    const r = parseTrip(OK, STOPS);
    expect(r.order.map((o) => o.stop.id)).toEqual(["gurugram", "noida", "jaipur"]);
    expect(r.order.map((o) => [o.legKm, o.legMin])).toEqual([[9.5, 20], [41, 55], [280, 290]]);
    expect(r.order.map((o) => o.cumMin)).toEqual([20, 75, 365]);
    expect([r.totalKm, r.totalMin]).toEqual([330.5, 365]);
    expect(r.geometry.coordinates).toHaveLength(4);
  });
  it("explains router failures in plain words", () => {
    expect(() => parseTrip({ code: "NoSegment" }, STOPS)).toThrow(/could not be reached by road/);
    expect(() => parseTrip({ code: "NoTrips" }, STOPS)).toThrow(/no driving route/i);
    expect(() => parseTrip({ code: "TooBig" }, STOPS)).toThrow(/route service/i);
    expect(() => parseTrip({ code: "Ok", waypoints: [], trips: [] }, STOPS)).toThrow(/route service/i);
  });
});

describe("planRoute", () => {
  it("needs a start and between one and the maximum number of stops, with valid coordinates", async () => {
    const fetcher = vi.fn();
    await expect(planRoute(fetcher, null, STOPS)).rejects.toThrow(/your location/i);
    await expect(planRoute(fetcher, START, [])).rejects.toThrow(/at least one site/i);
    const many = Array.from({ length: MAX_STOPS + 1 }, (_, i) => ({ id: String(i), name: `S${i}`, lat: 28 + i / 100, lng: 77 }));
    await expect(planRoute(fetcher, START, many)).rejects.toThrow(new RegExp(`up to ${MAX_STOPS}`));
    await expect(planRoute(fetcher, START, [{ id: "x", name: "Bad", lat: 123, lng: 77 }])).rejects.toThrow(/map point/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("calls the router once and returns the parsed route", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => OK });
    const r = await planRoute(fetcher, START, STOPS, "https://router.example");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toContain("https://router.example/trip/v1/driving/");
    expect(r.order[0]!.stop.id).toBe("gurugram");
  });
  it("turns network errors, timeouts and busy responses into a clear retry message", async () => {
    await expect(planRoute(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")), START, STOPS)).rejects.toThrow(/could not reach the route service/i);
    await expect(planRoute(vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }), START, STOPS)).rejects.toThrow(/busy/i);
  });
});

describe("navigation link and labels", () => {
  it("opens Google Maps directions with the stops in the planned order", () => {
    const r = parseTrip(OK, STOPS);
    const u = new URL(googleMapsUrl(START, r.order.map((o) => o.stop)));
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/dir/");
    expect(u.searchParams.get("api")).toBe("1");
    expect(u.searchParams.get("origin")).toBe("28.4595,77.0266");
    expect(u.searchParams.get("destination")).toBe("26.9118,75.74");
    expect(u.searchParams.get("waypoints")).toBe("28.4356,77.1057|28.524,77.354");
    expect(u.searchParams.get("travelmode")).toBe("driving");
  });
  it("formats drive time and distance for people", () => {
    expect(formatDrive(5)).toBe("5 min");
    expect(formatDrive(75)).toBe("1 h 15 min");
    expect(formatDrive(120)).toBe("2 h");
  });
});
