/**
 * Shared, client-safe classification of Google Maps Platform failures.
 *
 * Before this module existed, every Google failure collapsed into one of
 * three generic outcomes ("geocode_failed", "request_failed", or a
 * client-side "Address suggestions are temporarily unavailable"), which
 * threw away the one piece of information that actually explains the
 * problem: Google's own status / error message (for example
 * REQUEST_DENIED + "This API project is not authorized to use this API",
 * or "Places API (New) has not been used in project ... before or it is
 * disabled"). Every Google call in the app now routes its failure
 * through classifyGoogleFailure(), which maps those signals onto the
 * small set of kinds below, so the UI can say something accurate and the
 * server/browser console can log the real cause.
 *
 * Nothing in here ever includes an API key: sanitizeGoogleDetail()
 * strips key=... query parameters and anything shaped like a Google API
 * key from every message before it is logged or returned to a client.
 */

export type GoogleFailureKind =
  | "not_configured" // the env var for this key is missing/empty
  | "api_not_enabled" // the API (or "Places API (New)", "Routes API", ...) is disabled for the project
  | "key_rejected" // invalid key, or the key's API restrictions exclude this API
  | "referrer_blocked" // HTTP referrer / IP restriction rejected the request
  | "billing" // billing is not enabled / invalid on the project
  | "quota" // OVER_QUERY_LIMIT / RESOURCE_EXHAUSTED / HTTP 429
  | "address_not_found" // geocoder returned ZERO_RESULTS
  | "no_transit" // no transit stops near the property
  | "no_route" // stops exist but no walking route was returned
  | "no_imagery" // Street View has no panorama here
  | "network" // fetch itself failed (DNS, timeout, offline)
  | "unknown";

/** Removes anything that looks like an API key from a string. */
export function sanitizeGoogleDetail(input: unknown): string {
  const text = typeof input === "string" ? input : input instanceof Error ? input.message : String(input ?? "");
  return text
    .replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .slice(0, 400);
}

/**
 * Maps a Google status code (legacy REST "status", new-API "error.status",
 * or a Maps JS error name) and/or its human-readable message onto a
 * GoogleFailureKind. Message text is checked first for the specific
 * causes (billing, API disabled, referrer) because Google reports all of
 * them under the same generic REQUEST_DENIED / PERMISSION_DENIED status.
 */
export function classifyGoogleFailure(status?: string | null, message?: string | null): GoogleFailureKind {
  const s = (status || "").toUpperCase();
  const m = (message || "").toLowerCase();

  if (m.includes("billing") || s.includes("BILLINGNOTENABLED")) return "billing";
  if (
    m.includes("not been used in project") ||
    m.includes("is disabled") ||
    m.includes("has not been enabled") ||
    m.includes("not enabled") ||
    m.includes("service_disabled") ||
    m.includes("not activated") ||
    s.includes("APINOTACTIVATED") ||
    s.includes("SERVICE_DISABLED")
  ) {
    return "api_not_enabled";
  }
  if (m.includes("referer") || m.includes("referrer") || s.includes("REFERERNOTALLOWED") || m.includes("ip address")) {
    return "referrer_blocked";
  }
  if (
    m.includes("api key not valid") ||
    m.includes("invalid key") ||
    m.includes("api_key_invalid") ||
    m.includes("api_key_service_blocked") ||
    m.includes("not authorized to use this api") ||
    m.includes("blocked") ||
    m.includes("restricted") ||
    s.includes("INVALIDKEY") ||
    s.includes("API_KEY")
  ) {
    return "key_rejected";
  }
  if (s === "OVER_QUERY_LIMIT" || s === "OVER_DAILY_LIMIT" || s === "RESOURCE_EXHAUSTED" || s === "429" || m.includes("quota")) {
    return "quota";
  }
  if (s === "ZERO_RESULTS" || s === "NOT_FOUND") return "address_not_found";
  if (s === "REQUEST_DENIED" || s === "PERMISSION_DENIED" || s === "403" || s === "401" || s === "UNAUTHENTICATED") {
    // Denied, but Google did not say why in a way we recognise.
    return "key_rejected";
  }
  return "unknown";
}

/** One short, user-facing sentence per failure kind (no key material). */
export function describeGoogleFailure(kind: GoogleFailureKind, feature: string): string {
  switch (kind) {
    case "not_configured":
      return `${feature} is not configured for this site (API key missing).`;
    case "api_not_enabled":
      return `${feature} is unavailable: a required Google API is not enabled for this site's Google Cloud project.`;
    case "key_rejected":
      return `${feature} is unavailable: Google rejected this site's API key (invalid key or API restriction).`;
    case "referrer_blocked":
      return `${feature} is unavailable: this site's domain is not allowed by the API key's referrer restrictions.`;
    case "billing":
      return `${feature} is unavailable: billing is not enabled on the Google Cloud project.`;
    case "quota":
      return `${feature} is temporarily unavailable: the Google API quota was exceeded.`;
    case "address_not_found":
      return `${feature}: Google could not find that address.`;
    case "no_transit":
      return `${feature}: no transit stop was found near this property.`;
    case "no_route":
      return `${feature}: no walking route to a nearby stop could be found.`;
    case "no_imagery":
      return `${feature}: Google has no Street View imagery near this property.`;
    case "network":
      return `${feature} could not reach Google (network error). Please try again.`;
    default:
      return `${feature} is temporarily unavailable. Details were logged for diagnosis.`;
  }
}

/** True for kinds that mean "the Google project/key setup is wrong" --
 * i.e. retrying will not help until the owner changes configuration. */
export function isConfigurationFailure(kind: GoogleFailureKind): boolean {
  return (
    kind === "not_configured" ||
    kind === "api_not_enabled" ||
    kind === "key_rejected" ||
    kind === "referrer_blocked" ||
    kind === "billing"
  );
}
