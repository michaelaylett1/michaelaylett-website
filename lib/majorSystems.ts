/**
 * Shared, framework-agnostic Major Systems & Remaining Life logic -- the
 * single canonical implementation used by SharedHousingCalculator.tsx
 * (the on-page Major Systems section, Full Underwriting Breakdown,
 * printable report) and lib/underwritingExcelExport.ts (the Major
 * Systems worksheet). One shared section, not duplicated per financing
 * structure -- Roof/HVAC/Water Heater/Plumbing/Electrical describe the
 * physical property, not the financing chosen for it, so the same data
 * applies to Traditional Financing, Subject To, Seller Financing,
 * Hybrid, and Stack Method alike.
 *
 * Reserve trigger threshold, expected useful lives, and default
 * replacement costs all live here as named constants so every consumer
 * (website, print, Excel) reads the exact same numbers.
 */

export type SystemCondition = "excellent" | "good" | "fair" | "poor" | "unknown";
export type IncludeReserveOption = "automatic" | "yes" | "no";
export type PlumbingType = "copper" | "pex" | "cpvc" | "galvanized" | "castIron" | "pvc" | "other" | "unknown";
export type ElectricalType = "updated" | "partiallyUpdated" | "original" | "unknown";

export const CONDITION_OPTIONS: { value: SystemCondition; label: string }[] = [
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
  { value: "unknown", label: "Unknown" },
];

export const PLUMBING_TYPE_OPTIONS: { value: PlumbingType; label: string }[] = [
  { value: "copper", label: "Copper" },
  { value: "pex", label: "PEX" },
  { value: "cpvc", label: "CPVC" },
  { value: "galvanized", label: "Galvanized" },
  { value: "castIron", label: "Cast Iron" },
  { value: "pvc", label: "PVC" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" },
];

export const ELECTRICAL_TYPE_OPTIONS: { value: ElectricalType; label: string }[] = [
  { value: "updated", label: "Updated" },
  { value: "partiallyUpdated", label: "Partially Updated" },
  { value: "original", label: "Original" },
  { value: "unknown", label: "Unknown" },
];

// Expected useful life assumptions (spec section 2) -- Plumbing and
// Electrical deliberately have no fixed expected life; their remaining
// life is only ever calculated when the user manually enters an
// Estimated Useful Life.
export const EXPECTED_USEFUL_LIFE_YEARS: Record<"roof" | "hvac" | "waterHeater", number> = {
  roof: 25,
  hvac: 15,
  waterHeater: 10,
};

// Default automatic-reserve replacement cost assumptions (spec section
// 9) -- fully editable per property; these are only the starting
// defaults new/reset underwriting records begin with.
export const DEFAULT_REPLACEMENT_COST: Record<"roof" | "hvac" | "waterHeater", number> = {
  roof: 15000,
  hvac: 7000,
  waterHeater: 3000,
};

// Estimated Remaining Life below this many years triggers the red
// status and (for Roof/HVAC/Water Heater, when eligible) the automatic
// replacement reserve. Simple green/red only -- no intermediate yellow
// state, per spec section 4.
export const RESERVE_TRIGGER_YEARS = 5;

export const MAJOR_SYSTEM_KEYS = ["roof", "hvac", "waterHeater", "plumbing", "electrical"] as const;
export type ReserveSystemKey = "roof" | "hvac" | "waterHeater";
export type UtilitySystemKey = "plumbing" | "electrical";
export type MajorSystemKey = (typeof MAJOR_SYSTEM_KEYS)[number];

export const SYSTEM_LABELS: Record<MajorSystemKey, string> = {
  roof: "Roof",
  hvac: "HVAC",
  waterHeater: "Water Heater",
  plumbing: "Plumbing",
  electrical: "Electrical",
};

// ---------------------------------------------------------------------
// State shapes
// ---------------------------------------------------------------------

export interface ReserveSystemState {
  ageYears: number;
  ageUnknown: boolean;
  condition: SystemCondition;
  notes: string;
  replacementCost: number;
  includeReserve: IncludeReserveOption;
  alreadyInScopeOfWork: boolean;
}

export interface UtilitySystemState {
  ageYears: number;
  ageUnknown: boolean;
  condition: SystemCondition;
  notes: string;
  // Optional manual entry -- null means "not entered," which is the
  // default and means no remaining-life estimate is ever invented for
  // Plumbing/Electrical (spec section 2).
  estimatedUsefulLifeYears: number | null;
}

export interface MajorSystemsState {
  roof: ReserveSystemState;
  hvac: ReserveSystemState;
  waterHeater: ReserveSystemState;
  plumbing: UtilitySystemState & { plumbingType: PlumbingType };
  electrical: UtilitySystemState & { electricalType: ElectricalType };
}

function defaultReserveSystem(replacementCost: number): ReserveSystemState {
  return {
    ageYears: 0,
    // Age Unknown defaults to true for a brand-new/reset record -- so no
    // remaining-life estimate or automatic reserve is ever invented for
    // a property nobody has entered real system data for yet (spec
    // section 18: existing/new records with no Major Systems information
    // must never unexpectedly increase Base Reserves).
    ageUnknown: true,
    condition: "unknown",
    notes: "",
    replacementCost,
    includeReserve: "automatic",
    alreadyInScopeOfWork: false,
  };
}

function defaultUtilitySystem(): UtilitySystemState {
  return {
    ageYears: 0,
    ageUnknown: true,
    condition: "unknown",
    notes: "",
    estimatedUsefulLifeYears: null,
  };
}

export function makeDefaultMajorSystemsState(): MajorSystemsState {
  return {
    roof: defaultReserveSystem(DEFAULT_REPLACEMENT_COST.roof),
    hvac: defaultReserveSystem(DEFAULT_REPLACEMENT_COST.hvac),
    waterHeater: defaultReserveSystem(DEFAULT_REPLACEMENT_COST.waterHeater),
    plumbing: { ...defaultUtilitySystem(), plumbingType: "unknown" },
    electrical: { ...defaultUtilitySystem(), electricalType: "unknown" },
  };
}

// ---------------------------------------------------------------------
// Remaining life
// ---------------------------------------------------------------------

export interface RemainingLifeResult {
  // Signed years (Expected Life - Age); null whenever it cannot be
  // calculated (age unknown, or -- for Plumbing/Electrical -- no
  // Estimated Useful Life entered).
  years: number | null;
  isKnown: boolean;
  // True when years !== null && years < RESERVE_TRIGGER_YEARS --
  // includes the "reached" (0) and "exceeded" (negative) cases. This is
  // the single source of truth for both the red/green status color and
  // the automatic reserve-eligibility check, so they can never disagree.
  isBelowThreshold: boolean;
  // Human-readable label per spec section 3.
  label: string;
}

function formatYearsLabel(years: number): string {
  const rounded = Math.round(years);
  if (rounded === 0) return "Expected useful life reached";
  if (rounded < 0) {
    const exceededBy = Math.abs(rounded);
    return `Expected useful life exceeded by approximately ${exceededBy} year${exceededBy === 1 ? "" : "s"}`;
  }
  return `${rounded} year${rounded === 1 ? "" : "s"}`;
}

/**
 * Roof / HVAC / Water Heater: Expected Useful Life is always the fixed
 * assumption from EXPECTED_USEFUL_LIFE_YEARS, so remaining life is
 * always calculable once an age is entered.
 */
export function computeFixedRemainingLife(ageYears: number, ageUnknown: boolean, expectedLifeYears: number): RemainingLifeResult {
  if (ageUnknown) {
    return {
      years: null,
      isKnown: false,
      isBelowThreshold: false,
      label: "Remaining life cannot be estimated without the system age.",
    };
  }
  const years = expectedLifeYears - ageYears;
  return {
    years,
    isKnown: true,
    isBelowThreshold: years < RESERVE_TRIGGER_YEARS,
    label: formatYearsLabel(years),
  };
}

/**
 * Plumbing / Electrical: no fixed expected life -- only calculated when
 * the user has entered both an age and a manual Estimated Useful Life.
 * Never invents a remaining-life estimate otherwise (spec section 2).
 */
export function computeManualRemainingLife(
  ageYears: number,
  ageUnknown: boolean,
  estimatedUsefulLifeYears: number | null
): RemainingLifeResult {
  if (ageUnknown) {
    return {
      years: null,
      isKnown: false,
      isBelowThreshold: false,
      label: "Remaining life cannot be estimated without the system age.",
    };
  }
  if (estimatedUsefulLifeYears === null) {
    return {
      years: null,
      isKnown: false,
      isBelowThreshold: false,
      label: "Enter an Estimated Useful Life to calculate remaining life.",
    };
  }
  const years = estimatedUsefulLifeYears - ageYears;
  return {
    years,
    isKnown: true,
    isBelowThreshold: years < RESERVE_TRIGGER_YEARS,
    label: formatYearsLabel(years),
  };
}

// ---------------------------------------------------------------------
// Status (color + labels + condition note) -- spec sections 4 and 5
// ---------------------------------------------------------------------

export type StatusColor = "green" | "red" | "neutral";

export interface SystemStatus {
  color: StatusColor;
  statusLabel: string;
  // Present only for Fair/Unknown condition, per spec section 5.
  conditionNote: string | null;
}

/**
 * Condition creates its own warning layer on top of the calculated
 * remaining-life color (spec section 5): Poor always forces red
 * regardless of the calculated remaining life (or even if it is
 * unknown); Fair keeps the calculated color but adds a due-diligence
 * note; Unknown keeps the calculated color but adds a verification
 * note. Condition never triggers the automatic dollar reserve by
 * itself -- only Estimated Remaining Life < 5 years does that (spec
 * section 6); Poor is a visual/due-diligence signal only.
 */
export function computeSystemStatus(condition: SystemCondition, remaining: RemainingLifeResult): SystemStatus {
  if (condition === "poor") {
    return { color: "red", statusLabel: "Replacement Reserve Recommended", conditionNote: null };
  }
  let color: StatusColor;
  let statusLabel: string;
  if (!remaining.isKnown) {
    color = "neutral";
    statusLabel = "Remaining Life Not Estimated";
  } else if (remaining.isBelowThreshold) {
    color = "red";
    statusLabel = "Replacement Reserve Recommended";
  } else {
    color = "green";
    statusLabel = "Good Remaining Life";
  }
  const conditionNote =
    condition === "fair"
      ? "Condition should be reviewed during due diligence."
      : condition === "unknown"
        ? "Condition not verified."
        : null;
  return { color, statusLabel, conditionNote };
}

// ---------------------------------------------------------------------
// Reserve inclusion + dollar amounts -- spec sections 6, 7, 9, 10, 15
// ---------------------------------------------------------------------

export interface ReserveInclusionResult {
  included: boolean;
  amount: number;
  // Why: surfaced on-page/print/Excel so the decision is always
  // auditable, per spec's repeated "clearly show" requirements.
  reason:
    | "alreadyInScopeOfWork"
    | "manualYes"
    | "manualNo"
    | "automaticBelowThreshold"
    | "automaticAboveThreshold"
    | "automaticUnknown";
}

/**
 * Already-in-Scope-of-Work always wins, regardless of the Include
 * Replacement Reserve selection -- this is what prevents double-
 * counting the same replacement cost in both Scope of Work and Reserves
 * (spec section 15). Otherwise a manual Yes/No override wins; only
 * "Automatic" falls back to the < 5-year threshold, which requires the
 * remaining life to actually be known (Age Unknown + Automatic never
 * invents a reserve on its own -- spec section 12).
 */
export function computeReserveInclusion(system: ReserveSystemState, remaining: RemainingLifeResult): ReserveInclusionResult {
  if (system.alreadyInScopeOfWork) {
    return { included: false, amount: 0, reason: "alreadyInScopeOfWork" };
  }
  if (system.includeReserve === "yes") {
    return { included: true, amount: system.replacementCost, reason: "manualYes" };
  }
  if (system.includeReserve === "no") {
    return { included: false, amount: 0, reason: "manualNo" };
  }
  // Automatic
  if (!remaining.isKnown) {
    return { included: false, amount: 0, reason: "automaticUnknown" };
  }
  if (remaining.isBelowThreshold) {
    return { included: true, amount: system.replacementCost, reason: "automaticBelowThreshold" };
  }
  return { included: false, amount: 0, reason: "automaticAboveThreshold" };
}

export interface MajorSystemsReserveSummary {
  baseReserves: number;
  roofReserve: number;
  hvacReserve: number;
  waterHeaterReserve: number;
  majorSystemReserveAdditions: number;
  totalReserves: number;
  roofIncluded: ReserveInclusionResult;
  hvacIncluded: ReserveInclusionResult;
  waterHeaterIncluded: ReserveInclusionResult;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * The single reserve-summary calculation used everywhere (spec section
 * 8/13/14): Base Reserves is the existing, unchanged, manually-editable
 * reserve figure (backward compatible with every prior underwriting
 * record); Major System Reserve Additions is the sum of whichever of
 * Roof/HVAC/Water Heater are currently eligible; Total Reserves is
 * their sum. This is the exact number that must flow into Total Capital
 * Required / stackBaseCapitalRequired -- see SharedHousingCalculator.tsx.
 */
export function computeMajorSystemsReserveSummary(
  majorSystems: MajorSystemsState,
  baseReserves: number
): MajorSystemsReserveSummary {
  const roofRemaining = computeFixedRemainingLife(majorSystems.roof.ageYears, majorSystems.roof.ageUnknown, EXPECTED_USEFUL_LIFE_YEARS.roof);
  const hvacRemaining = computeFixedRemainingLife(majorSystems.hvac.ageYears, majorSystems.hvac.ageUnknown, EXPECTED_USEFUL_LIFE_YEARS.hvac);
  const waterHeaterRemaining = computeFixedRemainingLife(
    majorSystems.waterHeater.ageYears,
    majorSystems.waterHeater.ageUnknown,
    EXPECTED_USEFUL_LIFE_YEARS.waterHeater
  );
  const roofIncluded = computeReserveInclusion(majorSystems.roof, roofRemaining);
  const hvacIncluded = computeReserveInclusion(majorSystems.hvac, hvacRemaining);
  const waterHeaterIncluded = computeReserveInclusion(majorSystems.waterHeater, waterHeaterRemaining);
  const roofReserve = round2(roofIncluded.amount);
  const hvacReserve = round2(hvacIncluded.amount);
  const waterHeaterReserve = round2(waterHeaterIncluded.amount);
  const majorSystemReserveAdditions = round2(roofReserve + hvacReserve + waterHeaterReserve);
  const totalReserves = round2(baseReserves + majorSystemReserveAdditions);
  return {
    baseReserves: round2(baseReserves),
    roofReserve,
    hvacReserve,
    waterHeaterReserve,
    majorSystemReserveAdditions,
    totalReserves,
    roofIncluded,
    hvacIncluded,
    waterHeaterIncluded,
  };
}

// ---------------------------------------------------------------------
// Plumbing / Electrical capital-expense warning -- spec section 7
// ---------------------------------------------------------------------
export function shouldShowMajorCapitalExpenseWarning(condition: SystemCondition): boolean {
  return condition === "poor";
}

export const MAJOR_CAPITAL_EXPENSE_WARNING =
  "Potential major capital expense. Consider adding an additional reserve or including this work in the Scope of Work.";

export const SCOPE_OF_WORK_ALREADY_INCLUDED_NOTE = "Replacement cost accounted for in Scope of Work.";
