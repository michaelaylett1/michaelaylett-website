/**
 * Small, pure geo helpers used only by the Property Street View feature
 * (PropertyStreetView in SharedHousingCalculator.tsx) to point the
 * initial panorama camera toward the property and to decide when to
 * show the "Showing the nearest available Street View imagery" note.
 * Pulled out into their own module (rather than left inline in the
 * component) so they can be unit-tested directly with plain
 * lat/lng fixtures, with no Google Maps JS API or DOM involved.
 */

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

/** Great-circle distance in meters between two coordinates (haversine
 * formula). Used only to decide whether a found panorama is close
 * enough to the property to present as "the property" outright, versus
 * far enough away to caption as "the nearest available" imagery --
 * never used to pick which panorama is shown (StreetViewService.
 * getPanorama already does that, ranked by actual distance within the
 * requested search radius). */
export function haversineMetersLatLng(a: LatLngLiteral, b: LatLngLiteral): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const EARTH_RADIUS_METERS = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass heading (0-360 degrees, 0 = north, clockwise) from
 * `from` toward `to`, using the standard forward-azimuth (initial
 * bearing) formula. Used to point the Street View camera from the
 * panorama's actual location toward the property's geocoded
 * coordinates, so the initial view generally faces the house rather
 * than pointing randomly down the street -- the user can still freely
 * rotate, tilt, and move from there. */
export function computeHeadingDegrees(from: LatLngLiteral, to: LatLngLiteral): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}
