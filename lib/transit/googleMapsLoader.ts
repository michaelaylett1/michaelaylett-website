/**
 * Client-side loader for two Google Maps JavaScript API libraries used
 * by components/underwriting/SharedHousingCalculator.tsx: "places" (the
 * Property Address autocomplete dropdown, PropertyAddressAutocomplete)
 * and "streetView" (the interactive Property Street View panorama,
 * PropertyStreetView). Both share the exact same underlying bootstrap
 * script/key/singleton below -- only the specific library name passed
 * to importLibrary() differs. This is a different Google Maps product
 * from the other two already in this project:
 *   - NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY drives the Maps Embed API
 *     iframe on the Transit section (a static embed URL, no JavaScript
 *     SDK involved).
 *   - GOOGLE_MAPS_API_KEY (server-only) drives the Geocoding, Places
 *     Nearby Search, and Directions REST APIs from
 *     lib/transit/googleLookup.ts.
 * Address autocomplete needs a third thing: the actual Maps JavaScript
 * SDK loaded in the browser, so this module injects Google's official
 * "dynamic library import" bootstrap loader (once, via a singleton
 * promise) using the same public embed key -- per Google's current
 * guidance, that key must also have the Maps JavaScript API and Places
 * API (New) enabled and its HTTP referrer/API restrictions widened to
 * include them (see README's "Transit and Bus Stop Access" section for
 * the exact steps).
 *
 * IMPORTANT: this deliberately does NOT use a plain
 * `<script src=".../js?...&loading=async">` tag with a `script.onload`
 * handler. Google's own documentation for the `loading=async` parameter
 * states: "no JavaScript code is triggered by the script's load event"
 * -- so a handler attached to that script's `load` event is not
 * guaranteed to fire, which silently breaks the whole autocomplete
 * feature with no visible error (this was traced as the most likely
 * root cause of address suggestions never appearing in production).
 * Google's documented fix is to use the small inline "bootstrap loader"
 * snippet instead, which defines `google.maps.importLibrary`
 * synchronously and handles the real script's load/callback wiring
 * internally: https://developers.google.com/maps/documentation/javascript/load-maps-js-api#dynamic-library-import
 */

import type { GooglePlacesLibrary } from "./googlePlacesTypes";
import type { GoogleStreetViewLibrary } from "./googleStreetViewTypes";

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary: (name: string) => Promise<unknown>;
      };
    };
    // Google's documented global auth-failure hook: fires for
    // RefererNotAllowedMapError, InvalidKeyMapError, and similar key/
    // billing/API-restriction problems that the Maps JavaScript API
    // cannot report through a normal Promise rejection (the bootstrap
    // script itself calls this, outside of any importLibrary() call) --
    // see https://developers.google.com/maps/documentation/javascript/events#auth-errors.
    // Defined once here purely for diagnostics (item 7 in the Street
    // View debugging request): logs a clear, non-sensitive console
    // message pointing at the actual cause instead of leaving these
    // errors to only ever show as Google's own generic overlay text.
    gm_authFailure?: () => void;
  }
}

const LOG_PREFIX = "[PropertyAddressAutocomplete]";
const STREET_VIEW_LOG_PREFIX = "[PropertyStreetView]";

// Google's official inline bootstrap loader (see the doc link above),
// reproduced verbatim except for the one internal template literal
// (`https://maps.${c}apis.com/...`) rewritten as string concatenation
// so it can safely live inside this file's own TS template literal
// without nested-backtick escaping issues. GMAPS_BOOTSTRAP_OPTIONS is
// replaced at injection time with the real API key + version.
const BOOTSTRAP_SNIPPET_TEMPLATE = `(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src="https://maps."+c+"apis.com/maps/api/js?"+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})(GMAPS_BOOTSTRAP_OPTIONS);`;

/** Name of the window event dispatched when Google's gm_authFailure hook
 * fires, so any component (autocomplete, Street View) can react to an
 * authorization failure that the Maps JS API only reports through this
 * global callback (never through a rejected Promise). */
export const GOOGLE_MAPS_AUTH_FAILURE_EVENT = "google-maps-auth-failure";

let authFailureSeen = false;
/** True once Google has reported an API-key/authorization failure for
 * this page load. */
export function hasGoogleMapsAuthFailed(): boolean {
  return authFailureSeen;
}

function installAuthFailureDiagnostics() {
  if (window.gm_authFailure) return; // don't clobber a handler the host page already defined
  window.gm_authFailure = () => {
    authFailureSeen = true;
    console.error(
      "[GoogleMaps] gm_authFailure fired -- the Maps JavaScript API rejected this page's API key/domain " +
        "combination. Common causes: the key's HTTP referrer restrictions do not include this exact hostname " +
        "(check for http vs https, and www vs non-www), the Maps JavaScript API is not enabled for this key's " +
        "Google Cloud project, billing is not enabled on that project, or the key itself is invalid/deleted. " +
        "Look for a more specific error name in the console just above this message, e.g. " +
        "RefererNotAllowedMapError, ApiNotActivatedMapError, InvalidKeyMapError, or BillingNotEnabledMapError. " +
        "Open /api/maps/diagnostics?pw=<password> on this site for a full server-side check."
    );
    window.dispatchEvent(new CustomEvent(GOOGLE_MAPS_AUTH_FAILURE_EVENT));
  };
}

function injectBootstrapLoader(apiKey: string) {
  installAuthFailureDiagnostics();
  if (window.google?.maps?.importLibrary) return;
  if (document.querySelector("script[data-google-maps-bootstrap]")) return;

  const script = document.createElement("script");
  script.dataset.googleMapsBootstrap = "true";
  script.textContent = BOOTSTRAP_SNIPPET_TEMPLATE.replace(
    "GMAPS_BOOTSTRAP_OPTIONS",
    JSON.stringify({ key: apiKey, v: "weekly" })
  );
  document.head.appendChild(script);
  console.info(`${LOG_PREFIX} Injected the Google Maps bootstrap loader.`);
}

let placesLoadPromise: Promise<GooglePlacesLibrary> | null = null;
let streetViewLoadPromise: Promise<GoogleStreetViewLibrary> | null = null;

/**
 * Shared implementation behind both loadGooglePlacesLibrary (below) and
 * loadGoogleStreetViewLibrary (also below, used by the interactive
 * Property Street View panorama). Both load the same underlying Maps
 * JavaScript API bootstrap (injected at most once per page load no
 * matter how many times either caller runs) and only differ in which
 * named library they import from it and which in-flight/resolved
 * promise they cache.
 *
 * IMPORTANT: StreetViewService/StreetViewPanorama live in their own
 * dedicated "streetView" library, not the core "maps" library (an
 * earlier version of this file called importLibrary("maps") for Street
 * View, which resolves fine but the returned object has no
 * StreetViewService/StreetViewPanorama on it at all -- `new
 * lib.StreetViewPanorama(...)` then throws "not a constructor",
 * surfacing on-page as a generic "Street View could not be loaded right
 * now" with no further explanation. See Google's library table:
 * https://developers.google.com/maps/documentation/javascript/libraries
 * -- "maps" contains Map/InfoWindow/etc.; "streetView" contains
 * StreetViewPanorama, StreetViewService, StreetViewPreference,
 * StreetViewSource, StreetViewStatus, and StreetViewCoverageLayer).
 */
function loadGoogleMapsLibrary<T>(
  apiKey: string,
  libraryName: string,
  logPrefix: string,
  getCache: () => Promise<T> | null,
  setCache: (value: Promise<T> | null) => void
): Promise<T> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error(`${logPrefix} Google Maps can only be loaded in the browser.`));
  }
  if (!apiKey) {
    const err = new Error(
      `${logPrefix} No Google Maps API key configured (NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY is empty). ` +
        "This feature cannot start until this environment variable is set and the site is rebuilt/redeployed."
    );
    console.error(err.message);
    return Promise.reject(err);
  }
  const cached = getCache();
  if (cached) return cached;

  const promise = new Promise<T>((resolve, reject) => {
    try {
      injectBootstrapLoader(apiKey);
    } catch (err) {
      console.error(`${logPrefix} Failed to inject the Google Maps bootstrap loader:`, err);
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (!window.google?.maps?.importLibrary) {
      const err = new Error(
        `${logPrefix} google.maps.importLibrary was not defined after injecting the bootstrap loader. ` +
          "This usually means the page's Content Security Policy blocked the inline bootstrap script."
      );
      console.error(err.message);
      reject(err);
      return;
    }

    window.google.maps
      .importLibrary(libraryName)
      .then((lib) => {
        resolve(lib as T);
      })
      .catch((err) => {
        console.error(
          `${logPrefix} google.maps.importLibrary("${libraryName}") failed. Common causes: the Maps JavaScript ` +
            "API (and, for places, Places API (New)) is not enabled for this API key's Google Cloud project, the " +
            "key's HTTP referrer restrictions do not include this site's domain, or the key is invalid/restricted " +
            "incorrectly. Full error:",
          err
        );
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  }).catch((err) => {
    setCache(null);
    throw err;
  });

  setCache(promise);
  return promise;
}

/**
 * Loads the Maps JavaScript API (if not already loaded) and resolves
 * with the "places" library. Safe to call repeatedly -- every caller
 * after the first shares the same in-flight/resolved promise, so the
 * bootstrap loader is only ever injected once per page load no matter
 * how many times the Property Address field re-renders. On failure,
 * the cached promise is cleared so a later retry (e.g. after a
 * transient network error) can try loading again instead of being
 * stuck with a permanently rejected promise. Every failure path logs a
 * descriptive console.error so a broken deployment (missing key,
 * disabled API, unauthorized domain, network failure) is diagnosable
 * from the browser console instead of failing silently.
 */
export function loadGooglePlacesLibrary(apiKey: string): Promise<GooglePlacesLibrary> {
  return loadGoogleMapsLibrary(
    apiKey,
    "places",
    LOG_PREFIX,
    () => placesLoadPromise,
    (value) => {
      placesLoadPromise = value;
    }
  );
}

/**
 * Loads the Maps JavaScript API's dedicated "streetView" library, where
 * StreetViewService and StreetViewPanorama actually live -- used by the
 * interactive Property Street View panorama on the Transit and Bus
 * Stop Access section. Shares the same bootstrap-injection singleton
 * as loadGooglePlacesLibrary above (both ultimately load the same
 * underlying script), but is cached separately since it resolves a
 * different library object.
 */
export function loadGoogleStreetViewLibrary(apiKey: string): Promise<GoogleStreetViewLibrary> {
  return loadGoogleMapsLibrary(
    apiKey,
    "streetView",
    STREET_VIEW_LOG_PREFIX,
    () => streetViewLoadPromise,
    (value) => {
      streetViewLoadPromise = value;
    }
  );
}

/** Minimal shape of google.maps.Geocoder's result used for the browser-side fallback. */
interface BrowserGeocoderResult {
  geometry: { location: { lat(): number; lng(): number } };
  formatted_address: string;
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
}
interface BrowserGeocodingLibrary {
  Geocoder: new () => { geocode(req: { address: string }): Promise<{ results: BrowserGeocoderResult[] }> };
}

let geocodingLoadPromise: Promise<BrowserGeocodingLibrary> | null = null;

/**
 * Browser-side geocoding (Maps JavaScript API "geocoding" library, using
 * the public key). Used ONLY as a fallback when the server-side
 * /api/maps/geocode route fails, so Street View (which needs just the
 * property's coordinates) can still work if, for example, the private
 * server key is missing or restricted but the public key is fine.
 */
export async function geocodeInBrowser(
  apiKey: string,
  address: string
): Promise<{ lat: number; lng: number; formattedAddress: string; stateAbbreviation: string | null; county: string | null }> {
  const lib = await loadGoogleMapsLibrary<BrowserGeocodingLibrary>(
    apiKey,
    "geocoding",
    "[BrowserGeocoder]",
    () => geocodingLoadPromise,
    (value) => {
      geocodingLoadPromise = value;
    }
  );
  const { results } = await new lib.Geocoder().geocode({ address });
  const first = results?.[0];
  if (!first) throw Object.assign(new Error("ZERO_RESULTS"), { code: "ZERO_RESULTS" });
  const comps = first.address_components || [];
  return {
    lat: first.geometry.location.lat(),
    lng: first.geometry.location.lng(),
    formattedAddress: first.formatted_address,
    stateAbbreviation: comps.find((c) => c.types.includes("administrative_area_level_1"))?.short_name || null,
    county: comps.find((c) => c.types.includes("administrative_area_level_2"))?.long_name || null,
  };
}
