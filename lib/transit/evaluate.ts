/**
 * Pure evaluation helpers for the transit feature: pass/caution/fail
 * threshold logic (spec section 11) and the "does this look like a
 * complete address" heuristic (spec section 6/19) used to decide whether
 * to auto-run a lookup. No network calls, no environment variables --
 * shared by both the server route and the client component, and easy to
 * unit test in isolation.
 */
import type { TransitMaxWalkSetting, TransitResultStatus } from "./types";

/** Within this margin of the limit, a passing result is flagged CAUTION
 * instead of a clean PASS (spec section 11: "within two minutes or 0.10
 * miles of the limit"). */
const CAUTION_MARGIN_MINUTES = 2;
const CAUTION_MARGIN_MILES = 0.1;

/**
 * Evaluates a found stop's walking time/distance against the selected
 * maximum. Returns null only when there is no stop and no route at all
 * (the "no result" case is handled by the caller, which has more context
 * -- e.g. whether a search ran at all).
 */
export function evaluateWalkResult(
  walkingMinutes: number | null,
  walkingMiles: number | null,
  setting: TransitMaxWalkSetting
): Exclude<TransitResultStatus, "noResult"> | null {
  if (walkingMinutes === null || walkingMiles === null) return null;

  // Margins are exclusive ("< margin", not "<= margin"): spec section 10's
  // own worked example (13 minutes against a 15-minute limit -- exactly 2
  // minutes of headroom) is a plain PASS, not a CAUTION, so "within two
  // minutes of the limit" is read as strictly less than 2 minutes of
  // headroom remaining (i.e. 14+ minutes on a 15-minute limit), not
  // inclusive of exactly 2.
  if (setting.mode === "time") {
    const limit = setting.minutes;
    if (walkingMinutes > limit) return "fail";
    if (limit - walkingMinutes < CAUTION_MARGIN_MINUTES) return "caution";
    return "pass";
  }

  const limit = setting.miles;
  if (walkingMiles > limit) return "fail";
  if (limit - walkingMiles < CAUTION_MARGIN_MILES) return "caution";
  return "pass";
}

/**
 * Loose "does this look like a mailable street address" check: requires
 * a street-number-looking token, at least two comma-separated segments
 * (so "123 Main St, Dallas, TX 75201" qualifies but "123 Main St" alone
 * does not), and something that looks like a U.S. state abbreviation or
 * a 5-digit ZIP. Deliberately permissive -- this only decides whether to
 * *attempt* an automatic lookup; the geocoder itself is the real
 * validator and returns "address_not_found" / "ambiguous_address" when
 * it disagrees.
 */
export function looksLikeCompleteAddress(address: string): boolean {
  const trimmed = address.trim();
  if (trimmed.length < 10) return false;
  const hasStreetNumber = /\d/.test(trimmed);
  const commaSegments = trimmed.split(",").filter((s) => s.trim().length > 0);
  const hasZip = /\b\d{5}(-\d{4})?\b/.test(trimmed);
  const hasStateAbbrev = /\b[A-Z]{2}\b/.test(trimmed);
  return hasStreetNumber && commaSegments.length >= 2 && (hasZip || hasStateAbbrev);
}

export function formatMaxWalkLabel(setting: TransitMaxWalkSetting): string {
  return setting.mode === "time"
    ? `${setting.minutes} minute${setting.minutes === 1 ? "" : "s"}`
    : `${setting.miles.toFixed(2)} mile${setting.miles === 1 ? "" : "s"}`;
}
