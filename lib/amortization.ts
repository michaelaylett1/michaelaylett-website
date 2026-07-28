/**
 * Shared, framework-agnostic amortization math -- the single canonical
 * implementation used by SharedHousingCalculator.tsx (on-page schedules,
 * ROI principal paydown, balloon analysis, printable report) and
 * lib/underwritingExcelExport.ts (the Excel export's Amortization
 * Schedule worksheets). Every declining-balance calculation in this
 * project should trace back to one of the two functions below, so a
 * loan's projected balance at any point in time is always identical no
 * matter which surface is asking.
 *
 * Every dollar figure is worked out in unrounded values internally where
 * practical; buildAmortizationScheduleForTerm rounds each row to cents
 * (matching how a real loan servicer's statement rounds every payment),
 * with the final payment absorbing whatever few cents of rounding drift
 * accumulated, so every schedule always reaches exactly $0.00.
 */

export interface AmortizationRow {
  paymentNumber: number;
  beginningBalance: number;
  principalPaid: number;
  interestPaid: number;
  totalPayment: number;
  endingBalance: number;
}

export interface AmortizationScheduleResult {
  schedule: AmortizationRow[];
  monthlyPayment: number;
}

export interface AnnualAmortizationRow {
  year: number;
  beginningBalance: number;
  totalPayments: number;
  principalPaid: number;
  interestPaid: number;
  endingBalance: number;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * The standard fixed-rate monthly payment that fully amortizes
 * `principal` over `numPayments` months at `annualRatePct`. At a 0%
 * rate this correctly reduces to equal principal payments each month
 * (straight-line division), matching how a 0% note actually pays down.
 */
export function calculateMonthlyPaymentForTerm(
  principal: number,
  annualRatePct: number,
  numPayments: number
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  const n = Math.max(1, Math.round(numPayments));
  const monthlyRate = annualRatePct / 100 / 12;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    return principal / n;
  }
  const factor = Math.pow(1 + monthlyRate, n);
  const payment = (principal * (monthlyRate * factor)) / (factor - 1);
  return Number.isFinite(payment) ? payment : 0;
}

/**
 * Builds the complete month-by-month amortization schedule for one loan
 * using declining-balance math (never simple/flat interest): each
 * payment's interest portion is calculated on that month's actual
 * beginning balance. When `monthlyPaymentOverride` is provided (a real
 * entered payment, e.g. an existing Subject-To loan's actual P&I
 * payment) that figure drives every month's math instead of the
 * standard derived payment -- still declining-balance, just anchored to
 * the real payment rather than an assumed one. The schedule stops early
 * if a below-standard payment would put the loan into negative
 * amortization forever (interest-only or worse): principal never goes
 * negative, and the loop is capped at `numPayments` either way.
 */
export function buildAmortizationScheduleForTerm(
  principal: number,
  annualRatePct: number,
  numPayments: number,
  monthlyPaymentOverride?: number
): AmortizationScheduleResult {
  const roundedPrincipal = round2(Math.max(0, principal));
  const n = Math.max(1, Math.round(numPayments));
  const derivedPayment = calculateMonthlyPaymentForTerm(roundedPrincipal, annualRatePct, n);
  const monthlyPayment = round2(
    monthlyPaymentOverride && monthlyPaymentOverride > 0 ? monthlyPaymentOverride : derivedPayment
  );

  if (roundedPrincipal <= 0 || monthlyPayment <= 0) {
    return { schedule: [], monthlyPayment: 0 };
  }

  const monthlyRate = annualRatePct / 100 / 12;
  const schedule: AmortizationRow[] = [];
  let balance = roundedPrincipal;

  for (let i = 1; i <= n; i++) {
    const beginningBalance = balance;
    const interestPaid = round2(beginningBalance * monthlyRate);
    const isFinalPayment = i === n;
    let principalPaid = round2(monthlyPayment - interestPaid);

    // Guards against rounding ever taking the balance below $0, and
    // against a below-standard override payment never actually paying
    // off the loan (negative amortization) -- principal paid is never
    // allowed to go negative; the loop still ends at n payments either
    // way with whatever balance remains.
    if (principalPaid < 0) principalPaid = 0;
    if (isFinalPayment || principalPaid >= beginningBalance) {
      principalPaid = beginningBalance;
    }

    const totalPayment = round2(interestPaid + principalPaid);
    const endingBalance = Math.max(0, round2(beginningBalance - principalPaid));

    schedule.push({
      paymentNumber: i,
      beginningBalance,
      principalPaid,
      interestPaid,
      totalPayment,
      endingBalance,
    });

    balance = endingBalance;
    if (balance <= 0) break;
  }

  return { schedule, monthlyPayment };
}

/** Rolls a monthly schedule up into 12-month annual summary rows (the
 * last year may be a partial year if the schedule pays off mid-year). */
export function buildAnnualAmortizationSummary(schedule: AmortizationRow[]): AnnualAmortizationRow[] {
  const annualRows: AnnualAmortizationRow[] = [];
  for (let i = 0; i < schedule.length; i += 12) {
    const chunk = schedule.slice(i, i + 12);
    if (chunk.length === 0) continue;
    annualRows.push({
      year: Math.floor(i / 12) + 1,
      beginningBalance: chunk[0].beginningBalance,
      totalPayments: round2(chunk.reduce((s, r) => s + r.totalPayment, 0)),
      principalPaid: round2(chunk.reduce((s, r) => s + r.principalPaid, 0)),
      interestPaid: round2(chunk.reduce((s, r) => s + r.interestPaid, 0)),
      endingBalance: chunk[chunk.length - 1].endingBalance,
    });
  }
  return annualRows;
}

/**
 * The remaining principal balance of a fully-amortizing loan after
 * `monthsElapsed` of its `totalMonths` term, using the closed-form true
 * amortization formula (never simple/linear division): B_k = P x
 * [(1+r)^n - (1+r)^k] / [(1+r)^n - 1]. At a 0% rate this correctly
 * reduces to equal principal payments each month (straight-line),
 * matching how a 0% seller-finance note actually pays down. This is the
 * O(1) equivalent of reading buildAmortizationScheduleForTerm's row `k`
 * endingBalance without building the whole schedule -- used by the ROI
 * projection (30 yearly checkpoints) and Balloon Refinance Analysis
 * (one checkpoint), which only ever need the balance at specific
 * points, not the full month-by-month detail.
 */
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

/**
 * Solves for the number of months remaining to fully amortize `principal`
 * at `annualRatePct`, given the loan's actual monthly principal-and-
 * interest payment, using the closed-form formula
 * n = -ln(1 - (r*P)/M) / ln(1+r) (the algebraic inverse of
 * calculateMonthlyPaymentForTerm). At a 0% rate this reduces to simple
 * division (P/M), matching how a 0% note actually pays down.
 *
 * `insufficientPayment` is true when the payment does not even cover one
 * month's interest at the entered rate (M <= r*P) -- the loan
 * mathematically never amortizes at that payment, so `months` is always
 * null in that case rather than a nonsensical negative or infinite
 * result. `months` is also null (with `insufficientPayment: false`) for
 * any other invalid/non-finite input (e.g. zero or negative principal,
 * payment, or rate producing no real solution).
 */
export function estimateAmortizationMonthsFromPayment(
  principal: number,
  annualRatePct: number,
  monthlyPayment: number
): { months: number | null; insufficientPayment: boolean } {
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isFinite(monthlyPayment) || monthlyPayment <= 0) {
    return { months: null, insufficientPayment: false };
  }
  const monthlyRate = annualRatePct / 100 / 12;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    const months = principal / monthlyPayment;
    return Number.isFinite(months) && months > 0
      ? { months: Math.ceil(months), insufficientPayment: false }
      : { months: null, insufficientPayment: false };
  }
  const interestOnlyPayment = principal * monthlyRate;
  if (monthlyPayment <= interestOnlyPayment) {
    return { months: null, insufficientPayment: true };
  }
  const ratio = 1 - (monthlyRate * principal) / monthlyPayment;
  if (!(ratio > 0)) {
    return { months: null, insufficientPayment: true };
  }
  const months = -Math.log(ratio) / Math.log(1 + monthlyRate);
  return Number.isFinite(months) && months > 0
    ? { months: Math.ceil(months), insufficientPayment: false }
    : { months: null, insufficientPayment: false };
}

/** The resolved "how many months are left on this loan" answer that
 * every Subject-To / Hybrid-existing-mortgage consumer (on-page
 * schedule, balloon analysis, ROI projection, print report, Excel
 * export) should use, so they always agree with each other and none of
 * them silently invents its own fallback term:
 *   1. An explicitly entered remaining term (in years) always wins,
 *      exactly as entered -- never labeled as an estimate.
 *   2. Otherwise, if the loan's actual monthly principal-and-interest
 *      payment is known, the term is solved for mathematically from
 *      balance + rate + payment and labeled `isEstimated: true`.
 *   3. Otherwise (neither is known), `months` is null -- callers must
 *      treat this as "cannot be calculated yet" rather than assuming
 *      any particular term (e.g. 30 years). */
export interface EffectiveAmortizationTerm {
  months: number | null;
  isEstimated: boolean;
  // Only meaningful when months is null: true means a known payment WAS
  // entered but it can't cover interest at the entered rate (a real
  // problem worth a warning), as opposed to simply not having enough
  // information yet.
  insufficientPayment: boolean;
}

export function resolveEffectiveAmortizationTerm(
  principal: number,
  annualRatePct: number,
  remainingYears: number | null,
  knownMonthlyPIPayment: number | null
): EffectiveAmortizationTerm {
  if (remainingYears !== null && Number.isFinite(remainingYears) && remainingYears > 0) {
    return { months: Math.max(1, Math.round(remainingYears * 12)), isEstimated: false, insufficientPayment: false };
  }
  if (knownMonthlyPIPayment !== null && Number.isFinite(knownMonthlyPIPayment) && knownMonthlyPIPayment > 0) {
    const estimate = estimateAmortizationMonthsFromPayment(principal, annualRatePct, knownMonthlyPIPayment);
    if (estimate.months !== null) {
      return { months: estimate.months, isEstimated: true, insufficientPayment: false };
    }
    return { months: null, isEstimated: false, insufficientPayment: estimate.insufficientPayment };
  }
  return { months: null, isEstimated: false, insufficientPayment: false };
}

// Shown near every Subject-To and Hybrid-existing-mortgage amortization
// schedule (on-page, print report, and the Excel amortization
// worksheet) -- these loans originated before the acquisition date, so
// the estimate can only ever approximate the lender's own records.
export const SUBJECT_TO_AMORTIZATION_DISCLOSURE =
  "Estimated amortization schedule only. Because this financing takes over an existing mortgage that " +
  "originated before the acquisition date, the actual principal balance, payment allocation, and " +
  "remaining amortization schedule may differ. Obtain the current loan amortization schedule or " +
  "mortgage statement from the lender for the most accurate information.";
