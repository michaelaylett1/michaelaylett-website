/**
 * Client-side loader for the Google Maps JavaScript API's "places"
 * library, used only for the Property Address autocomplete dropdown
 * (see PropertyAddressAutocomplete in
 * components/underwriting/SharedHousingCalculator.tsx). This is a
 * different Google Maps product from the other two already in this
 * project:
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
import type { GoogleMapsCoreLibrary } from "./googleStreetViewTypes";

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary: (name: string) => Promise<unknown>;
      };
    };
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

function injectBootstrapLoader(apiKey: string) {
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
let coreLoadPromise: Promise<GoogleMapsCoreLibrary> | null = null;

/**
 * Shared implementation behind both loadGooglePlacesLibrary (below) and
 * loadGoogleMapsCoreLibrary (also below, added for the interactive
 * Property Street View panorama). Both load the same underlying Maps
 * JavaScript API bootstrap (injected at most once per page load no
 * matter how many times either caller runs) and only differ in which
 * named library they import from it and which in-flight/resolved
 * promise they cache -- StreetViewService/StreetViewPanorama live in
 * the core "maps" library, not "places", so they need their own
 * importLibrary() call and their own cache, but must not inject a
 * second competing bootstrap script.
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
 * Loads the Maps JavaScript API's core "maps" library, which is where
 * StreetViewService and StreetViewPanorama live -- used by the
 * interactive Property Street View panorama on the Transit and Bus
 * Stop Access section. Shares the same bootstrap-injection singleton
 * as loadGooglePlacesLibrary above (both ultimately load the same
 * underlying script), but is cached separately since it resolves a
 * different library object.
 */
export function loadGoogleMapsCoreLibrary(apiKey: string): Promise<GoogleMapsCoreLibrary> {
  return loadGoogleMapsLibrary(
    apiKey,
    "maps",
    STREET_VIEW_LOG_PREFIX,
    () => coreLoadPromise,
    (value) => {
      coreLoadPromise = value;
    }
  );
}
