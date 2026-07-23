/**
 * 30-Year ROI Projection: a shared, framework-agnostic calculation
 * engine used by both SharedHousingCalculator.tsx (on-page results and
 * the printable report) and lib/underwritingExcelExport.ts (the Excel
 * export), so all three surfaces are guaranteed to show the exact same
 * numbers -- there is only one place this math is written.
 *
 * Every dollar figure is worked out in unrounded values internally;
 * only the values actually displayed anywhere should be rounded.
 *
 * Total Return, by year:
 *   Annual Total Return = Annual Net Cash Flow + Annual Principal
 *                          Paydown + Annual Appreciation
 *   Annual ROI = Annual Total Return / Initial Total Capital Required
 *   Cumulative Total Return = running sum of Annual Total Return
 *   Cumulative ROI = Cumulative Total Return / Initial Total Capital
 *                     Required
 * The denominator is always the ORIGINAL (Year 1) Total Capital
 * Required -- never recalculated or changed year to year.
 */

// ---------------------------------------------------------------------
// True amortization math (mirrors remainingBalanceAfterMonths in
// SharedHousingCalculator.tsx exactly -- kept as its own copy here so
// this module has no dependency on the component file). B_k = P x
// [(1+r)^n - (1+r)^k] / [(1+r)^n - 1], with a straight-line special
// case at a 0% rate.
// ---------------------------------------------------------------------
export function remainingBalanceAfterMonths(
  principal: number,
  annualRatePct: number,
  totalMonths: number,
  monthsElapsed: number
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  const n = Math.max(1, Math.round(totalMonths));
  const k = Math.max(0, Math.min(n, Math.round(monthsElapsed)));
  if (k >= n) return 0;
  const monthlyRate = annualRatePct / 100 / 12;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    return (principal * (n - k)) / n;
  }
  const factor = Math.pow(1 + monthlyRate, n);
  const factorK = Math.pow(1 + monthlyRate, k);
  if (!Number.isFinite(factor) || factor <= 1) return principal;
  const balance = (principal * (factor - factorK)) / (factor - 1);
  return Number.isFinite(balance) ? Math.max(0, balance) : 0;
}

// ---------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------

// One amortizing (or non-amortizing) debt against the property today.
// `active: false` means this debt currently makes no monthly principal
// payment at all (e.g. Hybrid/Stack Method seller-financed balance with
// "Are Monthly Seller-Finance Payments Required?" set to No) -- its
// balance never moves on its own, and its annual principal paydown is
// always $0, until either a monthly payment is turned on or a balloon
// forces it to be resolved.
export interface RoiDebtLeg {
  label: string;
  balance: number;
  ratePct: number;
  amortMonths: number;
  active: boolean;
}

// A single combined balloon event covering every leg above at once
// (matches how this calculator already models Balloon Refinance
// Analysis for Hybrid/Stack Method: one Balloon Due in Years, one 70%
// LTV contingency, for the whole structure).
export interface RoiBalloonConfig {
  balloonYears: number;
  refinanceAtBalloon: boolean;
  refinanceRatePct: number;
}

export interface RoiYearLegRow {
  label: string;
  beginningBalance: number;
  principalPaydown: number;
  endingBalance: number;
}

export interface RoiYearRow {
  year: number;
  beginningPropertyValue: number;
  annualAppreciation: number;
  endingPropertyValue: number;
  legs: RoiYearLegRow[];
  totalPrincipalPaydown: number;
  annualNetCashFlow: number;
  annualTotalReturn: number;
  annualRoi: number | null;
  cumulativeTotalReturn: number;
  cumulativeRoi: number | null;
  endingTotalDebt: number;
  estimatedEndingEquity: number;
  isBalloonYear: boolean;
  isRefinanceYear: boolean;
  balloonUnresolved: boolean;
}

export interface RoiProjectionInput {
  purchasePrice: number;
  appreciationPct: number;
  totalCapitalRequired: number;
  annualNetCashFlow: number;
  legs: RoiDebtLeg[];
  balloon: RoiBalloonConfig | null;
  years?: number;
}

export interface RoiProjectionResult {
  year1TotalRoi: number | null;
  rows: RoiYearRow[];
}

export const ROI_PROJECTION_YEARS = 30;
export const ROI_REPLACEMENT_LOAN_LABEL = "Replacement Loan (Post-Balloon Refinance)";

export function buildRoiProjection(input: RoiProjectionInput): RoiProjectionResult {
  const years = input.years ?? ROI_PROJECTION_YEARS;
  const rows: RoiYearRow[] = [];
  let cumulativeReturn = 0;

  // If a balloon exists and is being refinanced, the combined balance
  // due at the balloon date becomes the principal of one new
  // replacement loan (30-year amortizing at the refinance rate),
  // starting the year immediately after the balloon.
  let refiOriginalBalance = 0;
  if (input.balloon) {
    const atBalloonMonths = Math.round(input.balloon.balloonYears * 12);
    refiOriginalBalance = input.legs.reduce((sum, leg) => {
      if (!leg.active) return sum + leg.balance;
      return sum + remainingBalanceAfterMonths(leg.balance, leg.ratePct, leg.amortMonths, atBalloonMonths);
    }, 0);
  }

  let propertyValue = input.purchasePrice;
  for (let year = 1; year <= years; year++) {
    const beginningPropertyValue = propertyValue;
    const annualAppreciation = beginningPropertyValue * (input.appreciationPct / 100);
    const endingPropertyValue = beginningPropertyValue + annualAppreciation;
    propertyValue = endingPropertyValue;

    const monthStart = (year - 1) * 12;
    const monthEnd = year * 12;
    const balloonYears = input.balloon?.balloonYears ?? null;
    const pastBalloon = balloonYears !== null && year > balloonYears;
    const isBalloonYear = balloonYears !== null && year === balloonYears;
    const isRefinanceYear =
      pastBalloon && !!input.balloon?.refinanceAtBalloon && year === (balloonYears as number) + 1;

    let legRows: RoiYearLegRow[];
    let balloonUnresolved = false;

    if (pastBalloon && input.balloon && !input.balloon.refinanceAtBalloon) {
      // Balloon due and not refinanced: every leg is frozen at its
      // balance as of the balloon date. No further principal paydown is
      // modeled -- the debt is immediately due and unresolved.
      balloonUnresolved = true;
      const atBalloonMonths = Math.round((balloonYears as number) * 12);
      legRows = input.legs.map((leg) => {
        const atBalloon = leg.active
          ? remainingBalanceAfterMonths(leg.balance, leg.ratePct, leg.amortMonths, atBalloonMonths)
          : leg.balance;
        return { label: leg.label, beginningBalance: atBalloon, principalPaydown: 0, endingBalance: atBalloon };
      });
    } else if (pastBalloon && input.balloon && input.balloon.refinanceAtBalloon) {
      // Refinanced into one new combined loan the year after the
      // balloon. The refinance proceeds themselves are never counted as
      // income or return, and the balloon payoff itself is never
      // counted as principal paydown -- only this replacement loan's
      // own ordinary amortization going forward is.
      const monthsSinceRefiStart = (year - 1 - (balloonYears as number)) * 12;
      const monthsSinceRefiEnd = (year - (balloonYears as number)) * 12;
      const beginning = remainingBalanceAfterMonths(refiOriginalBalance, input.balloon.refinanceRatePct, 360, monthsSinceRefiStart);
      const ending = remainingBalanceAfterMonths(refiOriginalBalance, input.balloon.refinanceRatePct, 360, monthsSinceRefiEnd);
      legRows = [
        {
          label: ROI_REPLACEMENT_LOAN_LABEL,
          beginningBalance: beginning,
          principalPaydown: Math.max(0, beginning - ending),
          endingBalance: ending,
        },
      ];
    } else {
      // Normal amortization (before any balloon, or no balloon at all):
      // one row per original debt leg.
      legRows = input.legs.map((leg) => {
        if (!leg.active) {
          return { label: leg.label, beginningBalance: leg.balance, principalPaydown: 0, endingBalance: leg.balance };
        }
        const beginning = remainingBalanceAfterMonths(leg.balance, leg.ratePct, leg.amortMonths, monthStart);
        const ending = remainingBalanceAfterMonths(leg.balance, leg.ratePct, leg.amortMonths, monthEnd);
        return {
          label: leg.label,
          beginningBalance: beginning,
          principalPaydown: Math.max(0, beginning - ending),
          endingBalance: ending,
        };
      });
    }

    const totalPrincipalPaydown = legRows.reduce((s, l) => s + l.principalPaydown, 0);
    const endingTotalDebt = legRows.reduce((s, l) => s + l.endingBalance, 0);
    const annualTotalReturn = input.annualNetCashFlow + totalPrincipalPaydown + annualAppreciation;
    const annualRoi = input.totalCapitalRequired > 0 ? annualTotalReturn / input.totalCapitalRequired : null;
    cumulativeReturn += annualTotalReturn;
    const cumulativeRoi = input.totalCapitalRequired > 0 ? cumulativeReturn / input.totalCapitalRequired : null;
    const estimatedEndingEquity = endingPropertyValue - endingTotalDebt;

    rows.push({
      year,
      beginningPropertyValue,
      annualAppreciation,
      endingPropertyValue,
      legs: legRows,
      totalPrincipalPaydown,
      annualNetCashFlow: input.annualNetCashFlow,
      annualTotalReturn,
      annualRoi,
      cumulativeTotalReturn: cumulativeReturn,
      cumulativeRoi,
      endingTotalDebt,
      estimatedEndingEquity,
      isBalloonYear,
      isRefinanceYear,
      balloonUnresolved,
    });
  }

  return {
    year1TotalRoi: rows[0]?.annualRoi ?? null,
    rows,
  };
}

export function roiAtYear(result: RoiProjectionResult, year: number): RoiYearRow | null {
  return result.rows.find((r) => r.year === year) ?? null;
}
