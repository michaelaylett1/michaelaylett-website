/**
 * Server-side automatic bus-stop lookup: geocodes the property address,
 * finds nearby bus stops with the Places API, gets an actual walking
 * route (not straight-line distance) to each candidate with the
 * Directions API, and returns whichever stop has the shortest walking
 * time. Only ever called from app/api/transit/auto-lookup/route.ts,
 * which is the only place GOOGLE_MAPS_API_KEY is read -- this module
 * takes the key as a parameter and never reads environment variables
 * itself, so it stays easy to unit-test with a fake key and a mocked
 * fetch.
 *
 * This intentionally does not reintroduce GTFS or a "no bus stops
 * found" hard failure: a lookup that finds nothing, or that fails for
 * any reason (network, quota, malformed response), just returns a soft
 * status the UI already knows how to fall back on -- the manual
 * verification fields stay blank and editable. See lib/transit/
 * manual.ts for the client-safe helpers this pairs with.
 */

const EARTH_RADIUS_MILES = 3958.7613;
const SEARCH_RADIUS_METERS = 3218.69; // ~2 miles, same radius used throughout this feature
const MAX_WALKING_ROUTE_CANDIDATES = 6; // caps Directions API calls per lookup

export interface AutoNearestStop {
  name: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
}

export interface AutoTransitFound {
  status: "found";
  nearestStop: AutoNearestStop;
  walkingTimeMinutes: number;
  walkingDistanceMiles: number;
  /** Google's Places/Directions APIs do not reliably expose a transit
   * agency name for a bus stop -- this is null far more often than
   * not. Left in the response shape (rather than omitted) so the
   * client and callers have one consistent "found" shape to handle. */
  transitAgency: string | null;
  matchedAddress: string;
  propertyLatitude: number;
  propertyLongitude: number;
}

export interface AutoTransitNotFound {
  status: "notFound";
  matchedAddress: string | null;
}

export interface AutoTransitError {
  status: "error";
  reason: "not_configured" | "geocode_failed" | "request_failed";
}

export type AutoTransitLookupResult = AutoTransitFound | AutoTransitNotFound | AutoTransitError;

interface LatLng {
  lat: number;
  lng: number;
}

interface PlaceCandidate {
  name: string;
  placeId: string | null;
  location: LatLng;
}

/** Straight-line distance in miles, used only to shortlist Places
 * candidates before spending a Directions API call on each one -- the
 * reported walking distance always comes from the Directions response,
 * never from this. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Parses a Geocoding API response body into a single best match, or
 * null if the API reported anything other than exactly OK with at
 * least one result. */
export function parseGeocodeResponse(body: unknown): { location: LatLng; formattedAddress: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { status?: string; results?: Array<{ geometry?: { location?: LatLng }; formatted_address?: string }> };
  if (b.status !== "OK" || !Array.isArray(b.results) || b.results.length === 0) return null;
  const first = b.results[0];
  const location = first.geometry?.location;
  if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") return null;
  return { location, formattedAddress: first.formatted_address || "" };
}

/** Parses a Places Nearby Search response body into a flat candidate
 * list. Returns an empty array (not null) for a clean "zero results"
 * response, since that is a normal, expected outcome, not an error. */
export function parsePlacesResponse(body: unknown): PlaceCandidate[] {
  if (!body || typeof body !== "object") return [];
  const b = body as {
    status?: string;
    results?: Array<{ name?: string; place_id?: string; geometry?: { location?: LatLng } }>;
  };
  if (b.status !== "OK" && b.status !== "ZERO_RESULTS") return [];
  if (!Array.isArray(b.results)) return [];
  const candidates: PlaceCandidate[] = [];
  for (const r of b.results) {
    const location = r.geometry?.location;
    if (!r.name || !location || typeof location.lat !== "number" || typeof location.lng !== "number") continue;
    candidates.push({ name: r.name, placeId: r.place_id || null, location });
  }
  return candidates;
}

/** Parses a walking-mode Directions API response body into a duration
 * (seconds) and distance (meters) for the first route's first leg, or
 * null if the API did not return a usable walking route (this is a
 * normal outcome for some origin/destination pairs, e.g. across water
 * with no footpath -- not necessarily an error). */
export function parseDirectionsWalkingResponse(body: unknown): { durationSeconds: number; distanceMeters: number } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    status?: string;
    routes?: Array<{ legs?: Array<{ duration?: { value?: number }; distance?: { value?: number } }> }>;
  };
  if (b.status !== "OK" || !Array.isArray(b.routes) || b.routes.length === 0) return null;
  const leg = b.routes[0].legs?.[0];
  const durationSeconds = leg?.duration?.value;
  const distanceMeters = leg?.distance?.value;
  if (typeof durationSeconds !== "number" || typeof distanceMeters !== "number") return null;
  return { durationSeconds, distanceMeters };
}

/** Picks the shortlisted candidates to actually spend a Directions API
 * call on -- closest straight-line distance first, capped at
 * MAX_WALKING_ROUTE_CANDIDATES so a single lookup can't run away in
 * cost even if Places returns a long candidate list. */
export function shortlistCandidates(propertyLocation: LatLng, candidates: PlaceCandidate[]): PlaceCandidate[] {
  return [...candidates]
    .sort((a, b) => haversineMiles(propertyLocation, a.location) - haversineMiles(propertyLocation, b.location))
    .slice(0, MAX_WALKING_ROUTE_CANDIDATES);
}

/** Given each shortlisted candidate's walking route, picks the one with
 * the shortest walking time (ties broken by shortest distance) -- spec
 * requirement: "choose the one with the shortest walking time." */
export function pickShortestWalk(
  routed: Array<{ candidate: PlaceCandidate; durationSeconds: number; distanceMeters: number }>
): { candidate: PlaceCandidate; durationSeconds: number; distanceMeters: number } | null {
  if (routed.length === 0) return null;
  return routed.reduce((best, current) => {
    if (current.durationSeconds < best.durationSeconds) return current;
    if (current.durationSeconds === best.durationSeconds && current.distanceMeters < best.distanceMeters) return current;
    return best;
  }, routed[0]);
}

function metersToMiles(meters: number): number {
  return meters / 1609.34;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

/**
 * Full pipeline: geocode -> nearby bus stops -> walking route to each
 * shortlisted candidate -> shortest walking time wins. Every network
 * call is wrapped so a single failed request degrades to "error"
 * rather than throwing -- the API route always returns a JSON body the
 * client can act on.
 */
export async function lookupNearestBusStopByWalking(address: string, apiKey: string): Promise<AutoTransitLookupResult> {
  if (!apiKey) return { status: "error", reason: "not_configured" };

  let geocode: { location: LatLng; formattedAddress: string } | null;
  try {
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${apiKey}`;
    geocode = parseGeocodeResponse(await fetchJson(geocodeUrl));
  } catch {
    return { status: "error", reason: "request_failed" };
  }
  if (!geocode) return { status: "error", reason: "geocode_failed" };

  const { location: propertyLocation, formattedAddress } = geocode;

  let placesBody: unknown;
  try {
    const placesUrl =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${propertyLocation.lat},${propertyLocation.lng}` +
      `&radius=${SEARCH_RADIUS_METERS}` +
      `&type=bus_station` +
      `&key=${apiKey}`;
    placesBody = await fetchJson(placesUrl);
  } catch {
    return { status: "error", reason: "request_failed" };
  }
  let candidates = parsePlacesResponse(placesBody);

  if (candidates.length === 0) {
    // Fall back to a looser transit_station search -- some agencies tag
    // roadside bus stops under this type instead of bus_station.
    try {
      const fallbackUrl =
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
        `?location=${propertyLocation.lat},${propertyLocation.lng}` +
        `&radius=${SEARCH_RADIUS_METERS}` +
        `&type=transit_station` +
        `&key=${apiKey}`;
      candidates = parsePlacesResponse(await fetchJson(fallbackUrl));
    } catch {
      // A failed fallback request still leaves the primary search's
      // (empty) result standing -- fall through to notFound below
      // rather than reporting an error for what may just be a real
      // zero-result address.
    }
  }

  if (candidates.length === 0) {
    return { status: "notFound", matchedAddress: formattedAddress || null };
  }

  const shortlist = shortlistCandidates(propertyLocation, candidates);

  const routed: Array<{ candidate: PlaceCandidate; durationSeconds: number; distanceMeters: number }> = [];
  for (const candidate of shortlist) {
    try {
      const directionsUrl =
        `https://maps.googleapis.com/maps/api/directions/json` +
        `?origin=${propertyLocation.lat},${propertyLocation.lng}` +
        `&destination=${candidate.location.lat},${candidate.location.lng}` +
        `&mode=walking` +
        `&key=${apiKey}`;
      const parsed = parseDirectionsWalkingResponse(await fetchJson(directionsUrl));
      if (parsed) {
        routed.push({ candidate, durationSeconds: parsed.durationSeconds, distanceMeters: parsed.distanceMeters });
      }
    } catch {
      // Skip this candidate's route on a failed request -- other
      // candidates can still produce a usable result.
    }
  }

  const best = pickShortestWalk(routed);
  if (!best) {
    return { status: "notFound", matchedAddress: formattedAddress || null };
  }

  return {
    status: "found",
    nearestStop: {
      name: best.candidate.name,
      latitude: best.candidate.location.lat,
      longitude: best.candidate.location.lng,
      placeId: best.candidate.placeId,
    },
    walkingTimeMinutes: Math.round(best.durationSeconds / 60),
    walkingDistanceMiles: Math.round(metersToMiles(best.distanceMeters) * 100) / 100,
    // See the AutoTransitFound doc comment above -- Places/Directions
    // do not expose this reliably, so it is left for manual entry.
    transitAgency: null,
    matchedAddress: formattedAddress || address,
    propertyLatitude: propertyLocation.lat,
    propertyLongitude: propertyLocation.lng,
  };
}
