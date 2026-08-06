/**
 * One authoritative state-to-default mapping for the three
 * state-sensitive monthly operating expense fields (Cleaning, Lawn
 * Care, Pest Control), shared by every financing structure
 * (Traditional, Subject-To, Seller Financing, Hybrid, Stack Method) so
 * there is exactly one place this logic lives -- both
 * SharedHousingCalculator.tsx (on-page defaults/auto-update/"Use State
 * Defaults" button) and lib/underwritingExcelExport.ts (so the Excel
 * export's provenance note matches what the website showed) import
 * from here rather than each maintaining their own copy.
 *
 * The state code is expected to be the short (abbreviated) form Google
 * Geocoding/Places returns for an `administrative_area_level_1`
 * address component (e.g. "TX", not "Texas") -- see
 * lib/propertyTax/countyLookup.ts, which already extracts this same
 * value for the Property Tax section's county auto-suggest feature and
 * is reused for this feature too rather than geocoding a second time.
 */

export type OperatingExpenseKey = "cleaning" | "lawnCare" | "pestControl";

export type StateOperatingDefaults = Record<OperatingExpenseKey, number>;

const STATE_OPERATING_DEFAULTS: Record<string, StateOperatingDefaults> = {
  TX: { cleaning: 80, lawnCare: 125, pestControl: 0 },
  GA: { cleaning: 138, lawnCare: 150, pestControl: 0 },
  NC: { cleaning: 150, lawnCare: 140, pestControl: 47 },
};

// Used for any state other than Texas, Georgia, or North Carolina, and
// whenever no state has been identified yet (e.g. before an address has
// been entered/geocoded).
const DEFAULT_OPERATING_DEFAULTS: StateOperatingDefaults = {
  cleaning: 150,
  lawnCare: 150,
  pestControl: 50,
};

const STATE_DISPLAY_NAMES: Record<string, string> = {
  TX: "Texas",
  GA: "Georgia",
  NC: "North Carolina",
};

/** Returns the recommended monthly Cleaning/Lawn Care/Pest Control
 * defaults for a given state abbreviation. Falls back to the "all
 * other states" defaults for an unrecognized code, an empty string, or
 * `undefined`/`null` (no state identified yet). Case-insensitive. */
export function getOperatingDefaultsForState(stateCode: string | null | undefined): StateOperatingDefaults {
  const key = stateCode?.trim().toUpperCase();
  if (key && STATE_OPERATING_DEFAULTS[key]) {
    return STATE_OPERATING_DEFAULTS[key];
  }
  return DEFAULT_OPERATING_DEFAULTS;
}

/** A short, human-readable label describing where the current
 * Cleaning/Lawn Care/Pest Control values came from, for display next
 * to the fields and in the Excel export (mirrors the Property Tax
 * section's "County Default" / "Manual Override" provenance note). */
export function operatingDefaultsSourceLabel(
  stateCode: string | null | undefined,
  allAutoDefaulted: boolean
): string {
  if (!allAutoDefaulted) return "Custom values entered";
  const key = stateCode?.trim().toUpperCase();
  const stateName = key ? STATE_DISPLAY_NAMES[key] : undefined;
  if (stateName) return `Recommended monthly defaults for ${stateName}`;
  if (key) return `Recommended monthly defaults for ${key}`;
  return "Recommended monthly defaults";
}
