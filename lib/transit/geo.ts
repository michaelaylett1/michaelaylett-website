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
