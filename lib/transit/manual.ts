/**
 * "Transit and Bus Stop Access" -- manual-verification architecture.
 *
 * Earlier versions of this feature tried to automatically discover the
 * nearest bus stop server-side (Google Places, a Google transit-routing
 * probe, then official GTFS static feeds). Each of those was more
 * accurate than the last but still occasionally produced a false
 * negative for a real, walkable stop, or required trusting a third-party
 * feed URL that couldn't be verified from this environment.
 *
 * This version replaces automatic discovery entirely with a manual
 * verification workflow: an embedded Google Maps search panel lets the
 * person underwriting the deal look up nearby bus stops themselves (the
 * same way they would in their own browser), then record what they found
 * in a small form. Pass/Fail is computed from those manually-entered
 * numbers against the existing Maximum Walking Distance setting -- no
 * server call, no discovery pipeline, no possibility of a false "no bus
 * stops were found" result. See components/underwriting/
 * SharedHousingCalculator.tsx's TransitAndBusStopAccessSection for the
 * UI that uses this module.
 *
 * This whole file is pure logic with no network calls and no
 * environment variables, so it is safe to import from the client
 * component directly.
 */

export type TransitMaxWalkMode = "time" | "distance";

export interface TransitMaxWalkSetting {
  mode: TransitMaxWalkMode;
  minutes: number; // used when mode === "time"
  miles: number; // used when mode === "distance"
}

export type TransitManualStatus = "pass" | "fail" | "notVerified";

/** The record created by clicking "Save Verified Transit Result." Kept
 * distinct from the live draft inputs so an address change can mark this
 * specific saved record outdated (spec section 9) without erasing what
 * the person typed. */
export interface ManualTransitVerification {
  nearestStop: string;
  walkingTimeMinutes: number | null;
  walkingDistanceMiles: number | null;
  transitAgency: string;
  busRoutes: string;
  dateVerified: string; // yyyy-mm-dd, from an <input type="date">
  notes: string;
  /** The Property Address value at the moment this result was saved --
   * compared against the current Property Address to detect staleness. */
  savedAtAddress: string;
  /** ISO timestamp of the save action, for print/Excel "Date Verified"
   * fallback and general record-keeping. */
  savedAt: string;
}

/**
 * Pass/Fail/Not-Verified purely from the manually entered walking time
 * or distance against the selected maximum (spec section 7). Simpler
 * than the old automatic-discovery evaluator: no "caution" margin tier,
 * and no walking-route-availability branch, since a person only saves a
 * number they actually looked up. Boundary is inclusive ("<=" is a
 * pass, per spec section 7's literal wording).
 */
export function computeManualTransitStatus(
  walkingTimeMinutes: number | null,
  walkingDistanceMiles: number | null,
  setting: TransitMaxWalkSetting
): TransitManualStatus {
  if (setting.mode === "time") {
    if (walkingTimeMinutes === null || !Number.isFinite(walkingTimeMinutes)) return "notVerified";
    return walkingTimeMinutes <= setting.minutes ? "pass" : "fail";
  }
  if (walkingDistanceMiles === null || !Number.isFinite(walkingDistanceMiles)) return "notVerified";
  return walkingDistanceMiles <= setting.miles ? "pass" : "fail";
}

export function formatMaxWalkLabel(setting: TransitMaxWalkSetting): string {
  return setting.mode === "time"
    ? `${setting.minutes} minute${setting.minutes === 1 ? "" : "s"}`
    : `${setting.miles.toFixed(2)} mile${setting.miles === 1 ? "" : "s"}`;
}

/**
 * Builds the exact-format result message (spec section 8's worked
 * example: "PASS – Benfield Rd @ Shads Landing is approximately 13
 * minutes away on foot."). Uses whichever of walking time/distance
 * matches the active maximum-walk mode, since that is the figure the
 * Pass/Fail decision was actually made against.
 */
export function buildManualTransitMessage(
  status: TransitManualStatus,
  nearestStop: string,
  walkingTimeMinutes: number | null,
  walkingDistanceMiles: number | null,
  setting: TransitMaxWalkSetting
): string {
  if (status === "notVerified") return "NOT VERIFIED";

  const stopLabel = nearestStop.trim() || "The nearest bus stop";
  const figure =
    setting.mode === "time"
      ? `approximately ${walkingTimeMinutes} minute${walkingTimeMinutes === 1 ? "" : "s"} away on foot`
      : `approximately ${walkingDistanceMiles} mile${walkingDistanceMiles === 1 ? "" : "s"} away on foot`;

  if (status === "pass") {
    return `PASS – ${stopLabel} is ${figure}.`;
  }
  const limitLabel = formatMaxWalkLabel(setting);
  return `FAIL – ${stopLabel} is ${figure}, exceeding the ${limitLabel} maximum.`;
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
