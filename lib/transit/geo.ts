/**
 * Pure geo/math helpers for the transit feature. No network calls, no
 * environment variables -- safe to import (and unit test) from anywhere.
 */

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle straight-line distance in miles. Used only as an initial
 * candidate filter (spec section 3/8) -- never as the displayed "walking
 * distance," which must come from an actual routed path. */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return EARTH_RADIUS_MILES * c;
}

export function milesToMeters(miles: number): number {
  return miles * 1609.344;
}

export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

export function secondsToMinutes(seconds: number): number {
  return seconds / 60;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round0(n: number): number {
  return Math.round(n);
}

/**
 * Offsets a lat/lng by a distance and compass bearing. Used to build
 * "probe" destination points around a property so a transit-routing
 * query (which requires both an origin and a destination) can be used
 * to discover nearby bus-boarding stops even though the actual goal is
 * "what stops are near the origin," not travel to any specific place.
 * Flat-earth approximation -- accurate enough at the few-mile scale this
 * is used at (see PROBE_DISTANCE_MILES in lookup.ts).
 */
export function offsetLatLng(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceMiles: number
): { latitude: number; longitude: number } {
  const milesPerDegreeLat = 69.0;
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const dLat = (distanceMiles / milesPerDegreeLat) * Math.cos(bearingRad);
  const milesPerDegreeLng = milesPerDegreeLat * Math.cos((lat * Math.PI) / 180);
  const dLng = milesPerDegreeLng === 0 ? 0 : (distanceMiles / milesPerDegreeLng) * Math.sin(bearingRad);
  return { latitude: lat + dLat, longitude: lng + dLng };
}

/** Eight compass bearings, evenly spaced, used to generate probe points
 * in every direction around a property. */
export const COMPASS_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

/** Rounds coordinates to ~11 meters of precision for dedupe-by-location
 * matching (spec: dedupe candidates by coordinates/name when no stable
 * place ID is available). */
export function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** Loose name normalization for dedupe matching: lowercase, collapse
 * whitespace, strip punctuation that commonly differs between the same
 * stop reported by two different data sources ("@" vs "and", etc). */
export function normalizeStopName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[@&]/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
