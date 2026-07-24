/**
 * Server-only orchestrator for the "Transit and Bus Stop Access" feature
 * (spec sections 3, 4, 5, 8, 9, 17, 18). This is the only module
 * app/api/transit/lookup/route.ts calls directly; it hides which
 * provider (Google Maps or the OpenStreetMap fallback) actually served
 * the request behind one consistent TransitLookupResult shape, and owns
 * caching, candidate filtering, ranking, and bus-only verification.
 *
 * Provider selection (spec section 5): Google Maps Platform is preferred
 * whenever GOOGLE_MAPS_API_KEY is configured. If it is not configured,
 * this falls back to OpenStreetMap for geocoding and candidate stops
 * only -- it does not fabricate a walking route from a public OSRM demo
 * server, per spec section 5's explicit caution against relying on that
 * for production traffic. Structuring both providers behind the same
 * ProviderAdapter-shaped functions below means a third provider (a paid
 * routing API, a self-hosted OSRM instance, etc.) can be added later by
 * adding one more branch in resolveProvider(), without touching the
 * ranking/caching logic beneath it.
 */
import { getCached, setCached, CACHE_TTL_MS, normalizeAddressKey } from "./cache";
import { haversineMiles, milesToMeters, metersToMiles, secondsToMinutes, round1, round0 } from "./geo";
import { evaluateWalkResult, formatMaxWalkLabel } from "./evaluate";
import {
  geocodeAddressGoogle,
  nearbyBusStopsGoogle,
  computeWalkingRouteGoogle,
  transitBusDetailsGoogle,
  getGoogleMapsApiKey,
  GoogleMapsApiError,
  type RawPlaceCandidate,
} from "./googleMaps";
import { geocodeAddressOsm, nearbyBusStopsOsm } from "./osm";
import type {
  GeocodeResult,
  TransitDataSource,
  TransitLookupResult,
  TransitMaxWalkSetting,
  TransitStopCandidate,
} from "./types";

// Search radius (spec section 8: "approximately two miles").
const SEARCH_RADIUS_MILES = 2;
// How many geographically-closest candidates get an actual walking-route
// API call. Keeps API cost bounded regardless of how many stops exist in
// the radius (spec section 8/18: "sensible API request limits").
const MAX_CANDIDATES_ROUTED = 8;
// Of the routed/ranked candidates, how many get a secondary transit
// "bus details" lookup (agency + route numbers) -- nearest + alternates.
const MAX_CANDIDATES_ENRICHED = 5;
const MAX_ALTERNATES_RETURNED = 4;

const DEFAULT_MAX_WALK: TransitMaxWalkSetting = { mode: "time", minutes: 15, miles: 0.5 };

export class TransitLookupError extends Error {
  code:
    | "incomplete_address"
    | "address_not_found"
    | "ambiguous_address"
    | "not_configured"
    | "billing_not_enabled"
    | "rate_limited"
    | "no_stops_found"
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
// triggers a new API call (spec section 7/18). Status/message are
// computed fresh from this raw data on every call, including cache hits.
// ---------------------------------------------------------------------
interface RawLookup {
  matchedAddress: string;
  dataSource: TransitDataSource;
  candidates: TransitStopCandidate[]; // already ranked by walking time (Google) or straight-line (OSM fallback)
  dateChecked: string;
}

async function performGoogleLookup(address: string): Promise<RawLookup> {
  let geocode: GeocodeResult;
  try {
    geocode = await geocodeAddressGoogle(address);
  } catch (err) {
    if (err instanceof GoogleMapsApiError) throw mapGoogleError(err);
    throw new TransitLookupError("unknown", "Geocoding failed unexpectedly.");
  }

  let rawCandidates: RawPlaceCandidate[];
  try {
    rawCandidates = await nearbyBusStopsGoogle(
      geocode.latitude,
      geocode.longitude,
      milesToMeters(SEARCH_RADIUS_MILES)
    );
  } catch (err) {
    if (err instanceof GoogleMapsApiError) throw mapGoogleError(err);
    throw new TransitLookupError("unknown", "Nearby-stop search failed unexpectedly.");
  }

  if (rawCandidates.length === 0) {
    throw new TransitLookupError(
      "no_stops_found",
      "No bus stops were found within approximately two miles of this address."
    );
  }

  // Straight-line pre-filter (spec section 3/8): never the final
  // displayed distance, only used to cap how many candidates get an
  // actual routed API call.
  const preFiltered = rawCandidates
    .map((c) => ({
      candidate: c,
      straightLineMiles: haversineMiles(geocode.latitude, geocode.longitude, c.latitude, c.longitude),
    }))
    .sort((a, b) => a.straightLineMiles - b.straightLineMiles)
    .slice(0, MAX_CANDIDATES_ROUTED);

  // Compute an actual pedestrian walking route for each shortlisted
  // candidate. Candidates with no valid route (freeway, river, gated
  // complex, etc. separating them from the property) are excluded
  // rather than falling back to straight-line distance (spec section 3/8).
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
  if (withValidRoute.length === 0) {
    throw new TransitLookupError(
      "no_walking_route",
      "A nearby stop was found, but a reliable walking route could not be calculated. Verify the route manually."
    );
  }

  withValidRoute.sort((a, b) => (a.route!.durationSeconds ?? 0) - (b.route!.durationSeconds ?? 0));

  const finalists = withValidRoute.slice(0, MAX_CANDIDATES_ENRICHED);
  const enrichments = await Promise.all(
    finalists.map(({ candidate }) =>
      transitBusDetailsGoogle(geocode.latitude, geocode.longitude, candidate.latitude, candidate.longitude).catch(
        () => null
      )
    )
  );

  const candidates: TransitStopCandidate[] = withValidRoute.map((r, idx) => {
    const enrichment = idx < finalists.length ? enrichments[idx] : null;
    return {
      id: r.candidate.placeId,
      name: r.candidate.name,
      latitude: r.candidate.latitude,
      longitude: r.candidate.longitude,
      address: r.candidate.vicinity,
      transitAgency: enrichment?.agency ?? null,
      busRoutes: enrichment?.routes ?? [],
      // Candidates are already filtered to Places' `bus_station` type
      // (never rail/subway/airport/rideshare), so this is never
      // "excluded" here -- only "confirmed" (a transit-directions lookup
      // matched an actual BUS vehicle-type route) or "unverified" (spec
      // section 9: "label the result 'Bus service should be
      // independently verified'" when vehicle-type details aren't
      // available).
      busServiceConfidence: enrichment?.confirmedBus ? "confirmed" : "unverified",
      straightLineMiles: round1(r.straightLineMiles),
      walkingMiles: round1(metersToMiles(r.route!.distanceMeters)),
      walkingMinutes: round0(secondsToMinutes(r.route!.durationSeconds)),
      hasValidWalkingRoute: true,
    };
  });

  return {
    matchedAddress: geocode.normalizedAddress,
    dataSource: "Google Maps",
    candidates,
    dateChecked: new Date().toISOString(),
  };
}

async function performOsmLookup(address: string): Promise<RawLookup> {
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

  // No walking-route calculation on the OSM fallback path (see file
  // header) -- straight-line distance only, clearly never presented as
  // walking distance. hasValidWalkingRoute stays false on every
  // candidate so the UI and evaluate.ts both treat this as "no reliable
  // walking route," which surfaces the spec's "No Result" state rather
  // than a false pass/fail.
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
      straightLineMiles: round1(haversineMiles(geocode.latitude, geocode.longitude, c.latitude, c.longitude)),
      walkingMiles: null,
      walkingMinutes: null,
      hasValidWalkingRoute: false,
    }))
    .sort((a, b) => a.straightLineMiles - b.straightLineMiles)
    .slice(0, MAX_CANDIDATES_ROUTED);

  return {
    matchedAddress: geocode.normalizedAddress,
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
 * re-evaluation (spec section 7/18).
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
  const raw = useGoogle ? await performGoogleLookup(trimmed) : await performOsmLookup(trimmed);

  setCached(cacheKey, raw, CACHE_TTL_MS.walkingRoute);

  const result = evaluateRawLookup(raw, maxWalkSetting);
  result.fromCache = false;
  return result;
}
