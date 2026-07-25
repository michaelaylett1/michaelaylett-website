/**
 * "Transit and Bus Stop Access" -- fully automatic, continuously
 * editable Google Maps lookup.
 *
 * The nearest bus stop and walking route are found automatically (see
 * lib/transit/googleLookup.ts and app/api/transit/auto-lookup/, which
 * call the Places, Directions, and Geocoding APIs server-side) as soon
 * as a complete-looking Property Address is entered, and pre-fill the
 * fields below immediately -- there is no separate save or verification
 * step. Every field stays editable at all times, and whatever is
 * currently in them is what feeds the underwriting summary, print
 * report, and Excel export. If the automatic lookup is unavailable or
 * finds nothing, the fields simply stay blank for hand entry -- there
 * is no automatic "no bus stops were found" failure result. See
 * components/underwriting/SharedHousingCalculator.tsx's
 * TransitAndBusStopAccessSection for the UI that uses this module.
 *
 * This file itself is pure logic with no network calls and no
 * environment variables, so it is safe to import from the client
 * component directly. The functions that actually call Google's APIs
 * live server-side in lib/transit/googleLookup.ts instead.
 *
 * Fields: nearest stop, walking time, walking distance, notes. There is
 * no Transit Agency field, no Bus Route Numbers field, no Date Verified
 * field, and no maximum walking time/distance setting. This section is
 * purely informational -- it does not judge whether a property passes
 * or fails any threshold. There is no Pass/Fail status, no
 * qualification message, and no benchmark comparison anywhere in this
 * module.
 */

/** The current transit result, built directly from whatever is in the
 * fields right now (automatically filled, hand-edited, or a mix of
 * both) -- there is no separate saved/verified snapshot distinct from
 * the live fields. */
export interface TransitResult {
  nearestStop: string;
  walkingTimeMinutes: number | null;
  walkingDistanceMiles: number | null;
  notes: string;
}

/** Loose "is there anything worth searching for" check -- unlike the old
 * automatic-discovery flow, this no longer needs to validate a complete
 * mailable address before acting (no geocoding call to protect), just
 * enough to avoid searching/linking on an empty field. */
export function looksLikeUsableAddress(address: string): boolean {
  return address.trim().length >= 5;
}

/** "bus stops near [PROPERTY ADDRESS]" (spec section 2), safely encoded
 * for use in either the Maps Embed API's `q` parameter or the plain
 * Google Maps search URL. */
export function buildBusStopsQuery(address: string): string {
  return `bus stops near ${address.trim()}`;
}

/** Official Google Maps Embed API, search mode (spec section 3). Returns
 * null when no embed key is configured so the caller can show the
 * "not configured" fallback instead of a broken iframe. */
export function buildMapsEmbedUrl(address: string, embedApiKey: string | null): string | null {
  if (!embedApiKey) return null;
  const query = encodeURIComponent(buildBusStopsQuery(address));
  return `https://www.google.com/maps/embed/v1/search?key=${embedApiKey}&q=${query}`;
}

/** Plain Google Maps search deep link (spec section 4) -- works with no
 * API key at all, so the "Open in Google Maps" button is never blocked
 * by a missing/misconfigured embed key. */
export function buildMapsSearchUrl(address: string): string {
  const query = encodeURIComponent(buildBusStopsQuery(address));
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/**
 * Stricter than looksLikeUsableAddress -- this one gates the automatic
 * Places/Directions lookup (a real, metered API call), not just a
 * search link, so it requires something that actually resembles a
 * street address: a number, at least one comma-separated segment
 * (street vs. city/state/zip), and a reasonable minimum length. This
 * intentionally does not attempt full mailing-address validation --
 * it only needs to avoid firing the automatic lookup on a half-typed
 * address while the person is still typing.
 */
export function looksLikeCompleteAddress(address: string): boolean {
  const trimmed = address.trim();
  if (trimmed.length < 10) return false;
  if (!/\d/.test(trimmed)) return false;
  if (!trimmed.includes(",")) return false;
  return true;
}

/** Google Maps Embed API, directions mode -- draws the walking path
 * between the property and the automatically found nearest stop and
 * centers the map on that route, rather than just showing a generic
 * search panel (destination is passed as raw lat,lng so it never
 * depends on the stop's name being geocodable on its own). Returns
 * null with no embed key configured, same fallback contract as
 * buildMapsEmbedUrl. */
export function buildMapsDirectionsEmbedUrl(
  originAddress: string,
  destinationLat: number,
  destinationLng: number,
  embedApiKey: string | null
): string | null {
  if (!embedApiKey) return null;
  const origin = encodeURIComponent(originAddress.trim());
  const destination = `${destinationLat},${destinationLng}`;
  return `https://www.google.com/maps/embed/v1/directions?key=${embedApiKey}&origin=${origin}&destination=${destination}&mode=walking`;
}

/** Plain Google Maps walking-directions deep link -- the "Open Bus Stop
 * Search in Google Maps" button switches to this once an automatic
 * nearest-stop result exists, so what opens in a new tab matches what
 * the embedded map is already showing. Needs no API key. */
export function buildMapsDirectionsSearchUrl(
  originAddress: string,
  destinationLat: number,
  destinationLng: number
): string {
  const origin = encodeURIComponent(originAddress.trim());
  const destination = `${destinationLat},${destinationLng}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
}
