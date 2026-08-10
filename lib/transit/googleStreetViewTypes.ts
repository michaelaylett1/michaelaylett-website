/**
 * Minimal ambient shapes for the pieces of the Google Maps JavaScript
 * core "maps" library that the interactive Property Street View
 * (components/underwriting/SharedHousingCalculator.tsx's
 * PropertyStreetView component) actually uses: StreetViewService (to
 * find the nearest available panorama to the property's geocoded
 * coordinates) and StreetViewPanorama (to render it, interactively,
 * inside the page).
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

export interface StreetViewPanoRequest {
  location: GoogleLatLngLiteral;
  /** Search radius in meters for the nearest available panorama. */
  radius?: number;
  /** "outdoor" restricts results to outdoor imagery (never an indoor
   * business photo), which is what a property-frontage/parking check
   * needs -- the string value matches google.maps.StreetViewSource.
   * OUTDOOR exactly, so passing it directly (rather than importing the
   * enum object) is equivalent. */
  source?: "default" | "outdoor";
}

export interface StreetViewService {
  getPanorama(request: StreetViewPanoRequest): Promise<StreetViewResponse>;
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

export interface GoogleMapsCoreLibrary {
  StreetViewService: new () => StreetViewService;
  StreetViewPanorama: new (container: HTMLElement, opts?: StreetViewPanoramaOptions) => StreetViewPanorama;
}
