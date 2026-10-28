/**
 * Server-side automatic bus-stop lookup: geocodes the property address,
 * finds nearby transit stops with the Places API, gets an actual
 * walking route (not straight-line distance) to each candidate with the
 * Directions API, and returns whichever stop has the shortest walking
 * time. Only ever called from app/api/transit/auto-lookup/route.ts,
 * which is the only place GOOGLE_MAPS_API_KEY is read -- this module
 * takes the key as a parameter and never reads environment variables
 * itself, so it stays easy to unit-test with a fake key and a mocked
 * fetch.
 *
 * Candidate gathering (regression fix): earlier versions of this module
 * searched Places Nearby Search for type=bus_station only, and only
 * ever tried the broader type=transit_station search as a fallback when
 * that came back completely empty. In practice bus_station rarely comes
 * back empty in a city with light rail -- a nearby rail station is often
 * itself tagged bus_station because it has bus bays -- so the fallback
 * never ran, and an ordinary curbside bus stop (typically tagged only
 * transit_station, not bus_station) never entered the candidate pool at
 * all, even when it was a two-minute walk away. On top of that, Nearby
 * Search's default radius-based ranking is by prominence, not distance,
 * so even the transit_station search could rank a well-known rail
 * station ahead of a small, closer stop within the same radius.
 *
 * This version always queries both bus_station and transit_station (not
 * one as a fallback for the other), merges and de-duplicates the two
 * result sets, and uses rankby=distance instead of a fixed radius so
 * Places itself returns each type's results nearest-first rather than
 * most-prominent-first. The combined candidate pool is then shortlisted
 * by straight-line distance and routed with the Directions API exactly
 * as before -- the stop with the shortest *actual walking time* wins,
 * which now naturally favors a two-minute-walk bus stop over a
 * fifty-nine-minute-walk train station once both are actually in the
 * running, with no separate "prefer buses over trains" rule needed.
 *
 * This intentionally does not reintroduce GTFS or a "no bus stops
 * found" hard failure: a lookup that finds nothing, or that fails for
 * any reason (network, quota, malformed response), just returns a soft
 * status the UI already knows how to fall back on -- the transit fields
 * stay blank and editable. See lib/transit/manual.ts for the
 * client-safe helpers this pairs with.
 */

import { classifyGoogleFailure, sanitizeGoogleDetail, type GoogleFailureKind } from "./googleErrors";

const EARTH_RADIUS_MILES = 3958.7613;
const MAX_WALKING_ROUTE_CANDIDATES = 8; // caps Directions API calls per lookup

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
  matchedAddress: string;
  propertyLatitude: number;
  propertyLongitude: number;
  // Encoded Google polyline (routes[0].overview_polyline.points) for the
  // winning candidate's walking route, captured from the very same
  // Directions API response used for walkingTimeMinutes/
  // walkingDistanceMiles -- never a second API call. Used by the
  // printable report's static map so the printed route matches the
  // live on-page directions exactly. null on the rare response that has
  // a usable duration/distance but no overview polyline.
  routePolyline: string | null;
}

export interface AutoTransitNotFound {
  status: "notFound";
  matchedAddress: string | null;
  // The property still geocoded successfully even though no bus stop
  // was found nearby -- "no transit stop nearby" and "could not
  // geocode this address" are independent outcomes, and callers that
  // only need the property's coordinates (e.g. the Property Street
  // View feature, which has nothing to do with bus stops) should not
  // have to wait for a bus stop to also be found. Null only on the
  // genuinely unexpected case where this function reaches a "notFound"
  // return without ever having geocoded (should not happen given the
  // current pipeline order, but kept nullable defensively).
  propertyLatitude: number | null;
  propertyLongitude: number | null;
}

export interface AutoTransitError {
  status: "error";
  reason: "not_configured" | "geocode_failed" | "request_failed";
  // Specific, non-sensitive diagnosis (see googleErrors.ts) -- added so
  // the UI/console can tell "API not enabled" from "quota" from "bad
  // address" instead of one generic failure. Optional so older callers
  // and saved responses keep working.
  kind?: GoogleFailureKind;
  /** Which pipeline step failed. */
  stage?: "geocode" | "places" | "routes";
  /** Google's own status/message with any API key redacted. */
  detail?: string;
  // The property's coordinates when geocoding itself succeeded before a
  // later step (places/routes) failed -- so Street View, which needs only
  // coordinates, is never blocked by a bus-stop failure.
  propertyLatitude?: number | null;
  propertyLongitude?: number | null;
  matchedAddress?: string | null;
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
 * (seconds), distance (meters), and encoded route polyline for the
 * first route's first leg, or null if the API did not return a usable
 * walking route (this is a normal outcome for some origin/destination
 * pairs, e.g. across water with no footpath -- not necessarily an
 * error). `polyline` is read from the route-level
 * `overview_polyline.points` (not the leg), which is always present
 * whenever `routes[0]` itself is present -- it is optional here only
 * to tolerate a malformed/missing field without discarding the
 * duration/distance that came back fine. */
export function parseDirectionsWalkingResponse(
  body: unknown
): { durationSeconds: number; distanceMeters: number; polyline: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    status?: string;
    routes?: Array<{
      legs?: Array<{ duration?: { value?: number }; distance?: { value?: number } }>;
      overview_polyline?: { points?: string };
    }>;
  };
  if (b.status !== "OK" || !Array.isArray(b.routes) || b.routes.length === 0) return null;
  const route = b.routes[0];
  const leg = route.legs?.[0];
  const durationSeconds = leg?.duration?.value;
  const distanceMeters = leg?.distance?.value;
  if (typeof durationSeconds !== "number" || typeof distanceMeters !== "number") return null;
  const polyline = typeof route.overview_polyline?.points === "string" ? route.overview_polyline.points : null;
  return { durationSeconds, distanceMeters, polyline };
}

/** Merges two Places candidate lists into one, de-duplicated set.
 * Prefers place_id as the identity key (stable across the two searches
 * when the same stop is tagged with both types); falls back to a
 * name+coordinates key for the rare candidate with no place_id, so two
 * genuinely different unnamed-ID stops at different locations are never
 * collapsed into one. */
export function mergeCandidates(a: PlaceCandidate[], b: PlaceCandidate[]): PlaceCandidate[] {
  const seen = new Set<string>();
  const merged: PlaceCandidate[] = [];
  for (const candidate of [...a, ...b]) {
    const key = candidate.placeId ? `id:${candidate.placeId}` : `loc:${candidate.name}|${candidate.location.lat}|${candidate.location.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged;
}

/** Picks the shortlisted candidates to actually spend a Directions API
 * call on -- closest straight-line distance first, capped at
 * MAX_WALKING_ROUTE_CANDIDATES so a single lookup can't run away in
 * cost even if Places returns a long combined candidate list. */
export function shortlistCandidates(propertyLocation: LatLng, candidates: PlaceCandidate[]): PlaceCandidate[] {
  return [...candidates]
    .sort((a, b) => haversineMiles(propertyLocation, a.location) - haversineMiles(propertyLocation, b.location))
    .slice(0, MAX_WALKING_ROUTE_CANDIDATES);
}

/** Given each shortlisted candidate's walking route, picks the one with
 * the shortest walking time (ties broken by shortest distance) -- spec
 * requirement: "choose the one with the shortest walking time." This is
 * what actually keeps a distant train station from winning over a close
 * bus stop: both are routed with real Directions walking times, and the
 * two-minute walk always beats the fifty-nine-minute walk regardless of
 * which type either stop happens to be tagged. */
export function pickShortestWalk(
  routed: Array<{ candidate: PlaceCandidate; durationSeconds: number; distanceMeters: number; polyline: string | null }>
): { candidate: PlaceCandidate; durationSeconds: number; distanceMeters: number; polyline: string | null } | null {
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

async function fetchJson(url: string, init?: RequestInit): Promise<{ httpStatus: number; body: unknown }> {
  const res = await fetch(url, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { httpStatus: res.status, body };
}

/** A Google failure with its diagnosis, as logged and returned. */
export interface GoogleStepFailure {
  kind: GoogleFailureKind;
  detail: string;
}

function logFailure(stage: string, failure: GoogleStepFailure) {
  // Server log only -- detail is already key-redacted.
  console.error(`[transit lookup] ${stage} failed: kind=${failure.kind} detail=${failure.detail}`);
}

/** Extracts a failure from a legacy REST body ({status, error_message}). */
function legacyFailure(httpStatus: number, body: unknown): GoogleStepFailure {
  const b = (body && typeof body === "object" ? body : {}) as { status?: string; error_message?: string };
  const status = b.status || String(httpStatus);
  const message = b.error_message || "";
  return {
    kind: classifyGoogleFailure(status, message),
    detail: sanitizeGoogleDetail(`${status}${message ? `: ${message}` : ""}`),
  };
}

/** Extracts a failure from a new-API body ({error:{code,status,message}}). */
function newApiFailure(httpStatus: number, body: unknown): GoogleStepFailure {
  const b = (body && typeof body === "object" ? body : {}) as { error?: { code?: number; status?: string; message?: string } };
  const status = b.error?.status || String(b.error?.code ?? httpStatus);
  const message = b.error?.message || "";
  return {
    kind: classifyGoogleFailure(status, message),
    detail: sanitizeGoogleDetail(`${status}${message ? `: ${message}` : ""}`),
  };
}

export interface GeocodeSuccess {
  ok: true;
  location: LatLng;
  formattedAddress: string;
  stateAbbreviation: string | null;
  county: string | null;
}
export type GeocodeOutcome = GeocodeSuccess | ({ ok: false } & GoogleStepFailure);

/** Geocodes a free-text address (Geocoding API). Never throws. Also
 * returns the state and county so one call can drive Street View, the
 * state-based operating-expense defaults, and the county suggestion. */
export async function geocodeAddress(address: string, apiKey: string): Promise<GeocodeOutcome> {
  if (!apiKey) return { ok: false, kind: "not_configured", detail: "GOOGLE_MAPS_API_KEY is empty" };
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const { httpStatus, body } = await fetchJson(url);
    const parsed = parseGeocodeResponse(body);
    if (parsed) {
      const first = (body as { results: Array<{ address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }> }> })
        .results[0];
      const comps = first.address_components || [];
      return {
        ok: true,
        location: parsed.location,
        formattedAddress: parsed.formattedAddress,
        stateAbbreviation: comps.find((c) => c.types?.includes("administrative_area_level_1"))?.short_name || null,
        county: comps.find((c) => c.types?.includes("administrative_area_level_2"))?.long_name || null,
      };
    }
    const status = (body as { status?: string } | null)?.status;
    if (status === "ZERO_RESULTS") return { ok: false, kind: "address_not_found", detail: "ZERO_RESULTS" };
    return { ok: false, ...legacyFailure(httpStatus, body) };
  } catch (err) {
    return { ok: false, kind: "network", detail: sanitizeGoogleDetail(err) };
  }
}

type StopsOutcome = { ok: true; candidates: PlaceCandidate[] } | ({ ok: false } & GoogleStepFailure);

/** Legacy Places Nearby Search, nearest-first (rankby=distance). */
async function fetchNearbyStopsLegacy(location: LatLng, apiKey: string, type: string): Promise<StopsOutcome> {
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${location.lat},${location.lng}&rankby=distance&type=${type}&key=${apiKey}`;
    const { httpStatus, body } = await fetchJson(url);
    const status = (body as { status?: string } | null)?.status;
    if (status === "OK" || status === "ZERO_RESULTS") return { ok: true, candidates: parsePlacesResponse(body) };
    return { ok: false, ...legacyFailure(httpStatus, body) };
  } catch (err) {
    return { ok: false, kind: "network", detail: sanitizeGoogleDetail(err) };
  }
}

/** Parses a Places API (New) searchNearby response. */
export function parsePlacesNewResponse(body: unknown): PlaceCandidate[] {
  const b = body as { places?: Array<{ id?: string; displayName?: { text?: string }; location?: { latitude?: number; longitude?: number } }> } | null;
  if (!b || !Array.isArray(b.places)) return [];
  const out: PlaceCandidate[] = [];
  for (const p of b.places) {
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    out.push({ name: p.displayName?.text || "Transit stop", placeId: p.id || null, location: { lat, lng } });
  }
  return out;
}

/** Places API (New) Nearby Search, used when the legacy endpoint is
 * denied (Google no longer enables the legacy Places API on new
 * projects, and a project/key can have one enabled without the other). */
async function fetchNearbyStopsNew(location: LatLng, apiKey: string): Promise<StopsOutcome> {
  try {
    const { httpStatus, body } = await fetchJson("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.location",
      },
      body: JSON.stringify({
        includedTypes: ["bus_station", "transit_station", "bus_stop"],
        maxResultCount: 20,
        rankPreference: "DISTANCE",
        locationRestriction: { circle: { center: { latitude: location.lat, longitude: location.lng }, radius: 3000 } },
      }),
    });
    if (httpStatus >= 200 && httpStatus < 300) return { ok: true, candidates: parsePlacesNewResponse(body) };
    return { ok: false, ...newApiFailure(httpStatus, body) };
  } catch (err) {
    return { ok: false, kind: "network", detail: sanitizeGoogleDetail(err) };
  }
}

type WalkOutcome =
  | { ok: true; route: { durationSeconds: number; distanceMeters: number; polyline: string | null } | null }
  | ({ ok: false } & GoogleStepFailure);

async function walkLegacy(origin: LatLng, dest: LatLng, apiKey: string): Promise<WalkOutcome> {
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}&mode=walking&key=${apiKey}`;
    const { httpStatus, body } = await fetchJson(url);
    const status = (body as { status?: string } | null)?.status;
    if (status === "OK") return { ok: true, route: parseDirectionsWalkingResponse(body) };
    if (status === "ZERO_RESULTS" || status === "NOT_FOUND") return { ok: true, route: null };
    return { ok: false, ...legacyFailure(httpStatus, body) };
  } catch (err) {
    return { ok: false, kind: "network", detail: sanitizeGoogleDetail(err) };
  }
}

/** Parses a Routes API computeRoutes walking response. */
export function parseRoutesWalkingResponse(
  body: unknown
): { durationSeconds: number; distanceMeters: number; polyline: string | null } | null {
  const b = body as { routes?: Array<{ duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }> } | null;
  const r = b?.routes?.[0];
  if (!r || typeof r.distanceMeters !== "number" || typeof r.duration !== "string") return null;
  const seconds = Number.parseFloat(r.duration.replace(/s$/, ""));
  if (!Number.isFinite(seconds)) return null;
  return { durationSeconds: seconds, distanceMeters: r.distanceMeters, polyline: r.polyline?.encodedPolyline ?? null };
}

/** Routes API (New) walking route, used when the legacy Directions API
 * is denied. */
async function walkRoutesApi(origin: LatLng, dest: LatLng, apiKey: string): Promise<WalkOutcome> {
  try {
    const { httpStatus, body } = await fetchJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
        travelMode: "WALK",
      }),
    });
    if (httpStatus >= 200 && httpStatus < 300) return { ok: true, route: parseRoutesWalkingResponse(body) };
    return { ok: false, ...newApiFailure(httpStatus, body) };
  } catch (err) {
    return { ok: false, kind: "network", detail: sanitizeGoogleDetail(err) };
  }
}

/** Kinds that mean "this endpoint is not usable with this key/project",
 * where trying the other (legacy <-> new) API generation can help. */
function shouldTryOtherApiGeneration(kind: GoogleFailureKind): boolean {
  return kind === "api_not_enabled" || kind === "key_rejected" || kind === "unknown";
}

/**
 * Full pipeline: geocode (or reuse supplied coordinates) -> nearby transit
 * stops -> walking route to each shortlisted stop -> shortest walking time
 * wins. Each Google step tries the legacy API first and falls back to the
 * current (New) API when the legacy one is denied, and any failure comes
 * back with a specific `kind`/`stage`/`detail` (never an API key) rather
 * than a generic error. Geocoded coordinates are always returned, even on
 * failure, so Street View never depends on the bus-stop steps succeeding.
 */
export async function lookupNearestBusStopByWalking(
  address: string,
  apiKey: string,
  knownLocation?: { lat: number; lng: number; formattedAddress?: string | null }
): Promise<AutoTransitLookupResult> {
  if (!apiKey) return { status: "error", reason: "not_configured", kind: "not_configured" };

  let propertyLocation: LatLng;
  let formattedAddress: string;
  if (knownLocation && Number.isFinite(knownLocation.lat) && Number.isFinite(knownLocation.lng)) {
    propertyLocation = { lat: knownLocation.lat, lng: knownLocation.lng };
    formattedAddress = knownLocation.formattedAddress || "";
  } else {
    const geo = await geocodeAddress(address, apiKey);
    if (!geo.ok) {
      logFailure("geocode", geo);
      return {
        status: "error",
        reason: geo.kind === "network" ? "request_failed" : "geocode_failed",
        kind: geo.kind,
        stage: "geocode",
        detail: geo.detail,
      };
    }
    propertyLocation = geo.location;
    formattedAddress = geo.formattedAddress;
  }

  const base = {
    propertyLatitude: propertyLocation.lat,
    propertyLongitude: propertyLocation.lng,
    matchedAddress: formattedAddress || null,
  };

  // --- Candidate stops -------------------------------------------------
  let candidates: PlaceCandidate[] = [];
  const [busResult, transitResult] = await Promise.all([
    fetchNearbyStopsLegacy(propertyLocation, apiKey, "bus_station"),
    fetchNearbyStopsLegacy(propertyLocation, apiKey, "transit_station"),
  ]);
  if (busResult.ok || transitResult.ok) {
    candidates = mergeCandidates(busResult.ok ? busResult.candidates : [], transitResult.ok ? transitResult.candidates : []);
  } else {
    logFailure("places (legacy)", busResult);
    const fresh = shouldTryOtherApiGeneration(busResult.kind) ? await fetchNearbyStopsNew(propertyLocation, apiKey) : null;
    if (fresh && fresh.ok) {
      candidates = fresh.candidates;
    } else {
      const failure = fresh && !fresh.ok ? fresh : busResult;
      if (fresh && !fresh.ok) logFailure("places (new)", fresh);
      return {
        status: "error",
        reason: "request_failed",
        kind: failure.kind,
        stage: "places",
        detail: failure.detail,
        ...base,
      };
    }
  }

  if (candidates.length === 0) {
    return { status: "notFound", matchedAddress: base.matchedAddress, propertyLatitude: base.propertyLatitude, propertyLongitude: base.propertyLongitude };
  }

  // --- Walking routes ----------------------------------------------------
  const shortlist = shortlistCandidates(propertyLocation, candidates);
  const routed: Array<{ candidate: PlaceCandidate; durationSeconds: number; distanceMeters: number; polyline: string | null }> = [];
  let firstRouteFailure: GoogleStepFailure | null = null;
  let useRoutesApi = false;

  for (const candidate of shortlist) {
    let outcome: WalkOutcome = useRoutesApi
      ? await walkRoutesApi(propertyLocation, candidate.location, apiKey)
      : await walkLegacy(propertyLocation, candidate.location, apiKey);

    if (!outcome.ok && !useRoutesApi && shouldTryOtherApiGeneration(outcome.kind)) {
      logFailure("directions (legacy)", outcome);
      const fresh = await walkRoutesApi(propertyLocation, candidate.location, apiKey);
      if (fresh.ok) useRoutesApi = true; // stick with the generation that works for the remaining stops
      else logFailure("routes (new)", fresh);
      outcome = fresh.ok ? fresh : outcome;
    }

    if (outcome.ok) {
      if (outcome.route) routed.push({ candidate, ...outcome.route });
    } else if (!firstRouteFailure) {
      firstRouteFailure = { kind: outcome.kind, detail: outcome.detail };
    }
  }

  const best = pickShortestWalk(routed);
  if (!best) {
    if (firstRouteFailure) {
      // Every route attempt errored (as opposed to Google saying "no
      // walking path") -- a configuration/quota problem, not "no route".
      return { status: "error", reason: "request_failed", kind: firstRouteFailure.kind, stage: "routes", detail: firstRouteFailure.detail, ...base };
    }
    return { status: "notFound", matchedAddress: base.matchedAddress, propertyLatitude: base.propertyLatitude, propertyLongitude: base.propertyLongitude };
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
    matchedAddress: formattedAddress || address,
    propertyLatitude: propertyLocation.lat,
    propertyLongitude: propertyLocation.lng,
    routePolyline: best.polyline,
  };
}
