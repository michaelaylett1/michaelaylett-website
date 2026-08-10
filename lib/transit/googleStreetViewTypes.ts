/**
 * Minimal ambient shapes for the pieces of the Google Maps JavaScript
 * API's dedicated "streetView" library (NOT the core "maps" library --
 * see the long comment in lib/transit/googleMapsLoader.ts explaining
 * why that distinction is exactly what was broken before) that the
 * interactive Property Street View
 * (components/underwriting/SharedHousingCalculator.tsx's
 * PropertyStreetView component) actually uses: StreetViewService (to
 * find the nearest available panorama to the property's geocoded
 * coordinates), StreetViewPanorama (to render it, interactively, inside
 * the page), and the StreetViewPreference/StreetViewSource enum-like
 * objects passed into a getPanorama() request.
 *
 * Deliberately not the full @types/google.maps package -- same
 * rationale as lib/transit/googlePlacesTypes.ts: this feature only
 * touches a handful of members, so a small hand-written surface here
 * avoids taking on and keeping in sync a large external type
 * dependency for it.
 */

export interface GoogleLatLngLiteral {
  lat: number;
  lng: number;
}

/** The real google.maps.LatLng is a class with lat()/lng() accessor
 * methods (not plain properties) -- StreetViewPanoramaData.location.
 * latLng comes back in this shape from getPanorama(). */
export interface GoogleLatLngObject {
  lat(): number;
  lng(): number;
}

export interface StreetViewLocation {
  latLng?: GoogleLatLngObject;
  pano?: string;
  description?: string;
  shortDescription?: string;
}

export interface StreetViewPanoramaData {
  location?: StreetViewLocation;
}

export type StreetViewStatus = "OK" | "ZERO_RESULTS" | "UNKNOWN_ERROR";

export interface StreetViewResponse {
  data: StreetViewPanoramaData;
}

/** The shape google.maps.importLibrary("streetView")'s getPanorama()
 * Promise rejects with on a non-OK outcome -- Google does not document
 * this as a formal type, so this is intentionally loose (every field
 * optional) and every read of it in PropertyStreetView tolerates any of
 * them being absent. `code`/`status` cover the two different property
 * names different Maps JS API versions have used for the same idea. */
export interface StreetViewServiceError {
  code?: string;
  status?: string;
  message?: string;
}

export interface StreetViewPanoRequest {
  location: GoogleLatLngLiteral;
  /** Search radius in meters for the nearest available panorama. */
  radius?: number;
  /** Restricts results to outdoor imagery (never an indoor business
   * photo), which is what a property-frontage/parking check needs. */
  source?: string;
  /** Prefer the nearest panorama over Google's "best" (most photographically
   * complete) one -- for this feature, physically closest to the
   * property matters more than photo quality. */
  preference?: string;
}

export interface StreetViewService {
  getPanorama(request: StreetViewPanoRequest): Promise<StreetViewResponse>;
}

/** Enum-like objects the "streetView" library itself exports (actual
 * values are lowercase strings, e.g. StreetViewSource.OUTDOOR ===
 * "outdoor") -- read from the loaded library object rather than
 * hardcoded here, so this file never has to be kept in sync with
 * Google's actual values by hand. */
export interface StreetViewSourceEnum {
  DEFAULT: string;
  OUTDOOR: string;
}

export interface StreetViewPreferenceEnum {
  BEST: string;
  NEAREST: string;
}

export interface StreetViewPov {
  heading: number;
  pitch: number;
}

export interface StreetViewPanoramaOptions {
  position?: GoogleLatLngLiteral;
  pano?: string;
  pov?: StreetViewPov;
  zoom?: number;
  addressControl?: boolean;
  showRoadLabels?: boolean;
  motionTracking?: boolean;
  motionTrackingControl?: boolean;
  fullscreenControl?: boolean;
  zoomControl?: boolean;
  panControl?: boolean;
  linksControl?: boolean;
  clickToGo?: boolean;
  disableDefaultUI?: boolean;
}

export interface StreetViewPanorama {
  setPano(pano: string): void;
  setPosition(latLng: GoogleLatLngLiteral): void;
  setPov(pov: StreetViewPov): void;
  setVisible(visible: boolean): void;
}

export interface GoogleStreetViewLibrary {
  StreetViewService: new () => StreetViewService;
  StreetViewPanorama: new (container: HTMLElement, opts?: StreetViewPanoramaOptions) => StreetViewPanorama;
  StreetViewSource: StreetViewSourceEnum;
  StreetViewPreference: StreetViewPreferenceEnum;
}
