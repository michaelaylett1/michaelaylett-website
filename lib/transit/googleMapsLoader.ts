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
 * SDK loaded in the browser, so this module injects that <script> tag
 * (once, via a singleton promise) using the same public embed key --
 * per Google's current guidance, that key must also have the Places
 * API (New) enabled and its HTTP referrer/API restrictions widened to
 * include it (see README's "Transit and Bus Stop Access" section for
 * the exact steps).
 */

import type { GooglePlacesLibrary } from "./googlePlacesTypes";

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary: (name: string) => Promise<unknown>;
      };
    };
  }
}

let loadPromise: Promise<GooglePlacesLibrary> | null = null;

/**
 * Loads the Maps JavaScript API (if not already loaded) and resolves
 * with the "places" library. Safe to call repeatedly -- every caller
 * after the first shares the same in-flight/resolved promise, so the
 * <script> tag is only ever injected once per page load no matter how
 * many times the Property Address field re-renders. On failure, the
 * cached promise is cleared so a later retry (e.g. after a transient
 * network error) can try loading again instead of being stuck with a
 * permanently rejected promise.
 */
export function loadGooglePlacesLibrary(apiKey: string): Promise<GooglePlacesLibrary> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only be loaded in the browser."));
  }
  if (!apiKey) {
    return Promise.reject(new Error("No Google Maps API key configured."));
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<GooglePlacesLibrary>((resolve, reject) => {
    const finishLoading = () => {
      if (!window.google?.maps?.importLibrary) {
        reject(new Error("Google Maps JavaScript API failed to initialize."));
        return;
      }
      window.google.maps
        .importLibrary("places")
        .then((lib) => resolve(lib as GooglePlacesLibrary))
        .catch(reject);
    };

    if (window.google?.maps?.importLibrary) {
      finishLoading();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>("script[data-google-maps-loader]");
    if (existing) {
      existing.addEventListener("load", finishLoading);
      existing.addEventListener("error", () => reject(new Error("Google Maps JavaScript API failed to load.")));
      return;
    }

    const script = document.createElement("script");
    script.dataset.googleMapsLoader = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places&loading=async&v=weekly`;
    script.async = true;
    script.onload = finishLoading;
    script.onerror = () => reject(new Error("Google Maps JavaScript API failed to load."));
    document.head.appendChild(script);
  }).catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}
