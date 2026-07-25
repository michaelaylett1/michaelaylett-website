/**
 * Minimal ambient shapes for the pieces of the Google Maps JavaScript
 * "places" library (the current Autocomplete Data API --
 * google.maps.places.AutocompleteSuggestion, replacing the deprecated
 * google.maps.places.AutocompleteService / Autocomplete widget as of
 * March 2025) that the Property Address autocomplete field actually
 * uses.
 *
 * Deliberately not the full @types/google.maps package: this feature
 * only touches a handful of members (fetchAutocompleteSuggestions, a
 * prediction's display text, toPlace()/fetchFields() to resolve the
 * canonical formatted address, and an opaque session token type), so a
 * small hand-written surface here avoids taking on and keeping in sync
 * a large external type dependency for it.
 */

export interface GooglePlace {
  formattedAddress: string | null;
  fetchFields(options: { fields: string[] }): Promise<{ place: GooglePlace }>;
}

export interface GooglePlacePrediction {
  /** The prediction's full display text (e.g. "648 Calcutta Dr, Dallas, TX, USA") -- call .toString() to read it. */
  text: { toString(): string };
  /** Resolves this prediction to a full Place -- call fetchFields() on the result to get details and close out the autocomplete session. */
  toPlace(): GooglePlace;
}

export interface GoogleAutocompleteSuggestion {
  placePrediction: GooglePlacePrediction | null;
}

/** Opaque session token object -- this app never reads its fields,
 * only creates one per autocomplete "session" and passes it back into
 * request.sessionToken so Google can bill/group the run of requests
 * together instead of charging per keystroke. */
export type GoogleAutocompleteSessionToken = Record<string, never>;

export interface GoogleAutocompleteRequest {
  input: string;
  sessionToken: GoogleAutocompleteSessionToken;
  /** Restricts results to the given ISO 3166-1 alpha-2 region codes -- used here to keep suggestions to US addresses. */
  includedRegionCodes?: string[];
  /** Restricts results to the given Places types -- used here with ["street_address"] to prioritize street addresses over businesses, cities, etc. */
  includedPrimaryTypes?: string[];
  region?: string;
  language?: string;
}

export interface GooglePlacesLibrary {
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(
      request: GoogleAutocompleteRequest
    ): Promise<{ suggestions: GoogleAutocompleteSuggestion[] }>;
  };
  AutocompleteSessionToken: new () => GoogleAutocompleteSessionToken;
}
