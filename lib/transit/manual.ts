/**
 * "Transit and Bus Stop Access" -- Google Maps automatic lookup +
 * manual-verification architecture.
 *
 * The nearest bus stop and walking route are now found automatically
 * (see lib/transit/googleLookup.ts and app/api/transit/auto-lookup/,
 * which call the Places, Directions, and Geocoding APIs server-side)
 * and used to pre-fill the fields below, but the person underwriting
 * the deal always has the final say: every field stays editable, the
 * embedded map is a visible check on what was found, and nothing is
 * saved to the underwriting result until "Save Verified Transit
 * Result" is clicked. If the automatic lookup is unavailable or finds
 * nothing, the fields simply stay blank for manual entry -- there is
 * no automatic "no bus stops were found" failure result. See
 * components/underwriting/SharedHousingCalculator.tsx's
 * TransitAndBusStopAccessSection for the UI that uses this module.
 *
 * This file itself is pure logic with no network calls and no
 * environment variables, so it is safe to import from the client
 * component directly. The functions that actually call Google's APIs
 * live server-side in lib/transit/googleLookup.ts instead.
 *
 * Fields kept on the saved result: nearest stop, walking time, walking
 * distance, notes. There is no Transit Agency field, no Bus Route
 * Numbers field, no Date Verified field, and no user-editable maximum
 * walking time/distance setting -- Pass/Fail is computed against a
 * fixed benchmark (see FIXED_MAX_WALKING_MINUTES below).
 */

export type TransitManualStatus = "pass" | "fail" | "notVerified";

/** Fixed co-living/PadSplit underwriting benchmark -- a bus stop must be
 * within this many minutes' actual walk to pass. There is no longer a
 * user-editable maximum walking time or distance setting; walking
 * distance is still recorded (auto-filled and editable) for reference,
 * but only walking time drives Pass/Fail. */
export const FIXED_MAX_WALKING_MINUTES = 15;
export const FIXED_MAX_WALKING_LABEL = `${FIXED_MAX_WALKING_MINUTES} minutes`;

/** The record created by clicking "Save Verified Transit Result." Kept
 * distinct from the live draft inputs so an address change can mark this
 * specific saved record outdated (spec section 9) without erasing what
 * the person typed. */
export interface ManualTransitVerification {
  nearestStop: string;
  walkingTimeMinutes: number | null;
  walkingDistanceMiles: number | null;
  notes: string;
  /** The Property Address value at the moment this result was saved --
   * compared against the current Property Address to detect staleness. */
  savedAtAddress: string;
  /** ISO timestamp of the save action, kept for record-keeping. */
  savedAt: string;
}

/**
 * Pass/Fail/Not-Verified from the saved walking time against the fixed
 * 15-minute benchmark. Boundary is inclusive ("<=" is a pass).
 */
export function computeManualTransitStatus(walkingTimeMinutes: number | null): TransitManualStatus {
  if (walkingTimeMinutes === null || !Number.isFinite(walkingTimeMinutes)) return "notVerified";
  return walkingTimeMinutes <= FIXED_MAX_WALKING_MINUTES ? "pass" : "fail";
}

/**
 * Builds the exact-format result message (worked example: "PASS –
 * Benfield Rd @ Shads Landing is approximately 13 minutes away on
 * foot.").
 */
export function buildManualTransitMessage(
  status: TransitManualStatus,
  nearestStop: string,
  walkingTimeMinutes: number | null
): string {
  if (status === "notVerified") return "NOT VERIFIED";

  const stopLabel = nearestStop.trim() || "The nearest bus stop";
  const figure = `approximately ${walkingTimeMinutes} minute${walkingTimeMinutes === 1 ? "" : "s"} away on foot`;

  if (status === "pass") {
    return `PASS – ${stopLabel} is ${figure}.`;
  }
  return `FAIL – ${stopLabel} is ${figure}, exceeding the ${FIXED_MAX_WALKING_LABEL} maximum.`;
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
