/**
 * Optional OpenStreetMap fallback (spec section 5), used only when
 * GOOGLE_MAPS_API_KEY is not configured. Structured as a self-contained,
 * swappable provider so a different fallback (or a self-hosted routing
 * engine) can be dropped in later without touching lookup.ts's
 * orchestration logic -- see the ProviderAdapter shape in lookup.ts.
 *
 * Two OSM services are used:
 *   - Nominatim (https://nominatim.openstreetmap.org) for geocoding.
 *     This is OSM's public demo geocoder; per its usage policy it is
 *     rate-limited and not intended for high-volume production traffic.
 *   - Overpass API (https://overpass-api.de) to query nearby nodes/ways
 *     tagged highway=bus_stop, public_transport=platform,
 *     public_transport=stop_position, or amenity=bus_station.
 *
 * Deliberately NOT implemented here: a walking-route calculation. Spec
 * section 5 explicitly warns against relying on a public OSRM demo
 * routing server for production traffic, and section 5 also requires
 * that "if no reliable walking route can be calculated, show that the
 * result is unavailable rather than displaying straight-line distance as
 * walking distance." So the OSM path in lookup.ts finds candidate stops
 * and their straight-line distance only, and reports the walking
 * route as unavailable rather than substituting straight-line distance.
 * A self-hosted or paid routing provider could be wired in here later.
 */
import type { GeocodeResult } from "./types";

const REQUEST_TIMEOUT_MS = 8000;
const USER_AGENT = "MichaelAylettUnderwritingTool/1.0 (transit-lookup)";

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, ...(init.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function geocodeAddressOsm(address: string): Promise<GeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(
    address
  )}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let data: any[];
  try {
    data = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;

  const top = data[0];
  const addr = top.address || {};
  const county: string | null = addr.county || null;
  const state: string | null = addr.state || null;

  return {
    normalizedAddress: top.display_name,
    latitude: parseFloat(top.lat),
    longitude: parseFloat(top.lon),
    county,
    state,
    countyFips: null,
    provider: "openstreetmap",
    retrievedAt: new Date().toISOString(),
  };
}

export interface OsmStopCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
}

/** Queries Overpass for nodes/ways tagged as bus stops within radiusMeters. */
export async function nearbyBusStopsOsm(
  latitude: number,
  longitude: number,
  radiusMeters: number
): Promise<OsmStopCandidate[]> {
  const query = `
    [out:json][timeout:10];
    (
      node["highway"="bus_stop"](around:${Math.round(radiusMeters)},${latitude},${longitude});
      node["public_transport"="platform"](around:${Math.round(radiusMeters)},${latitude},${longitude});
      node["public_transport"="stop_position"](around:${Math.round(radiusMeters)},${latitude},${longitude});
      node["amenity"="bus_station"](around:${Math.round(radiusMeters)},${latitude},${longitude});
    );
    out body;
  `.trim();

  let response: Response;
  try {
    response = await fetchWithTimeout("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  let data: any;
  try {
    data = await response.json();
  } catch {
    return [];
  }

  const elements: any[] = Array.isArray(data.elements) ? data.elements : [];
  return elements
    .filter((el) => typeof el.lat === "number" && typeof el.lon === "number")
    .map((el) => ({
      id: `osm-${el.type}-${el.id}`,
      name: el.tags?.name || "Unnamed bus stop",
      latitude: el.lat,
      longitude: el.lon,
      tags: el.tags || {},
    }));
}
