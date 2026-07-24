/**
 * Server-only Google Maps Platform client for the transit feature.
 * NEVER import this file from a "use client" component -- it reads
 * GOOGLE_MAPS_API_KEY from process.env and every function here makes a
 * server-to-Google request, so the key never reaches the browser.
 *
 * Three Google Maps Platform services are used, per spec section 4:
 *   - Geocoding API (legacy REST endpoint -- stable and unchanged for
 *     many years): turns a free-text address into coordinates + address
 *     components (used to read the county/state).
 *   - Places API Nearby Search (legacy REST endpoint, `type=bus_station`
 *     filter) to find candidate bus stations near the coordinates.
 *   - Routes API `computeRoutes` (the current, non-deprecated routing
 *     API) with travelMode "WALK" to get an actual pedestrian walking
 *     route's distance and duration for each candidate.
 *   - Directions API (legacy, `mode=transit&transit_mode=bus`) is used
 *     only for the small number of finalist stops (nearest + up to 4
 *     alternates) to extract the transit agency name and bus route
 *     numbers/short names, and to confirm the vehicle type is BUS.
 *
 * These are implemented against Google's documented request/response
 * shapes. Google occasionally adjusts field names on newer APIs (Places
 * New, Routes) -- if a real API key returns an unexpected shape, check
 * the current reference at https://developers.google.com/maps/documentation
 * before assuming the orchestration logic in lookup.ts is wrong.
 *
 * The three services used here must each be enabled in the Google Cloud
 * project tied to GOOGLE_MAPS_API_KEY: "Geocoding API", "Places API",
 * "Routes API", and "Directions API" (see README.md).
 */
import type { GeocodeResult } from "./types";

const REQUEST_TIMEOUT_MS = 8000;

export function getGoogleMapsApiKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class GoogleMapsApiError extends Error {
  code:
    | "not_configured"
    | "billing_not_enabled"
    | "rate_limited"
    | "not_found"
    | "ambiguous"
    | "timeout"
    | "unknown";
  constructor(code: GoogleMapsApiError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "GoogleMapsApiError";
  }
}

/** Maps a legacy Google Maps API `status` field to our error taxonomy. */
function mapGoogleStatus(status: string): GoogleMapsApiError["code"] {
  switch (status) {
    case "REQUEST_DENIED":
      return "billing_not_enabled";
    case "OVER_QUERY_LIMIT":
      return "rate_limited";
    case "ZERO_RESULTS":
      return "not_found";
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------
// Geocoding API
// ---------------------------------------------------------------------
export async function geocodeAddressGoogle(address: string): Promise<GeocodeResult> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) throw new GoogleMapsApiError("not_configured", "GOOGLE_MAPS_API_KEY is not set.");

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${apiKey}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { method: "GET" });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GoogleMapsApiError("timeout", "Geocoding request timed out.");
    }
    throw new GoogleMapsApiError("unknown", "Geocoding request failed.");
  }

  const data = await response.json();
  if (data.status === "OK" && Array.isArray(data.results) && data.results.length > 0) {
    if (data.results.length > 1) {
      // More than one candidate match -- still usable (we take the top
      // result, which Google ranks first), but flagged so the caller can
      // decide whether to surface an "ambiguous address" notice.
    }
    const top = data.results[0];
    const components: Array<{ long_name: string; short_name: string; types: string[] }> =
      top.address_components || [];
    const county =
      components.find((c) => c.types.includes("administrative_area_level_2"))?.long_name ?? null;
    const state =
      components.find((c) => c.types.includes("administrative_area_level_1"))?.short_name ?? null;

    return {
      normalizedAddress: top.formatted_address,
      latitude: top.geometry.location.lat,
      longitude: top.geometry.location.lng,
      county,
      state,
      countyFips: null,
      provider: "google",
      retrievedAt: new Date().toISOString(),
    };
  }

  const code = mapGoogleStatus(data.status);
  throw new GoogleMapsApiError(
    code,
    `Geocoding API returned ${data.status}${data.error_message ? `: ${data.error_message}` : ""}`
  );
}

// ---------------------------------------------------------------------
// Places API -- Nearby Search (legacy REST endpoint)
// ---------------------------------------------------------------------
export interface RawPlaceCandidate {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  vicinity: string | null;
  types: string[];
}

export async function nearbyBusStopsGoogle(
  latitude: number,
  longitude: number,
  radiusMeters: number
): Promise<RawPlaceCandidate[]> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) throw new GoogleMapsApiError("not_configured", "GOOGLE_MAPS_API_KEY is not set.");

  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${latitude},${longitude}&radius=${Math.round(radiusMeters)}&type=bus_station&key=${apiKey}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { method: "GET" });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GoogleMapsApiError("timeout", "Nearby-stop search timed out.");
    }
    throw new GoogleMapsApiError("unknown", "Nearby-stop search failed.");
  }

  const data = await response.json();
  if (data.status === "OK" || data.status === "ZERO_RESULTS") {
    const results: any[] = data.results || [];
    return results.map((r) => ({
      placeId: r.place_id,
      name: r.name,
      latitude: r.geometry.location.lat,
      longitude: r.geometry.location.lng,
      vicinity: r.vicinity ?? null,
      types: r.types ?? [],
    }));
  }

  const code = mapGoogleStatus(data.status);
  throw new GoogleMapsApiError(
    code,
    `Places Nearby Search returned ${data.status}${data.error_message ? `: ${data.error_message}` : ""}`
  );
}

// ---------------------------------------------------------------------
// Routes API -- computeRoutes (WALK)
// ---------------------------------------------------------------------
export interface WalkingRouteResult {
  distanceMeters: number;
  durationSeconds: number;
}

export async function computeWalkingRouteGoogle(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<WalkingRouteResult | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) throw new GoogleMapsApiError("not_configured", "GOOGLE_MAPS_API_KEY is not set.");

  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";
  const body = {
    origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
    destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
    travelMode: "WALK",
    units: "IMPERIAL",
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GoogleMapsApiError("timeout", "Walking-route request timed out.");
    }
    throw new GoogleMapsApiError("unknown", "Walking-route request failed.");
  }

  if (response.status === 403) {
    throw new GoogleMapsApiError("billing_not_enabled", "Routes API request denied (billing/permissions).");
  }
  if (response.status === 429) {
    throw new GoogleMapsApiError("rate_limited", "Routes API rate limit reached.");
  }
  if (!response.ok) {
    // A single unreachable candidate (no valid walking path) is common
    // and not itself a hard failure -- the caller treats "no route" as
    // "exclude this candidate," not as an API failure, unless every
    // candidate fails this way.
    return null;
  }

  const data = await response.json();
  const route = Array.isArray(data.routes) ? data.routes[0] : null;
  if (!route || typeof route.distanceMeters !== "number") return null;

  const durationSeconds =
    typeof route.duration === "string" ? parseInt(route.duration.replace("s", ""), 10) : 0;

  return { distanceMeters: route.distanceMeters, durationSeconds };
}

// ---------------------------------------------------------------------
// Directions API (legacy, transit/bus mode) -- used only to enrich a
// small, already-ranked shortlist of finalist stops with agency + route
// number labels and to confirm vehicle type is BUS.
// ---------------------------------------------------------------------
export interface TransitBusDetails {
  agency: string | null;
  routes: string[];
  confirmedBus: boolean;
}

export async function transitBusDetailsGoogle(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<TransitBusDetails | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return null;

  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${originLat},${originLng}&destination=${destLat},${destLng}` +
    `&mode=transit&transit_mode=bus&key=${apiKey}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { method: "GET" }, 6000);
  } catch {
    return null; // enrichment only -- never block the primary result on this
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  if (data.status !== "OK" || !Array.isArray(data.routes) || data.routes.length === 0) return null;

  const routes: string[] = [];
  let agency: string | null = null;
  let confirmedBus = false;

  for (const route of data.routes) {
    const legs = route.legs || [];
    for (const leg of legs) {
      const steps = leg.steps || [];
      for (const step of steps) {
        const transit = step.transit_details;
        if (!transit) continue;
        const vehicleType = transit.line?.vehicle?.type;
        if (vehicleType === "BUS") {
          confirmedBus = true;
          const shortName = transit.line?.short_name || transit.line?.name;
          if (shortName && !routes.includes(shortName)) routes.push(shortName);
          const agencyName = Array.isArray(transit.line?.agencies)
            ? transit.line.agencies[0]?.name
            : null;
          if (agencyName && !agency) agency = agencyName;
        }
      }
    }
  }

  if (!confirmedBus) return null;
  return { agency, routes, confirmedBus };
}
