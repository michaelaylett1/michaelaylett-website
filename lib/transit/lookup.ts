/**
 * Server-only orchestrator for the "Transit and Bus Stop Access" feature.
 * This is the only module app/api/transit/lookup/route.ts calls
 * directly; it hides which provider (Google Maps or the OpenStreetMap
 * fallback) actually served the request behind one consistent
 * TransitLookupResult shape, and owns caching, candidate discovery,
 * merging, ranking, and bus-only verification.
 *
 * Bus-stop discovery uses two independent Google methods and merges the
 * results, because relying on Places Nearby Search alone misses ordinary
 * roadside stops that Google has never indexed as a standalone Places
 * record (confirmed by a real-world regression: "Benfield Rd @ Shads
 * Landing" near 5102 Eagle Creek Dr, Charlotte, NC exists in Google's
 * transit-routing/GTFS data and is a real, walkable boarding stop, but
 * Places Nearby Search with type=bus_station returns nothing there):
 *
 *   - Method A (placesNearbySearch): Places Nearby Search, type=bus_station.
 *     Good coverage for larger stations, misses many roadside stops.
 *   - Method B (transitRoutingProbes): probes a transit route from the
 *     property toward 8 points around it (see COMPASS_BEARINGS) and reads
 *     the first bus-mode boarding stop off each response. This surfaces
 *     stops Method A misses, at the cost of a bounded number of extra API
 *     calls (see MAX API cost comment below).
 *
 * The two methods' results are merged and deduplicated (mergeCandidates
 * below) before a dedicated WALK route is computed for each remaining
 * candidate (spec: never trust a transit leg's implied walk time -- get
 * an actual Routes API WALK route separately). See buildRawGoogleLookup.
 *
 * Provider selection: Google Maps Platform is preferred whenever
 * GOOGLE_MAPS_API_KEY is configured. If it is not configured, this falls
 * back to OpenStreetMap for geocoding and candidate stops only -- it does
 * not fabricate a walking route from a public OSRM demo server, per the
 * explicit caution against relying on that for production traffic.
 */
import { getCached, setCached, CACHE_TTL_MS, normalizeAddressKey } from "./cache";
import {
  haversineMiles,
  milesToMeters,
  metersToMiles,
  secondsToMinutes,
  round1,
  round0,
  offsetLatLng,
  COMPASS_BEARINGS,
  coordKey,
  normalizeStopName,
} from "./geo";
import { evaluateWalkResult, formatMaxWalkLabel } from "./evaluate";
import {
  geocodeAddressGoogle,
  nearbyBusStopsGoogle,
  computeWalkingRouteGoogle,
  transitBusDetailsGoogle,
  firstBusBoardingStop,
  getGoogleMapsApiKey,
  GoogleMapsApiError,
  type RawPlaceCandidate,
  type BusBoardingStop,
} from "./googleMaps";
import { geocodeAddressOsm, nearbyBusStopsOsm } from "./osm";
import type {
  GeocodeResult,
  TransitDataSource,
  TransitDiscoveryMethod,
  TransitLookupResult,
  TransitMaxWalkSetting,
  TransitStopCandidate,
} from "./types";

// Search radius (spec: "approximately two miles") for Method A.
const SEARCH_RADIUS_MILES = 2;
// Probe distance for Method B (transit-routing discovery): far enough
// that Google is likely to route via an actual bus rather than "just
// walk," close enough that the FIRST boarding stop on that itinerary is
// still meaningfully "near the property."
const PROBE_DISTANCE_MILES = 4;
// How many geographically-closest MERGED candidates get a dedicated
// walking-route API call. Bounds cost regardless of how many raw
// candidates either method returns.
const MAX_CANDIDATES_ROUTED = 10;
// Of the routed/ranked candidates, how many Places-only (unconfirmed)
// candidates get a secondary transit "bus details" enrichment call.
// Transit-routing-discovered candidates already carry this data from the
// same call that found them, so they never need this second call.
const MAX_CANDIDATES_ENRICHED = 5;
const MAX_ALTERNATES_RETURNED = 4;
// Two candidates within this straight-line distance (or with a matching
// normalized name) are treated as the same physical stop when merging
// Method A and Method B results.
const DEDUPE_DISTANCE_MILES = 0.03; // ~48 meters

const DEFAULT_MAX_WALK: TransitMaxWalkSetting = { mode: "time", minutes: 15, miles: 0.5 };

function logDiag(...parts: unknown[]) {
  // Server-side only (Vercel Function logs / local terminal) -- never
  // sent to the browser. Never logs the API key, request headers, or raw
  // provider response bodies.
  console.log("[transit:lookup]", ...parts);
}

export class TransitLookupError extends Error {
  code:
    | "incomplete_address"
    | "address_not_found"
    | "ambiguous_address"
    | "not_configured"
    | "billing_not_enabled"
    | "rate_limited"
    | "no_stops_found"
    | "verification_unavailable"
    | "no_walking_route"
    | "route_api_failure"
    | "transit_details_unavailable"
    | "timeout"
    | "unknown";
  constructor(code: TransitLookupError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "TransitLookupError";
  }
}

function mapGoogleError(err: GoogleMapsApiError): TransitLookupError {
  switch (err.code) {
    case "not_configured":
      return new TransitLookupError(
        "not_configured",
        "Transit lookup is not configured. Add the Google Maps API key in the Vercel environment variables."
      );
    case "billing_not_enabled":
      return new TransitLookupError(
        "billing_not_enabled",
        "Transit lookup could not authenticate with Google Maps. Verify the API key, billing, and API restrictions in the Google Cloud Console."
      );
    case "rate_limited":
      return new TransitLookupError(
        "rate_limited",
        "Transit lookup has hit Google's rate limit for this project. Please try again in a moment."
      );
    case "not_found":
      return new TransitLookupError(
        "address_not_found",
        "We could not match this property address. Verify the address and try again."
      );
    case "ambiguous":
      return new TransitLookupError(
        "ambiguous_address",
        "This address matched more than one location. Add more detail (unit number, city, ZIP) and try again."
      );
    case "timeout":
      return new TransitLookupError("timeout", "The transit lookup timed out. Please try again.");
    default:
      return new TransitLookupError("unknown", "Transit lookup failed unexpectedly. Please try again.");
  }
}

// ---------------------------------------------------------------------
// Cached "raw" result (candidates + geocode), independent of the
// requested max-walk setting -- so changing the max-walk limit never
// triggers a new API call. Status/message are computed fresh from this
// raw data on every call, including cache hits.
// ---------------------------------------------------------------------
interface RawLookup {
  matchedAddress: string;
  geocodePartialMatch: boolean;
  dataSource: TransitDataSource;
  candidates: TransitStopCandidate[]; // already ranked by walking time (Google) or straight-line (OSM fallback)
  dateChecked: string;
}

// A candidate stop before a dedicated walking route has been computed
// for it, tracking which discovery method(s) found it.
interface MergedCandidate {
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  placeId: string | null;
  agency: string | null;
  routes: string[];
  confirmedBus: boolean;
  discoveryMethod: TransitDiscoveryMethod;
}

function isSameStop(a: { latitude: number; longitude: number; name: string }, b: MergedCandidate): boolean {
  const distance = haversineMiles(a.latitude, a.longitude, b.latitude, b.longitude);
  if (distance <= DEDUPE_DISTANCE_MILES) return true;
  return normalizeStopName(a.name) === normalizeStopName(b.name) && distance <= DEDUPE_DISTANCE_MILES * 4;
}

/**
 * Merges Method A (Places) and Method B (transit-routing probe) results
 * into one deduplicated candidate list. Method B results are deduplicated
 * against each other first (the same real stop is often the first
 * boarding stop for several different probe directions), then matched
 * against Method A results by proximity/name.
 */
function mergeCandidates(places: RawPlaceCandidate[], boardingStops: BusBoardingStop[]): MergedCandidate[] {
  const merged: MergedCandidate[] = places.map((p) => ({
    name: p.name,
    latitude: p.latitude,
    longitude: p.longitude,
    address: p.vicinity,
    placeId: p.placeId,
    agency: null,
    routes: [],
    confirmedBus: false,
    discoveryMethod: "places",
  }));

  // Dedupe Method B stops against each other first.
  const dedupedBoarding: MergedCandidate[] = [];
  for (const stop of boardingStops) {
    const existing = dedupedBoarding.find((c) =>
      isSameStop({ latitude: stop.latitude, longitude: stop.longitude, name: stop.stopName }, c)
    );
    if (existing) {
      if (stop.agency && !existing.agency) existing.agency = stop.agency;
      for (const r of stop.routes) if (!existing.routes.includes(r)) existing.routes.push(r);
      continue;
    }
    dedupedBoarding.push({
      name: stop.stopName,
      latitude: stop.latitude,
      longitude: stop.longitude,
      address: null,
      placeId: null,
      agency: stop.agency,
      routes: [...stop.routes],
      confirmedBus: true,
      discoveryMethod: "transitRouting",
    });
  }

  // Match deduped Method B stops against Method A stops; merge in place
  // or append as new candidates.
  for (const boarding of dedupedBoarding) {
    const existing = merged.find((c) => isSameStop(boarding, c));
    if (existing) {
      existing.confirmedBus = true;
      existing.discoveryMethod = "both";
      if (boarding.agency && !existing.agency) existing.agency = boarding.agency;
      for (const r of boarding.routes) if (!existing.routes.includes(r)) existing.routes.push(r);
    } else {
      merged.push(boarding);
    }
  }

  return merged;
}

async function buildRawGoogleLookup(address: string): Promise<RawLookup> {
  let geocode: GeocodeResult;
  try {
    geocode = await geocodeAddressGoogle(address);
  } catch (err) {
    if (err instanceof GoogleMapsApiError) throw mapGoogleError(err);
    throw new TransitLookupError("unknown", "Geocoding failed unexpectedly.");
  }
  logDiag(
    `geocode: matched="${geocode.normalizedAddress}" lat=${geocode.latitude} lng=${geocode.longitude} partialMatch=${geocode.partialMatch}`
  );
  if (geocode.partialMatch) {
    logDiag("WARNING: geocoder flagged this as a partial/approximate match.");
  }

  // ---- Method A: Places Nearby Search ----------------------------------
  let placesCandidates: RawPlaceCandidate[] = [];
  let placesFailed = false;
  try {
    placesCandidates = await nearbyBusStopsGoogle(
      geocode.latitude,
      geocode.longitude,
      milesToMeters(SEARCH_RADIUS_MILES)
    );
  } catch (err) {
    placesFailed = true;
    if (err instanceof GoogleMapsApiError && (err.code === "billing_not_enabled" || err.code === "rate_limited")) {
      // A hard auth/billing/rate-limit failure on Method A should still
      // let Method B attempt to run (handled below) rather than aborting
      // immediately -- only escalate if BOTH methods end up empty.
      logDiag(`Method A (Places Nearby Search) FAILED: ${err.code} ${err.message}`);
    } else {
      logDiag(`Method A (Places Nearby Search) FAILED: unexpected error`);
    }
  }
  logDiag(`Method A (Places Nearby Search): ${placesCandidates.length} candidate(s), failed=${placesFailed}`);

  // ---- Method B: transit-routing probes in 8 directions -----------------
  const probePoints = COMPASS_BEARINGS.map((bearing) =>
    offsetLatLng(geocode.latitude, geocode.longitude, bearing, PROBE_DISTANCE_MILES)
  );
  const probeOutcomes = await Promise.all(
    probePoints.map(async (p) => {
      try {
        const stop = await firstBusBoardingStop(geocode.latitude, geocode.longitude, p.latitude, p.longitude);
        return { ok: true as const, stop };
      } catch (err) {
        return { ok: false as const, stop: null, error: err };
      }
    })
  );
  const boardingStops = probeOutcomes.filter((o) => o.stop !== null).map((o) => o.stop as BusBoardingStop);
  const probesSucceeded = probeOutcomes.filter((o) => o.ok).length;
  const probesFailed = probeOutcomes.length - probesSucceeded;
  const methodBFailed = probesSucceeded === 0; // every single probe direction errored out
  logDiag(
    `Method B (transit-routing probes): ${probeOutcomes.length} probe(s), ${probesSucceeded} succeeded, ${probesFailed} failed, ${boardingStops.length} boarding stop(s) found`
  );

  const merged = mergeCandidates(placesCandidates, boardingStops);
  logDiag(`merged candidates after dedupe: ${merged.length}`);

  if (merged.length === 0) {
    const bothMethodsRanCleanly = !placesFailed && !methodBFailed;
    if (bothMethodsRanCleanly) {
      throw new TransitLookupError(
        "no_stops_found",
        "No bus stops were found within approximately two miles of this address."
      );
    }
    throw new TransitLookupError(
      "verification_unavailable",
      "We could not verify nearby bus-stop access using the configured data providers. Check transit access manually."
    );
  }

  // Straight-line pre-filter: never the final displayed distance, only
  // used to cap how many merged candidates get an actual routed API call.
  const preFiltered = merged
    .map((candidate) => ({
      candidate,
      straightLineMiles: haversineMiles(geocode.latitude, geocode.longitude, candidate.latitude, candidate.longitude),
    }))
    .sort((a, b) => a.straightLineMiles - b.straightLineMiles)
    .slice(0, MAX_CANDIDATES_ROUTED);

  // Compute a dedicated pedestrian walking route for each shortlisted
  // candidate. Candidates with no valid route (freeway, river, gated
  // complex, etc. separating them from the property) are excluded rather
  // than falling back to straight-line distance.
  const routed = await Promise.all(
    preFiltered.map(async ({ candidate, straightLineMiles }) => {
      let route;
      try {
        route = await computeWalkingRouteGoogle(
          geocode.latitude,
          geocode.longitude,
          candidate.latitude,
          candidate.longitude
        );
      } catch (err) {
        if (err instanceof GoogleMapsApiError && (err.code === "billing_not_enabled" || err.code === "rate_limited")) {
          throw mapGoogleError(err);
        }
        route = null;
      }
      return { candidate, straightLineMiles, route };
    })
  );

  const withValidRoute = routed.filter((r) => r.route !== null);
  logDiag(`walking-route successes: ${withValidRoute.length} of ${routed.length}`);
  if (withValidRoute.length === 0) {
    throw new TransitLookupError(
      "no_walking_route",
      "A nearby stop was found, but a reliable walking route could not be calculated. Verify the route manually."
    );
  }

  withValidRoute.sort((a, b) => (a.route!.durationSeconds ?? 0) - (b.route!.durationSeconds ?? 0));

  // Enrichment (agency/route numbers/BUS confirmation) only for
  // Places-only finalists that don't already carry confirmed transit
  // data from Method B.
  const needsEnrichment = withValidRoute.filter((r) => !r.candidate.confirmedBus).slice(0, MAX_CANDIDATES_ENRICHED);
  const enrichments = await Promise.all(
    needsEnrichment.map((r) =>
      transitBusDetailsGoogle(geocode.latitude, geocode.longitude, r.candidate.latitude, r.candidate.longitude).catch(
        () => null
      )
    )
  );
  const enrichmentByRef = new Map(needsEnrichment.map((r, i) => [r, enrichments[i]]));

  const candidates: TransitStopCandidate[] = withValidRoute.map((r) => {
    const enrichment = enrichmentByRef.get(r);
    const confirmedBus = r.candidate.confirmedBus || !!enrichment?.confirmedBus;
    const agency = r.candidate.agency ?? enrichment?.agency ?? null;
    const routes = r.candidate.routes.length > 0 ? r.candidate.routes : enrichment?.routes ?? [];
    return {
      id: r.candidate.placeId ?? `${coordKey(r.candidate.latitude, r.candidate.longitude)}`,
      name: r.candidate.name,
      latitude: r.candidate.latitude,
      longitude: r.candidate.longitude,
      address: r.candidate.address,
      transitAgency: agency,
      busRoutes: routes,
      busServiceConfidence: confirmedBus ? "confirmed" : "unverified",
      discoveryMethod: r.candidate.discoveryMethod,
      straightLineMiles: round1(r.straightLineMiles),
      walkingMiles: round1(metersToMiles(r.route!.distanceMeters)),
      walkingMinutes: round0(secondsToMinutes(r.route!.durationSeconds)),
      hasValidWalkingRoute: true,
    };
  });

  const winner = candidates[0];
  const dataSource: TransitDataSource =
    winner.discoveryMethod === "both"
      ? "Google Places and Transit Routing"
      : winner.discoveryMethod === "transitRouting"
        ? "Google Transit Routing"
        : "Google Places";
  logDiag(`winning stop "${winner.name}" via ${dataSource}, ${winner.walkingMinutes} min / ${winner.walkingMiles} mi`);

  return {
    matchedAddress: geocode.normalizedAddress,
    geocodePartialMatch: geocode.partialMatch,
    dataSource,
    candidates,
    dateChecked: new Date().toISOString(),
  };
}

async function buildRawOsmLookup(address: string): Promise<RawLookup> {
  const geocode = await geocodeAddressOsm(address);
  if (!geocode) {
    throw new TransitLookupError(
      "address_not_found",
      "We could not match this property address. Verify the address and try again."
    );
  }

  const osmCandidates = await nearbyBusStopsOsm(
    geocode.latitude,
    geocode.longitude,
    milesToMeters(SEARCH_RADIUS_MILES)
  );

  if (osmCandidates.length === 0) {
    throw new TransitLookupError(
      "no_stops_found",
      "No bus stops were found within approximately two miles of this address."
    );
  }

  // No walking-route calculation on the OSM fallback path -- straight-
  // line distance only, clearly never presented as walking distance.
  // hasValidWalkingRoute stays false on every candidate so the UI and
  // evaluate.ts both treat this as "no reliable walking route," which
  // surfaces the "No Result" state rather than a false pass/fail.
  const candidates: TransitStopCandidate[] = osmCandidates
    .map((c) => ({
      id: c.id,
      name: c.name,
      latitude: c.latitude,
      longitude: c.longitude,
      address: null,
      transitAgency: c.tags.operator || c.tags.network || null,
      busRoutes: c.tags.route_ref ? c.tags.route_ref.split(";").map((s) => s.trim()) : [],
      busServiceConfidence: "unverified" as const,
      discoveryMethod: "places" as const,
      straightLineMiles: round1(haversineMiles(geocode.latitude, geocode.longitude, c.latitude, c.longitude)),
      walkingMiles: null,
      walkingMinutes: null,
      hasValidWalkingRoute: false,
    }))
    .sort((a, b) => a.straightLineMiles - b.straightLineMiles)
    .slice(0, MAX_CANDIDATES_ROUTED);

  return {
    matchedAddress: geocode.normalizedAddress,
    geocodePartialMatch: geocode.partialMatch,
    dataSource: "OpenStreetMap",
    candidates,
    dateChecked: new Date().toISOString(),
  };
}

function buildMessage(
  status: TransitLookupResult["status"],
  nearest: TransitStopCandidate | null,
  maxWalkSetting: TransitMaxWalkSetting
): string {
  const limitLabel = formatMaxWalkLabel(maxWalkSetting);
  if (status === "pass" && nearest) {
    return `PASS – The nearest bus stop is approximately ${nearest.walkingMiles} miles or ${nearest.walkingMinutes} minutes away on foot.`;
  }
  if (status === "caution" && nearest) {
    return `CAUTION – The nearest stop is close to the maximum allowed walking distance (${limitLabel}). Verify the route and pedestrian conditions manually.`;
  }
  if (status === "fail" && nearest) {
    return `FAIL – The closest bus stop is approximately ${nearest.walkingMiles} miles or ${nearest.walkingMinutes} minutes away on foot, exceeding the selected ${limitLabel} limit.`;
  }
  return "No reliable bus-stop result was found for this address. Verify transit access manually.";
}

/**
 * Recomputes status/message for an already-fetched RawLookup against a
 * (possibly new) max-walk setting, with zero additional API calls. This
 * is what lets the client change the max-walk limit and get an instant
 * re-evaluation.
 */
export function evaluateRawLookup(raw: RawLookup, maxWalkSetting: TransitMaxWalkSetting): TransitLookupResult {
  const nearest = raw.candidates[0] ?? null;
  const alternates = raw.candidates.slice(1, 1 + MAX_ALTERNATES_RETURNED);

  const evalStatus =
    nearest && nearest.hasValidWalkingRoute
      ? evaluateWalkResult(nearest.walkingMinutes, nearest.walkingMiles, maxWalkSetting)
      : null;
  const status: TransitLookupResult["status"] = evalStatus ?? "noResult";

  return {
    status,
    matchedAddress: raw.matchedAddress,
    geocodePartialMatch: raw.geocodePartialMatch,
    nearestStop: nearest,
    alternates,
    maxWalkSetting,
    dataSource: raw.dataSource,
    dateChecked: raw.dateChecked,
    fromCache: false, // caller overwrites this when serving from cache
    message: buildMessage(status, nearest && nearest.hasValidWalkingRoute ? nearest : null, maxWalkSetting),
  };
}

export interface RunTransitLookupOptions {
  forceRefresh?: boolean;
  maxWalkSetting?: TransitMaxWalkSetting;
}

export async function runTransitLookup(
  address: string,
  options: RunTransitLookupOptions = {}
): Promise<TransitLookupResult> {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    throw new TransitLookupError(
      "incomplete_address",
      "Please enter a complete property address, including city, state, and ZIP code."
    );
  }

  const maxWalkSetting = options.maxWalkSetting ?? DEFAULT_MAX_WALK;
  const cacheKey = `transit:${normalizeAddressKey(trimmed)}`;

  if (!options.forceRefresh) {
    const cached = getCached<RawLookup>(cacheKey);
    if (cached) {
      const result = evaluateRawLookup(cached, maxWalkSetting);
      result.fromCache = true;
      return result;
    }
  }

  const useGoogle = getGoogleMapsApiKey() !== null;
  const raw = useGoogle ? await buildRawGoogleLookup(trimmed) : await buildRawOsmLookup(trimmed);

  setCached(cacheKey, raw, CACHE_TTL_MS.walkingRoute);

  const result = evaluateRawLookup(raw, maxWalkSetting);
  result.fromCache = false;
  return result;
}
