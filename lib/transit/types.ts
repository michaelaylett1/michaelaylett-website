/**
 * Shared types for the "Transit and Bus Stop Access" feature. This file
 * has no side effects and calls no APIs, so it is safe to import from
 * both the server-side lookup code (lib/transit/lookup.ts,
 * app/api/transit/lookup/route.ts) and the client component
 * (components/underwriting/SharedHousingCalculator.tsx) via `import
 * type`, without ever pulling the Google Maps API key or any
 * server-only module into client-side JavaScript.
 */

// ---------------------------------------------------------------------
// Location lookup (spec section 17): one normalized address + coordinate
// result, structured so it can support county identification, county
// tax-rate selection, and the transit lookup below from a single geocode
// call. Only the transit feature actually consumes this today -- county
// selection on this page remains a manual dropdown (see
// COUNTY_EFFECTIVE_TAX_RATES in SharedHousingCalculator.tsx) -- but nothing
// stops a future feature from reusing GeocodeResult for automatic county
// detection without a second geocoding request.
// ---------------------------------------------------------------------
export interface GeocodeResult {
  normalizedAddress: string;
  latitude: number;
  longitude: number;
  county: string | null;
  state: string | null;
  /** City/locality name (Google's "locality" address component, or
   * Nominatim's city/town/village field), used to select which GTFS
   * transit-agency provider(s) serve this property when county alone
   * doesn't line up with an agency's actual service boundary. */
  city: string | null;
  /**
   * County FIPS code. Google's Geocoding API does not return FIPS codes
   * directly, so this is always null on the Google path. Left in the
   * shared shape (rather than omitted) so a future FIPS lookup (for
   * example, the Census Bureau's geocoder) can populate it without
   * changing every caller's type.
   */
  countyFips: string | null;
  provider: "google" | "openstreetmap";
  retrievedAt: string; // ISO timestamp
  /** True when the geocoder itself flagged this as an approximate/partial
   * match (Google's `partial_match` field) rather than an exact address
   * match -- the caller should warn rather than silently trust the
   * coordinates (spec: "Check geocoding"). */
  partialMatch: boolean;
}

// ---------------------------------------------------------------------
// Transit / bus-stop lookup
// ---------------------------------------------------------------------
// Which discovery method(s) actually identified the stop that is being
// reported, formatted for direct display as the "Final Provider Used" /
// "Data Source" field. Official GTFS data from a transit agency is the
// primary source (e.g. "CATS GTFS"); "<Agency> GTFS and Google Places"
// means the same physical stop was independently confirmed by both a
// GTFS feed and Google Places Nearby Search; "Google Places" means only
// Places found it (either no GTFS provider covers this address, or the
// configured GTFS feed didn't include this stop); "OpenStreetMap" is the
// no-Google-API-key fallback path. A plain string (rather than a fixed
// union) because the agency name varies per market -- see
// lib/transit/gtfs/providers.ts for the full list of agencies.
export type TransitDataSource = string;

export const OSM_DATA_SOURCE: TransitDataSource = "OpenStreetMap";
export const GOOGLE_PLACES_DATA_SOURCE: TransitDataSource = "Google Places";

export type TransitMaxWalkMode = "time" | "distance";

export interface TransitMaxWalkSetting {
  mode: TransitMaxWalkMode;
  minutes: number; // used when mode === "time"
  miles: number; // used when mode === "distance"
}

/** Vehicle-type / bus-service confidence for a candidate stop. */
export type BusServiceConfidence =
  | "confirmed" // provider data explicitly lists a bus route/vehicle type
  | "unverified" // provider did not return vehicle-type details
  | "excluded"; // provider data shows this stop is not bus service (rail/subway/etc only)

// "gtfs" = found via an official transit-agency GTFS static feed.
// "places" = found only via Google Places Nearby Search. "both" = the
// same physical stop was independently found by GTFS and Places. "osm" =
// the no-Google-API-key OpenStreetMap fallback path.
export type TransitDiscoveryMethod = "gtfs" | "places" | "both" | "osm";

export interface TransitStopCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  transitAgency: string | null;
  busRoutes: string[];
  busServiceConfidence: BusServiceConfidence;
  discoveryMethod: TransitDiscoveryMethod;
  straightLineMiles: number;
  walkingMiles: number | null;
  walkingMinutes: number | null;
  hasValidWalkingRoute: boolean;
}

export type TransitResultStatus = "pass" | "caution" | "fail" | "noResult";

/** Server-side-only-in-spirit diagnostic detail, gated to an
 * administrator/debug view on the client (never shown to ordinary public
 * users -- spec section 11). Contains no API keys, auth headers, or raw
 * provider response bodies. */
export interface TransitLookupDiagnostics {
  matchedAddress: string;
  latitude: number;
  longitude: number;
  /** Every GTFS provider whose service area matched this location (can
   * be more than one where agencies overlap), with per-provider feed
   * status. Empty when no configured provider covers this address. */
  gtfsProviders: Array<{
    agencyName: string;
    feedConfigured: boolean;
    feedVerified: boolean;
    feedStatus: "ok" | "not_configured" | "failed" | "not_attempted";
    feedLastUpdated: string | null;
    rawStopsWithinRadius: number;
  }>;
  googlePlacesCandidates: number;
  googlePlacesStatus: "ok" | "failed" | "not_attempted" | "not_configured";
  walkingRoutesAttempted: number;
  walkingRoutesSucceeded: number;
  finalProviderUsed: TransitDataSource | null;
  buildVersion: string;
}

export interface TransitLookupResult {
  status: TransitResultStatus;
  matchedAddress: string;
  /** True when the geocoder flagged the match as approximate/partial --
   * surfaced as a warning rather than silently trusted (spec: "Check
   * geocoding"). */
  geocodePartialMatch: boolean;
  nearestStop: TransitStopCandidate | null;
  alternates: TransitStopCandidate[]; // up to 4, excludes nearestStop
  maxWalkSetting: TransitMaxWalkSetting;
  dataSource: TransitDataSource;
  dateChecked: string; // ISO timestamp
  fromCache: boolean;
  message: string;
  diagnostics: TransitLookupDiagnostics;
}

/** Displayed in administrator diagnostics and used to confirm the
 * deployed build actually contains the GTFS-based discovery rewrite
 * (spec section 12: "Confirm that the latest code is actually in the
 * complete website ZIP and deployed"). Bump this string whenever the
 * transit lookup's discovery architecture changes materially. */
export const TRANSIT_LOOKUP_VERSION = "2.0-GTFS";

export interface TransitLookupRequestBody {
  address: string;
  forceRefresh?: boolean;
}

export interface TransitLookupErrorBody {
  success: false;
  /** Diagnostics gathered before the failure, when available (spec
   * section 11) -- lets an administrator tell discovery/routing/
   * filtering/configuration/deployment issues apart even on a failed
   * lookup. Never present for validation errors (e.g. incomplete
   * address) that never reached the discovery stage. */
  diagnostics?: TransitLookupDiagnostics;
  errorCode:
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
  error: string;
}

export interface TransitLookupSuccessBody {
  success: true;
  result: TransitLookupResult;
}

export type TransitLookupResponseBody = TransitLookupSuccessBody | TransitLookupErrorBody;

// ---------------------------------------------------------------------
// Manual override (spec section 14)
// ---------------------------------------------------------------------
export type TransitResultUsed = "automatic" | "pass" | "fail" | "notVerified" | "notApplicable";
