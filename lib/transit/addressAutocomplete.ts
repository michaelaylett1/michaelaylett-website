/**
 * Pure, framework-free helpers for the Property Address autocomplete
 * field (PropertyAddressAutocomplete in components/underwriting/
 * SharedHousingCalculator.tsx). Kept separate from the component so the
 * request-shape and gating logic can be unit-tested directly, the same
 * way lib/transit/googleLookup.ts's pure helpers are -- the component
 * itself only wires these into React state, event handlers, and the
 * actual google.maps.places calls (which need a live browser + a real,
 * billed API key to exercise for real, so those are left to manual
 * testing in a deployed environment rather than this repo's harnesses).
 */

import type { GoogleAutocompleteRequest, GoogleAutocompleteSessionToken } from "./googlePlacesTypes";

/** Minimum characters (after trimming) before firing an autocomplete
 * request -- spec: "Begin showing suggestions after the user enters
 * approximately 3 characters." */
export const AUTOCOMPLETE_MIN_CHARS = 3;

/** Debounce delay (ms) between the last keystroke and actually firing a
 * request, so a request isn't sent for every single character typed --
 * spec: "avoid excessive API requests... normal Google Places
 * autocomplete best practices." */
export const AUTOCOMPLETE_DEBOUNCE_MS = 250;

/** Whether the current input is long enough to search for suggestions. */
export function shouldFetchSuggestions(input: string): boolean {
  return input.trim().length >= AUTOCOMPLETE_MIN_CHARS;
}

/**
 * Builds the exact Autocomplete Data API request body. Restricted to US
 * street addresses per spec ("Prioritize street addresses in the United
 * States") via includedRegionCodes + includedPrimaryTypes, and always
 * carries the current session token so the whole run of requests for
 * one address search bills as a single session instead of per keystroke.
 */
export function buildAutocompleteRequest(
  input: string,
  sessionToken: GoogleAutocompleteSessionToken
): GoogleAutocompleteRequest {
  return {
    input,
    sessionToken,
    includedRegionCodes: ["us"],
    includedPrimaryTypes: ["street_address"],
    region: "us",
  };
}

/**
 * True if a response belongs to a request that has since been
 * superseded by a newer one and should be discarded -- the "update the
 * suggestions as the user continues typing" / "prevent an old response
 * from overwriting a newer one" guard. Pass the sequence number
 * captured when the request was made and the current value of the
 * running counter at resolution time.
 */
export function isStaleAutocompleteResponse(requestSeq: number, currentSeqAtResolution: number): boolean {
  return requestSeq !== currentSeqAtResolution;
}
