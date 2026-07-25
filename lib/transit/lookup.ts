/**
 * Server-only orchestrator for the "Transit and Bus Stop Access" feature.
 * This is the only module app/api/transit/lookup/route.ts calls
 * directly; it hides which provider actually served the request behind
 * one consistent TransitLookupResult shape, and owns caching, candidate
 * discovery, merging, ranking, and bus-only verification.
 *
 * DISCOVERY ARCHITECTURE (v2.0-GTFS rewrite): a prior version relied on
 * Google Places Nearby Search as the only bus-stop discovery method,
 * then (in a later revision) added a Google Directions transit-routing
 * probe as a second method. Both were still entirely dependent on
 * Google's own indexing of transit data, which does not reliably surface
 * every small roadside stop -- confirmed by a real-world regression:
 * "Benfield Rd @ Shads Landing" near 5102 Eagle Creek Dr, Charlotte, NC
 * is a real, walkable, 0.6mi/13min CATS stop (per Google's own consumer
 * Maps app), but neither Google-only method reliably found it in
 * production.
 *
 * The fix: official transit-agency GTFS static data is now the PRIMARY
 * discovery source (spec: "Do not rely on Google Places as the primary
 * source for small roadside bus stops... Implement GTFS-based stop
 * discovery"). Google Places Nearby Search remains as a supplemental,
 * parallel source -- not the only one -- and results from both are
 * merged and deduplicated. Fallback order:
 *
 *   1. Official transit-agency GTFS data (lib/transit/gtfs/) -- for
 *      whichever agency/agencies serve the property's state/county/city
 *      (lib/transit/gtfs/providers.ts).
 *   2. Google Places Nearby Search (type=bus_station) -- supplemental,
 *      always queried in parallel with GTFS, not just when GTFS is
 *      empty, so a stop found by either source is retained.
 *   3. OpenStreetMap (geocoding + Overpass stop query) -- only used when
 *      GOOGLE_MAPS_API_KEY is not configured at all; GTFS discovery
 *      still runs on this path since it doesn't depend on Google.
 *   4. Manual verification -- surfaced to the user as a "could not
 *      verify" or "no stops found" result, per the error-classification
 *      discipline below, rather than silently guessing.
 *
 * Every candidate stop, regardless of which method discovered it, still
 * gets a dedicated Google Routes API WALK-mode route before it can be
 * reported as the nearest stop -- straight-line distance is only ever
 * used to shortlist candidates for that routing call, never as the
 * displayed final distance.
 */
import { getCached, setCached, CACHE_TTL_MS, normalizeAddressKey } from "./cache";
import {
  haversineMiles,
  milesToMeters,
  metersToMiles,
  secondsToMinutes,
  round1,
  round0,
  coordKey,
  normalizeStopName,
} from "./geo";
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
import { selectProvidersForLocation, resolveFeedUrl } from "./gtfs/providers";
import { loadFeedCached } from "./gtfs/cache";
import { ingestGtfsFeed, getNearbyGtfsStops, GtfsIngestError } from "./gtfs/ingest";
import type { GtfsStopCandidate } from "./gtfs/types";
import type {
  GeocodeResult,
  TransitDataSource,
  TransitDiscoveryMethod,
  TransitLookupDiagnostics,
  TransitLookupResult,
  TransitMaxWalkSetting,
  TransitStopCandidate,
} from "./types";
import { TRANSIT_LOOKUP_VERSION } from "./types";

// Search radius (spec section 7: "at least 2 miles straight-line
// distance"). milesToMeters(2) = 2 * 1609.344 = 3218.688m, matching the
// spec's worked figure of "approximately 3,218.69 meters" -- see the
// unit test for this conversion in the transit regression harness.
const SEARCH_RADIUS_MILES = 2;
const MAX_CANDIDATES_ROUTED = 10;
const MAX_CANDIDATES_ENRICHED = 5;
const MAX_ALTERNATES_RETURNED = 4;
// Two candidates within this straight-line distance (or with a matching
// normalized name) are treated as the same physical stop when merging
// GTFS and Places results.
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
  /** Diagnostics gathered before the failure, when available, so an
   * administrator can tell which discovery stage failed even on an
   * error response (spec section 11). */
  diagnostics?: TransitLookupDiagnostics;
  constructor(code: TransitLookupError["code"], message: string, diagnostics?: TransitLookupDiagnostics) {
    super(message);
    this.code = code;
    this.name = "TransitLookupError";
    this.diagnostics = diagnostics;
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
// Cached "raw" result (candidates + geocode + diagnostics), independent
// of the requested max-walk setting -- so changing the max-walk limit
// never triggers a new API call. Status/message are computed fresh from
// this raw data on every call, including cache hits.
// ---------------------------------------------------------------------
interface RawLookup {
  matchedAddress: string;
  geocodePartialMatch: boolean;
  dataSource: TransitDataSource;
  candidates: TransitStopCandidate[]; // already ranked by walking time (or straight-line on the OSM fallback)
  dateChecked: string;
  diagnostics: TransitLookupDiagnostics;
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
  discoveryMethod: TransitDiscoveryMethod;
}

function isSameStop(a: { latitude: number; longitude: number; name: string }, b: MergedCandidate): boolean {
  const distance = haversineMiles(a.latitude, a.longitude, b.latitude, b.longitude);
  if (distance <= DEDUPE_DISTANCE_MILES) return true;
  return normalizeStopName(a.name) === normalizeStopName(b.name) && distance <= DEDUPE_DISTANCE_MILES * 4;
}

/** Deduplicates GTFS candidates against each other first -- overlapping
 * agency service areas (e.g. GoRaleigh + GoTriangle both serving
 * downtown Raleigh) can report the same physical stop twice. */
function dedupeGtfsCandidates(candidates: GtfsStopCandidate[]): MergedCandidate[] {
  const deduped: MergedCandidate[] = [];
  for (const c of candidates) {
    const existing = deduped.find((d) => isSameStop({ latitude: c.latitude, longitude: c.longitude, name: c.name }, d));
    if (existing) {
      for (const r of c.routeNumbers) if (!existing.routes.includes(r)) existing.routes.push(r);
      continue;
    }
    deduped.push({
      name: c.name,
      latitude: c.latitude,
      longitude: c.longitude,
      address: null,
      placeId: null,
      agency: c.agency,
      routes: [...c.routeNumbers],
      discoveryMethod: "gtfs",
    });
  }
  return deduped;
}

/**
 * Merges deduplicated GTFS candidates with Google Places candidates.
 * GTFS is treated as authoritative for agency/route data (it comes
 * straight from the transit agency's own schedule data); Places
 * contributes a place_id/street-address for the Google Maps "View Bus
 * Stop" deep link and can independently confirm a stop GTFS also found
 * (discoveryMethod "both"), or surface a stop GTFS didn't cover (no
 * configured provider for this market, or the feed didn't include it).
 * Never discards a GTFS-sourced stop merely because Places doesn't know
 * about it (spec section 9: "If GTFS finds a stop but Google Places does
 * not, retain the GTFS result").
 */
function mergeCandidates(gtfsDeduped: MergedCandidate[], places: RawPlaceCandidate[]): MergedCandidate[] {
  const merged: MergedCandidate[] = gtfsDeduped.map((c) => ({ ...c, routes: [...c.routes] }));
  for (const p of places) {
    const asStop = { latitude: p.latitude, longitude: p.longitude, name: p.name };
    const existing = merged.find((c) => isSameStop(asStop, c));
    if (existing) {
      existing.discoveryMethod = "both";
      if (!existing.placeId) existing.placeId = p.placeId;
      if (!existing.address) existing.address = p.vicinity;
    } else {
      merged.push({
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        address: p.vicinity,
        placeId: p.placeId,
        agency: null,
        routes: [],
        discoveryMethod: "places",
      });
    }
  }
  return merged;
}

function buildDataSource(discoveryMethod: TransitDiscoveryMethod, agency: string | null): TransitDataSource {
  if (discoveryMethod === "osm") return "OpenStreetMap";
  const agencyLabel = agency ? `${agency} GTFS` : "GTFS";
  if (discoveryMethod === "gtfs") return agencyLabel;
  if (discoveryMethod === "both") return `${agencyLabel} and Google Places`;
  return "Google Places";
}

/** Queries every GTFS provider whose service area matches the geocoded
 * location, in parallel, tracking per-provider success/failure/coverage
 * for diagnostics -- a provider with no feed configured, or with no
 * stops in range, is not a failure; a feed that fails to download or
 * parse is. */
async function queryGtfsProviders(
  geocode: GeocodeResult
): Promise<{
  candidates: GtfsStopCandidate[];
  anyHardFailure: boolean;
  providerDiagnostics: TransitLookupDiagnostics["gtfsProviders"];
}> {
  const providers = selectProvidersForLocation(geocode.state, geocode.county, geocode.city);
  const candidates: GtfsStopCandidate[] = [];
  const providerDiagnostics: TransitLookupDiagnostics["gtfsProviders"] = [];
  let anyHardFailure = false;

  await Promise.all(
    providers.map(async (provider) => {
      const feedUrl = resolveFeedUrl(provider);
      if (!feedUrl) {
        providerDiagnostics.push({
          agencyName: provider.agencyName,
          feedConfigured: false,
          feedVerified: provider.verified,
          feedStatus: "not_configured",
          feedLastUpdated: null,
          rawStopsWithinRadius: 0,
        });
        return;
      }
      try {
        const feed = await loadFeedCached(feedUrl, () => ingestGtfsFeed(feedUrl, provider.agencyName));
        const nearby = getNearbyGtfsStops(feed, geocode.latitude, geocode.longitude, SEARCH_RADIUS_MILES);
        candidates.push(...nearby);
        providerDiagnostics.push({
          agencyName: provider.agencyName,
          feedConfigured: true,
          feedVerified: provider.verified,
          feedStatus: "ok",
          feedLastUpdated: feed.parsedAt,
          rawStopsWithinRadius: nearby.length,
        });
      } catch (err) {
        anyHardFailure = true;
        const message = err instanceof GtfsIngestError ? `${err.code}: ${err.message}` : "unexpected error";
        logDiag(`GTFS provider "${provider.agencyName}" FAILED: ${message}`);
        providerDiagnostics.push({
          agencyName: provider.agencyName,
          feedConfigured: true,
          feedVerified: provider.verified,
          feedStatus: "failed",
          feedLastUpdated: null,
          rawStopsWithinRadius: 0,
        });
      }
    })
  );

  logDiag(
    `GTFS: ${providers.length} provider(s) matched location (state=${geocode.state} county=${geocode.county} city=${geocode.city}), ${candidates.length} raw stop(s) within ${SEARCH_RADIUS_MILES}mi`
  );
  return { candidates, anyHardFailure, providerDiagnostics };
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
    `geocode: matched="${geocode.normalizedAddress}" lat=${geocode.latitude} lng=${geocode.longitude} county=${geocode.county} city=${geocode.city} partialMatch=${geocode.partialMatch}`
  );
  if (geocode.partialMatch) {
    logDiag("WARNING: geocoder flagged this as a partial/approximate match.");
  }

  // ---- Primary: official transit-agency GTFS data -----------------------
  const gtfsResult = await queryGtfsProviders(geocode);

  // ---- Supplemental: Google Places Nearby Search -------------------------
  let placesCandidates: RawPlaceCandidate[] = [];
  let placesFailed = false;
  let placesStatus: TransitLookupDiagnostics["googlePlacesStatus"] = "not_attempted";
  try {
    placesCandidates = await nearbyBusStopsGoogle(
      geocode.latitude,
      geocode.longitude,
      milesToMeters(SEARCH_RADIUS_MILES)
    );
    placesStatus = "ok";
  } catch (err) {
    placesFailed = true;
    placesStatus = "failed";
    if (err instanceof GoogleMapsApiError && (err.code === "billing_not_enabled" || err.code === "rate_limited")) {
      logDiag(`Google Places FAILED: ${err.code} ${err.message}`);
    } else {
      logDiag("Google Places FAILED: unexpected error");
    }
  }
  logDiag(`Google Places: ${placesCandidates.length} candidate(s), status=${placesStatus}`);

  const gtfsDeduped = dedupeGtfsCandidates(gtfsResult.candidates);
  const merged = mergeCandidates(gtfsDeduped, placesCandidates);
  logDiag(`merged candidates after dedupe: ${merged.length}`);

  const diagnosticsBase: Omit<TransitLookupDiagnostics, "walkingRoutesAttempted" | "walkingRoutesSucceeded" | "finalProviderUsed"> = {
    matchedAddress: geocode.normalizedAddress,
    latitude: geocode.latitude,
    longitude: geocode.longitude,
    gtfsProviders: gtfsResult.providerDiagnostics,
    googlePlacesCandidates: placesCandidates.length,
    googlePlacesStatus: placesStatus,
    buildVersion: TRANSIT_LOOKUP_VERSION,
  };

  if (merged.length === 0) {
    const anyHardFailure = gtfsResult.anyHardFailure || placesFailed;
    const diagnostics: TransitLookupDiagnostics = {
      ...diagnosticsBase,
      walkingRoutesAttempted: 0,
      walkingRoutesSucceeded: 0,
      finalProviderUsed: null,
    };
    if (anyHardFailure) {
      throw new TransitLookupError(
        "verification_unavailable",
        "Transit data could not be verified because the provider request failed. Verify transit access manually.",
        diagnostics
      );
    }
    throw new TransitLookupError(
      "no_stops_found",
      "No bus stops were found within approximately two miles of this address.",
      diagnostics
    );
  }

  // Straight-line pre-filter: never the final displayed distance, only
  // used to cap how many merged candidates get an actual routed API call
  // (spec section 6/7).
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
      "A nearby stop was found, but a reliable walking route could not be calculated. Verify the route manually.",
      { ...diagnosticsBase, walkingRoutesAttempted: routed.length, walkingRoutesSucceeded: 0, finalProviderUsed: null }
    );
  }

  withValidRoute.sort((a, b) => (a.route!.durationSeconds ?? 0) - (b.route!.durationSeconds ?? 0));

  // Enrichment (agency/route numbers/BUS confirmation) only for
  // Places-only finalists that don't already carry GTFS route data.
  const needsEnrichment = withValidRoute
    .filter((r) => r.candidate.discoveryMethod === "places" && r.candidate.routes.length === 0)
    .slice(0, MAX_CANDIDATES_ENRICHED);
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
    // GTFS-sourced (or GTFS+Places "both") candidates are confirmed bus
    // stops by definition -- official schedule data placed a bus trip
    // there. A Places-only candidate is confirmed only if enrichment
    // independently found a BUS-mode transit step serving it; otherwise
    // it stays "unverified" (never discarded -- spec section 8).
    const confirmedBus = r.candidate.discoveryMethod !== "places" || !!enrichment?.confirmedBus;
    const agency = r.candidate.agency ?? enrichment?.agency ?? null;
    const routes = r.candidate.routes.length > 0 ? r.candidate.routes : enrichment?.routes ?? [];
    return {
      id: r.candidate.placeId ?? coordKey(r.candidate.latitude, r.candidate.longitude),
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
  const dataSource = buildDataSource(winner.discoveryMethod, winner.transitAgency);
  logDiag(`winning stop "${winner.name}" via ${dataSource}, ${winner.walkingMinutes} min / ${winner.walkingMiles} mi`);

  return {
    matchedAddress: geocode.normalizedAddress,
    geocodePartialMatch: geocode.partialMatch,
    dataSource,
    candidates,
    dateChecked: new Date().toISOString(),
    diagnostics: {
      ...diagnosticsBase,
      walkingRoutesAttempted: routed.length,
      walkingRoutesSucceeded: withValidRoute.length,
      finalProviderUsed: dataSource,
    },
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

  // GTFS discovery does not depend on Google at all, so it still runs on
  // this no-Google-API-key fallback path.
  const gtfsResult = await queryGtfsProviders(geocode);
  const osmCandidates = await nearbyBusStopsOsm(
    geocode.latitude,
    geocode.longitude,
    milesToMeters(SEARCH_RADIUS_MILES)
  );

  const gtfsDeduped = dedupeGtfsCandidates(gtfsResult.candidates);
  const osmAsMerged: MergedCandidate[] = osmCandidates.map((c) => ({
    name: c.name,
    latitude: c.latitude,
    longitude: c.longitude,
    address: null,
    placeId: null,
    agency: c.tags.operator || c.tags.network || null,
    routes: c.tags.route_ref ? c.tags.route_ref.split(";").map((s) => s.trim()) : [],
    discoveryMethod: "osm" as const,
  }));

  // Merge GTFS (authoritative) with OSM the same way GTFS merges with
  // Places on the Google path.
  const merged: MergedCandidate[] = gtfsDeduped.map((c) => ({ ...c, routes: [...c.routes] }));
  for (const o of osmAsMerged) {
    const existing = merged.find((c) => isSameStop(o, c));
    if (existing) {
      existing.discoveryMethod = "both";
    } else {
      merged.push(o);
    }
  }

  const diagnosticsBase: Omit<TransitLookupDiagnostics, "walkingRoutesAttempted" | "walkingRoutesSucceeded" | "finalProviderUsed"> = {
    matchedAddress: geocode.normalizedAddress,
    latitude: geocode.latitude,
    longitude: geocode.longitude,
    gtfsProviders: gtfsResult.providerDiagnostics,
    googlePlacesCandidates: 0,
    googlePlacesStatus: "not_configured",
    buildVersion: TRANSIT_LOOKUP_VERSION,
  };

  if (merged.length === 0) {
    const diagnostics: TransitLookupDiagnostics = {
      ...diagnosticsBase,
      walkingRoutesAttempted: 0,
      walkingRoutesSucceeded: 0,
      finalProviderUsed: null,
    };
    if (gtfsResult.anyHardFailure) {
      throw new TransitLookupError(
        "verification_unavailable",
        "Transit data could not be verified because the provider request failed. Verify transit access manually.",
        diagnostics
      );
    }
    throw new TransitLookupError(
      "no_stops_found",
      "No bus stops were found within approximately two miles of this address.",
      diagnostics
    );
  }

  // No walking-route calculation on the OSM fallback path -- straight-
  // line distance only, never presented as walking distance.
  // hasValidWalkingRoute stays false on every candidate so the UI and
  // evaluate.ts both treat this as "no reliable walking route," which
  // surfaces the "No Result" state rather than a false pass/fail.
  const candidates: TransitStopCandidate[] = merged
    .map((c) => {
      const straightLineMiles = round1(haversineMiles(geocode.latitude, geocode.longitude, c.latitude, c.longitude));
      return {
        id: coordKey(c.latitude, c.longitude),
        name: c.name,
        latitude: c.latitude,
        longitude: c.longitude,
        address: c.address,
        transitAgency: c.agency,
        busRoutes: c.routes,
        busServiceConfidence: c.discoveryMethod === "gtfs" || c.discoveryMethod === "both" ? ("confirmed" as const) : ("unverified" as const),
        discoveryMethod: c.discoveryMethod,
        straightLineMiles,
        walkingMiles: null,
        walkingMinutes: null,
        hasValidWalkingRoute: false,
      };
    })
    .sort((a, b) => a.straightLineMiles - b.straightLineMiles)
    .slice(0, MAX_CANDIDATES_ROUTED);

  const winner = candidates[0];
  const dataSource = buildDataSource(winner.discoveryMethod, winner.transitAgency);

  return {
    matchedAddress: geocode.normalizedAddress,
    geocodePartialMatch: geocode.partialMatch,
    dataSource,
    candidates,
    dateChecked: new Date().toISOString(),
    diagnostics: {
      ...diagnosticsBase,
      walkingRoutesAttempted: 0,
      walkingRoutesSucceeded: 0,
      finalProviderUsed: dataSource,
    },
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
    diagnostics: raw.diagnostics,
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
