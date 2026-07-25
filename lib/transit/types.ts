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
// reported. "Google Places" = found only via Places Nearby Search
// (type=bus_station). "Google Transit Routing" = found only by reading
// the first bus-mode boarding stop off a probed transit route (this is
// what catches roadside stops Places never indexed). "Google Places and
// Transit Routing" = the same physical stop was independently found by
// both methods.
export type TransitDataSource =
  | "Google Places"
  | "Google Transit Routing"
  | "Google Places and Transit Routing"
  | "OpenStreetMap";

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

export type TransitDiscoveryMethod = "places" | "transitRouting" | "both";

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
}

export interface TransitLookupRequestBody {
  address: string;
  forceRefresh?: boolean;
}

export interface TransitLookupErrorBody {
  success: false;
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
