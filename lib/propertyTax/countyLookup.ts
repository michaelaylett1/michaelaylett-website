/**
 * Server-side automatic county lookup for the Property Tax section's
 * "Suggested from property address" feature. Geocodes the property
 * address with Google's Geocoding API and reads the county straight out
 * of the address_components the API already returns (the component
 * typed "administrative_area_level_2"), rather than inferring it from
 * the city name or ZIP code via a separate static table -- the same
 * approach lib/transit/googleLookup.ts already uses for the automatic
 * transit lookup, and reusing that pattern (and the same
 * GOOGLE_MAPS_API_KEY server env var) keeps county lookup consistent
 * with it.
 *
 * Only ever called from app/api/property-tax/county-lookup/route.ts,
 * which is the only place GOOGLE_MAPS_API_KEY is read -- this module
 * takes the key as a parameter and never reads environment variables
 * itself, so it stays easy to unit-test with a fake key and a mocked
 * fetch.
 *
 * This intentionally never throws: every network call is wrapped, and
 * every outcome (found, not found, or any of several error reasons)
 * comes back as a plain result object the client already knows how to
 * fall back on -- a failed or inconclusive lookup never blocks the rest
 * of underwriting, it just leaves the County field available for manual
 * entry.
 */

export interface CountyLookupFound {
  status: "found";
  /** Long name of the county-equivalent component, e.g. "Dallas County". */
  county: string;
  /** Short (abbreviated) name of the state, e.g. "TX". */
  stateAbbreviation: string;
  /** The address Google actually matched against, for display/debugging. */
  matchedAddress: string;
}

export interface CountyLookupNotFound {
  status: "notFound";
  /** The address Google matched, when available, even though no county
   * (administrative_area_level_2) component came back for it -- this
   * does happen for some addresses (e.g. independent cities, some
   * non-US addresses) and is a normal, expected outcome, not an error. */
  matchedAddress: string | null;
  /** The state component (administrative_area_level_1 short_name) is
   * read independently of whether a county component was present, so
   * callers that only need the state (e.g. state-based operating
   * expense defaults) still get it even on an otherwise "notFound"
   * county outcome. Null when Google returned no state component either
   * (e.g. ZERO_RESULTS, or a non-US address with no equivalent level). */
  stateAbbreviation: string | null;
}

export interface CountyLookupError {
  status: "error";
  reason: "not_configured" | "geocode_failed" | "request_failed";
}

export type CountyLookupResult = CountyLookupFound | CountyLookupNotFound | CountyLookupError;

interface AddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

/** Parses a Geocoding API response body into a county + state, or a
 * "notFound" outcome distinguishing "Google matched an address but had
 * no county component for it" from "the request itself failed" -- the
 * caller only ever returns CountyLookupError for the latter. */
export function parseCountyFromGeocodeResponse(
  body: unknown
):
  | { status: "found"; county: string; stateAbbreviation: string; matchedAddress: string }
  | { status: "notFound"; matchedAddress: string | null; stateAbbreviation: string | null }
  | null {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    status?: string;
    results?: Array<{ address_components?: AddressComponent[]; formatted_address?: string }>;
  };

  // ZERO_RESULTS is a normal "notFound" outcome, not a request failure.
  if (b.status === "ZERO_RESULTS") return { status: "notFound", matchedAddress: null, stateAbbreviation: null };
  if (b.status !== "OK" || !Array.isArray(b.results) || b.results.length === 0) return null;

  const first = b.results[0];
  const components = first.address_components || [];
  const matchedAddress = first.formatted_address || "";

  const countyComponent = components.find((c) => c.types?.includes("administrative_area_level_2"));
  const stateComponent = components.find((c) => c.types?.includes("administrative_area_level_1"));

  if (!countyComponent?.long_name) {
    // The state component is read independently of the county component,
    // so a "notFound" county outcome (e.g. an independent city, or an
    // address Google can only resolve to state-level accuracy) can still
    // carry a usable state abbreviation for callers that only need that.
    return {
      status: "notFound",
      matchedAddress: matchedAddress || null,
      stateAbbreviation: stateComponent?.short_name || null,
    };
  }

  return {
    status: "found",
    county: countyComponent.long_name,
    stateAbbreviation: stateComponent?.short_name || "",
    matchedAddress: matchedAddress || countyComponent.long_name,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

/** Full pipeline: geocode the address, then read the county straight off
 * the address_components. Every network call is wrapped so a single
 * failed request degrades to "error" rather than throwing -- the API
 * route always returns a JSON body the client can act on. */
export async function lookupCountyFromAddress(address: string, apiKey: string): Promise<CountyLookupResult> {
  if (!apiKey) return { status: "error", reason: "not_configured" };

  let body: unknown;
  try {
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${apiKey}`;
    body = await fetchJson(geocodeUrl);
  } catch {
    return { status: "error", reason: "request_failed" };
  }

  const parsed = parseCountyFromGeocodeResponse(body);
  if (parsed === null) {
    // Google responded, but with a status other than OK/ZERO_RESULTS --
    // OVER_QUERY_LIMIT, REQUEST_DENIED, INVALID_REQUEST, UNKNOWN_ERROR,
    // or a malformed body. Surfaced as a soft "geocode_failed" error so
    // the client can show its neutral fallback message rather than
    // treating this as a hard failure of the whole underwriting form.
    return { status: "error", reason: "geocode_failed" };
  }

  return parsed;
}
