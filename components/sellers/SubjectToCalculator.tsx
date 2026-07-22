"use client";

/**
 * Illustrative subject-to and seller carry calculator for the Sellers
 * page. Models a hypothetical purchase structured as:
 *
 *   - The existing mortgage is purchased subject to its current terms;
 *     the buyer takes responsibility for making those payments, but the
 *     loan is not formally assumed or transferred by the lender.
 *   - Cash paid to the seller at closing is capped at the lesser of the
 *     seller's available equity or 7% of the property value.
 *   - Any equity above that cash cap becomes a seller-carried balance,
 *     repaid through PRINCIPAL-ONLY monthly payments over 30 years (360
 *     equal payments, 0% interest, no balloon payment). There is no
 *     interest calculation anywhere in this calculator: the seller-carry
 *     balance is simply divided across 360 equal principal payments,
 *     with the final payment nudged by a few cents if needed so the
 *     schedule always lands on an exact $0.00 ending balance.
 *
 * Illustrative and educational only. Not an offer, guarantee, or
 * substitute for underwriting, title review, lender consent, or legal
 * and tax advice; the disclaimer below says so explicitly. Nothing here
 * is submitted anywhere, it is all computed client-side.
 */

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const MAX_CASH_RATE = 0.07; // cash at closing capped at 7% of property value
const REPAYMENT_YEARS = 30;
const NUM_PAYMENTS = REPAYMENT_YEARS * 12; // 360 principal-only payments

const VALUE_MIN = 100000;
const VALUE_MAX = 5000000;
const VALUE_STEP = 10000;
const VALUE_DEFAULT = 300000;

const MORTGAGE_MIN = 0;
const MORTGAGE_STEP = 5000;
const MORTGAGE_DEFAULT = 240000;

function formatWhole(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatCents(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseTypedAmount(raw: string): number {
  const digitsOnly = raw.replace(/[^0-9]/g, "");
  if (!digitsOnly) return 0;
  const n = Number(digitsOnly);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

type PrincipalOnlyRow = {
  payment: number;
  beginningBalance: number;
  principal: number;
  endingBalance: number;
};

type Schedule = {
  monthlyPayment: number;
  rows: PrincipalOnlyRow[];
  totalPrincipal: number;
};

/**
 * Builds a principal-only repayment schedule for the seller-carried
 * balance: 0% interest, 360 equal monthly principal payments, no
 * interest calculated anywhere. The final payment is adjusted so the
 * schedule always lands on exactly $0.00 rather than drifting a few
 * cents from rounding across 360 payments.
 */
function buildPrincipalOnlySchedule(balance: number): Schedule {
  if (balance <= 0) {
    return { monthlyPayment: 0, rows: [], totalPrincipal: 0 };
  }

  const n = NUM_PAYMENTS;
  const monthlyPayment = round2(balance / n);

  const rows: PrincipalOnlyRow[] = [];
  let remaining = balance;
  let totalPrincipal = 0;

  for (let i = 1; i <= n; i++) {
    const beginningBalance = remaining;
    const principal = i < n ? monthlyPayment : beginningBalance;
    const endingBalance = round2(beginningBalance - principal);

    rows.push({ payment: i, beginningBalance, principal, endingBalance });

    totalPrincipal = round2(totalPrincipal + principal);
    remaining = endingBalance;
  }

  return { monthlyPayment, rows, totalPrincipal };
}

type AnnualSummaryRow = {
  year: number;
  beginningBalance: number;
  principal: number;
  endingBalance: number;
};

function buildAnnualSummary(rows: PrincipalOnlyRow[]): AnnualSummaryRow[] {
  const years: AnnualSummaryRow[] = [];
  for (let y = 0; y < REPAYMENT_YEARS; y++) {
    const yearRows = rows.slice(y * 12, y * 12 + 12);
    if (yearRows.length === 0) continue;
    const principal = round2(yearRows.reduce((sum, r) => sum + r.principal, 0));
    years.push({
      year: y + 1,
      beginningBalance: yearRows[0].beginningBalance,
      principal,
      endingBalance: yearRows[yearRows.length - 1].endingBalance,
    });
  }
  return years;
}

function downloadCsv(rows: PrincipalOnlyRow[], propertyValue: number) {
  const header = ["Payment Number", "Beginning Balance", "Principal Payment", "Ending Balance"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.payment,
        row.beginningBalance.toFixed(2),
        row.principal.toFixed(2),
        row.endingBalance.toFixed(2),
      ].join(",")
    );
  }
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `subject-to-principal-only-schedule-${Math.round(propertyValue)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function SubjectToCalculator() {
  const [propertyValue, setPropertyValue] = useState(VALUE_DEFAULT);
  const [propertyValueInput, setPropertyValueInput] = useState(formatWhole(VALUE_DEFAULT));

  const [mortgageBalance, setMortgageBalance] = useState(MORTGAGE_DEFAULT);
  const [mortgageInput, setMortgageInput] = useState(formatWhole(MORTGAGE_DEFAULT));

  const [scheduleOpen, setScheduleOpen] = useState(false);

  const mortgageExceedsValue = mortgageBalance > propertyValue;
  const belowMinValue = propertyValue > 0 && propertyValue < VALUE_MIN;

  // --- Property value field ---
  const handleValueText = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setPropertyValueInput(raw);
    setPropertyValue(parseTypedAmount(raw));
  };
  const handleValueBlur = () => {
    const clamped = Math.max(VALUE_MIN, propertyValue);
    setPropertyValue(clamped);
    setPropertyValueInput(formatWhole(clamped));
  };
  const handleValueSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    const clamped = Math.max(0, Number.isFinite(n) ? n : 0);
    setPropertyValue(clamped);
    setPropertyValueInput(formatWhole(clamped));
  };
  const valueSliderPosition = Math.min(VALUE_MAX, Math.max(VALUE_MIN, propertyValue));

  // --- Mortgage balance field ---
  const handleMortgageText = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setMortgageInput(raw);
    setMortgageBalance(parseTypedAmount(raw));
  };
  const handleMortgageBlur = () => {
    const clamped = Math.min(Math.max(0, mortgageBalance), Math.max(0, propertyValue));
    setMortgageBalance(clamped);
    setMortgageInput(formatWhole(clamped));
  };
  const handleMortgageSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    const clamped = Math.min(Math.max(0, n), Math.max(0, propertyValue));
    setMortgageBalance(clamped);
    setMortgageInput(formatWhole(clamped));
  };
  const mortgageSliderMax = Math.max(MORTGAGE_MIN, propertyValue);
  const mortgageSliderPosition = Math.min(mortgageSliderMax, Math.max(0, mortgageBalance));

  // --- Core structure ---
  const sellerEquity = useMemo(
    () => round2(Math.max(0, propertyValue - mortgageBalance)),
    [propertyValue, mortgageBalance]
  );
  const maxCashAtClosing = useMemo(() => round2(propertyValue * MAX_CASH_RATE), [propertyValue]);
  const cashAtClosing = useMemo(
    () => round2(Math.min(sellerEquity, maxCashAtClosing)),
    [sellerEquity, maxCashAtClosing]
  );
  const sellerCarriedBalance = useMemo(
    () => round2(Math.max(0, sellerEquity - cashAtClosing)),
    [sellerEquity, cashAtClosing]
  );
  const purchasePrice = useMemo(
    () => round2(mortgageBalance + cashAtClosing + sellerCarriedBalance),
    [mortgageBalance, cashAtClosing, sellerCarriedBalance]
  );

  const schedule = useMemo(
    () => buildPrincipalOnlySchedule(sellerCarriedBalance),
    [sellerCarriedBalance]
  );
  const annualSummary = useMemo(() => buildAnnualSummary(schedule.rows), [schedule.rows]);

  // Principal-only: the total of all seller-carry payments is exactly
  // the seller-carried balance, since no interest is ever added.
  const totalReceived = useMemo(
    () => round2(cashAtClosing + schedule.totalPrincipal),
    [cashAtClosing, schedule.totalPrincipal]
  );

  const hasSellerCarry = sellerCarriedBalance > 0;

  const pathname = usePathname();
  const router = useRouter();

  // On the Sellers page itself, smooth-scroll to the inquiry form. From
  // anywhere else (e.g. the standalone Seller Calculators page), navigate
  // to the Sellers page and land on the form there instead.
  const scrollToForm = () => {
    if (pathname === "/sellers") {
      document
        .getElementById("contact-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      router.push("/sellers#contact-form");
    }
  };

  const safeValue = propertyValue > 0 ? propertyValue : 1;
  const mortgagePct = Math.min(100, (mortgageBalance / safeValue) * 100);
  const cashPct = Math.min(100 - mortgagePct, (cashAtClosing / safeValue) * 100);
  const carryPct = Math.max(0, 100 - mortgagePct - cashPct);

  return (
    <section className="bg-ink text-bone py-24 md:py-28 border-t border-line">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="max-w-2xl">
          <p className="eyebrow text-brass-light mb-4">Subject-To Calculator</p>
          <h2 className="font-display text-3xl md:text-4xl leading-tight">
            Subject-To and Seller Carry Calculator
          </h2>
          <p className="mt-5 text-slate leading-relaxed">
            Enter the estimated property value and current mortgage balance
            to see how a potential subject-to purchase could be
            structured. Cash paid at closing is capped at 7% of the
            property value. Any remaining equity may be carried by the
            seller as principal-only payments.
          </p>
        </div>

        {/* Explains what "subject-to" means before any numbers are shown,
            and is careful not to imply the lender formally transfers or
            approves the existing loan. */}
        <div className="mt-8 max-w-3xl border border-line bg-ink-2 p-6 md:p-8">
          <p className="eyebrow text-brass-light mb-3">What Subject-To Means</p>
          <p className="text-bone/85 leading-relaxed">
            A subject-to purchase means the buyer takes ownership of the
            property while taking responsibility for making the payments
            on the seller&apos;s existing mortgage. The existing loan
            generally remains in the seller&apos;s name and is not
            formally assumed by the buyer. Any seller equity that is not
            paid at closing may be carried separately by the seller under
            agreed written terms.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-bone/70">
            <li className="flex gap-3">
              <span className="mt-2 h-1 w-1 shrink-0 bg-brass" />
              <span>The buyer makes the existing mortgage payments.</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1 w-1 shrink-0 bg-brass" />
              <span>The existing mortgage balance remains part of the purchase structure.</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1 w-1 shrink-0 bg-brass" />
              <span>Cash paid to the seller at closing is capped at 7% of the property value.</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1 w-1 shrink-0 bg-brass" />
              <span>Any remaining seller equity is paid through principal-only monthly payments.</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1 w-1 shrink-0 bg-brass" />
              <span>
                Each transaction is subject to title review, loan documents, lender rights,
                written agreements, and professional advice.
              </span>
            </li>
          </ul>
        </div>

        <div className="mt-10 bg-paper text-ink p-7 sm:p-10 md:p-12">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
            {/* Property value */}
            <div>
              <label htmlFor="propertyValue" className="eyebrow text-ink/50 block mb-3">
                Estimated Property Value
              </label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/50 font-display text-xl"
                  aria-hidden="true"
                >
                  $
                </span>
                <input
                  id="propertyValue"
                  type="text"
                  inputMode="numeric"
                  value={propertyValueInput}
                  onChange={handleValueText}
                  onBlur={handleValueBlur}
                  placeholder="$300,000"
                  aria-label="Estimated Property Value in dollars"
                  aria-invalid={belowMinValue}
                  className="w-full bg-white border border-line-dark pl-9 pr-4 py-4 text-ink font-display text-2xl outline-none focus:border-brass"
                />
              </div>
              {belowMinValue && (
                <p className="mt-2 text-sm text-red-700">
                  The minimum property value is {formatWhole(VALUE_MIN)}.
                </p>
              )}
              <div className="mt-6">
                <input
                  type="range"
                  min={VALUE_MIN}
                  max={VALUE_MAX}
                  step={VALUE_STEP}
                  value={valueSliderPosition}
                  onChange={handleValueSlider}
                  aria-label="Estimated property value slider"
                  className="w-full accent-brass cursor-pointer"
                />
                <div className="mt-2 flex justify-between text-xs text-ink/50 font-mono">
                  <span>{formatWhole(VALUE_MIN)}</span>
                  <span>{formatWhole(VALUE_MAX)}</span>
                </div>
              </div>
            </div>

            {/* Mortgage balance */}
            <div>
              <label htmlFor="mortgageBalance" className="eyebrow text-ink/50 block mb-3">
                Current Mortgage Balance
              </label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/50 font-display text-xl"
                  aria-hidden="true"
                >
                  $
                </span>
                <input
                  id="mortgageBalance"
                  type="text"
                  inputMode="numeric"
                  value={mortgageInput}
                  onChange={handleMortgageText}
                  onBlur={handleMortgageBlur}
                  placeholder="$240,000"
                  aria-label="Current Mortgage Balance in dollars"
                  aria-invalid={mortgageExceedsValue}
                  className="w-full bg-white border border-line-dark pl-9 pr-4 py-4 text-ink font-display text-2xl outline-none focus:border-brass"
                />
              </div>
              {mortgageExceedsValue && (
                <p className="mt-2 text-sm text-red-700">
                  The mortgage balance cannot exceed the estimated property
                  value. It will be capped at {formatWhole(propertyValue)}.
                </p>
              )}
              <div className="mt-6">
                <input
                  type="range"
                  min={MORTGAGE_MIN}
                  max={mortgageSliderMax}
                  step={MORTGAGE_STEP}
                  value={mortgageSliderPosition}
                  onChange={handleMortgageSlider}
                  aria-label="Current mortgage balance slider"
                  className="w-full accent-brass cursor-pointer"
                />
                <div className="mt-2 flex justify-between text-xs text-ink/50 font-mono">
                  <span>{formatWhole(MORTGAGE_MIN)}</span>
                  <span>{formatWhole(mortgageSliderMax)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Transaction breakdown */}
          <div className="mt-10 pt-8 border-t border-line-dark">
            <p className="eyebrow text-ink/50 mb-4">Transaction Breakdown</p>
            <div className="flex h-8 w-full overflow-hidden border border-line-dark">
              <div
                className="h-full bg-slate"
                style={{ width: `${mortgagePct}%` }}
                title="Existing mortgage purchased subject to"
              />
              <div
                className="h-full bg-brass"
                style={{ width: `${cashPct}%` }}
                title="Cash paid at closing"
              />
              <div
                className="h-full bg-ink"
                style={{ width: `${carryPct}%` }}
                title="Seller-carried balance"
              />
            </div>
            <div className="mt-4 grid sm:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 bg-slate" aria-hidden="true" />
                <span className="text-ink/70">
                  Subject To: {formatWhole(mortgageBalance)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 bg-brass" aria-hidden="true" />
                <span className="text-ink/70">
                  Cash at Closing: {formatWhole(cashAtClosing)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 bg-ink" aria-hidden="true" />
                <span className="text-ink/70">
                  Seller Carry: {formatWhole(sellerCarriedBalance)}
                </span>
              </div>
            </div>
          </div>

          {/* Results: principal-only, no interest figures anywhere. */}
          <div className="mt-10 pt-8 border-t border-line-dark grid sm:grid-cols-2 gap-4">
            <div className="border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">Estimated Property Value</p>
              <p className="font-display text-2xl">{formatWhole(propertyValue)}</p>
            </div>

            <div className="border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">Existing Mortgage Balance</p>
              <p className="font-display text-2xl">{formatWhole(mortgageBalance)}</p>
            </div>

            <div className="border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">Estimated Seller Equity</p>
              <p className="font-display text-2xl">{formatWhole(sellerEquity)}</p>
            </div>

            <div className="border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">
                Estimated Cash to Seller at Closing
              </p>
              <p className="font-display text-2xl">{formatWhole(cashAtClosing)}</p>
              <p className="mt-2 text-ink/50 text-xs leading-relaxed">
                Cash paid at closing is capped at 7% of the property value
                and cannot exceed the seller&apos;s available equity.
              </p>
            </div>

            <div className="sm:col-span-2 border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">
                Remaining Equity Carried by Seller
              </p>
              <p className="font-display text-2xl">{formatWhole(sellerCarriedBalance)}</p>
            </div>

            {/* Monthly principal-only payment: headline figure. */}
            <div className="sm:col-span-2 border border-line-dark bg-ink text-bone p-7 md:p-8">
              <p className="eyebrow text-brass-light mb-1.5">
                Estimated Monthly Principal-Only Payment
              </p>
              {hasSellerCarry ? (
                <p className="font-display text-4xl md:text-5xl text-brass-light leading-none">
                  {formatCents(schedule.monthlyPayment)}
                </p>
              ) : (
                <p className="text-slate text-base leading-relaxed max-w-md">
                  No seller-carried balance is estimated under this
                  scenario, so there is no monthly seller-carry payment.
                </p>
              )}
            </div>

            <div className="sm:col-span-2 border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">
                Total of 360 Principal-Only Payments
              </p>
              <p className="font-display text-2xl">{formatWhole(schedule.totalPrincipal)}</p>
            </div>

            {/* Total received: second headline figure. */}
            <div className="sm:col-span-2 border border-line-dark bg-ink text-bone p-6">
              <p className="eyebrow text-brass-light mb-1.5">
                Total Received From Cash and Seller-Carry Payments
              </p>
              <p className="font-display text-3xl text-brass-light">
                {formatWhole(totalReceived)}
              </p>
              <p className="mt-2 text-slate text-xs leading-relaxed max-w-lg">
                The total shown includes the seller&apos;s estimated cash
                at closing and principal-only payments on the remaining
                equity. It does not include payments made by the buyer
                directly to the existing mortgage lender.
              </p>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-line-dark">
            <p className="eyebrow text-ink/50 mb-3">Assumed Structure</p>
            <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm text-ink/70">
              <li>Existing mortgage purchased subject to</li>
              <li>Cash paid at closing capped at 7% of property value</li>
              <li>Remaining equity carried by the seller</li>
              <li>Principal-only monthly payments on the carried balance</li>
              <li>30-year repayment term</li>
              <li>360 monthly payments</li>
              <li>No balloon payment assumed</li>
            </ul>
          </div>

          {/* Principal-only payment schedule. */}
          <div className="mt-10 pt-8 border-t border-line-dark">
            {hasSellerCarry ? (
              <>
                <button
                  type="button"
                  onClick={() => setScheduleOpen((v) => !v)}
                  aria-expanded={scheduleOpen}
                  className="inline-flex items-center gap-2 border border-line-dark px-5 py-2.5 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                >
                  {scheduleOpen ? "Hide" : "View"} Estimated Principal-Only
                  Payment Schedule
                </button>

                {scheduleOpen && (
                  <div className="mt-6">
                    <p className="text-ink/60 text-sm leading-relaxed max-w-2xl">
                      Annual summary of the estimated 360-payment
                      principal-only schedule. There is no interest in
                      this calculator, so each payment reduces the
                      seller-carried balance by an equal amount until it
                      reaches $0.
                    </p>

                    <div className="mt-4 overflow-x-auto border border-line-dark">
                      <table className="w-full min-w-[480px] text-sm">
                        <thead>
                          <tr className="bg-paper-2 text-left">
                            <th className="p-3 eyebrow text-ink/50 font-normal">Year</th>
                            <th className="p-3 eyebrow text-ink/50 font-normal">
                              Beginning Balance
                            </th>
                            <th className="p-3 eyebrow text-ink/50 font-normal">
                              Principal Paid
                            </th>
                            <th className="p-3 eyebrow text-ink/50 font-normal">
                              Ending Balance
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {annualSummary.map((row) => (
                            <tr key={row.year} className="border-t border-line-dark">
                              <td className="p-3 text-ink/80">{row.year}</td>
                              <td className="p-3 text-ink/80">
                                {formatWhole(row.beginningBalance)}
                              </td>
                              <td className="p-3 text-ink/80">
                                {formatWhole(row.principal)}
                              </td>
                              <td className="p-3 text-ink/80">
                                {formatWhole(row.endingBalance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <button
                      type="button"
                      onClick={() => downloadCsv(schedule.rows, propertyValue)}
                      className="mt-5 inline-flex items-center gap-2 border border-line-dark px-5 py-2.5 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                    >
                      Download Full 360-Payment Schedule (CSV)
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-ink/60 text-sm leading-relaxed">
                No seller-carried balance is estimated under this
                scenario.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={scrollToForm}
            className="mt-10 inline-flex w-full sm:w-fit justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
          >
            Discuss Your Property
          </button>
        </div>

        <p className="mt-8 max-w-3xl text-slate/70 leading-relaxed text-xs">
          This calculator is provided for illustrative and educational
          purposes only. It assumes the purchase price equals the
          estimated property value, the buyer takes ownership subject to
          the existing mortgage, cash paid to the seller at closing is
          capped at 7% of the property value, and any remaining seller
          equity is repaid through principal-only payments over 30 years.
          The existing loan generally remains in the seller&apos;s name,
          and subject-to transactions may involve a due-on-sale clause.
          Actual terms depend on the property, loan documents, lender
          rights, title review, taxes, insurance, servicing, closing
          costs, negotiation, written agreements, and professional legal
          and tax advice. This calculator does not constitute an offer or
          guarantee.
        </p>
      </div>
    </section>
  );
}
