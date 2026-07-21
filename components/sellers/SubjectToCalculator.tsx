"use client";

/**
 * Illustrative subject-to and seller carry calculator for the Sellers
 * page. Models a hypothetical purchase structured as:
 *
 *   - The existing mortgage is purchased subject to its current terms.
 *   - Cash paid to the seller at closing is capped at the lesser of the
 *     seller's available equity or 7% of the property value.
 *   - Any equity above that cash cap becomes a seller-carried balance,
 *     financed at a hypothetical 2% annual rate over a 30-year, 360
 *     payment, principal-and-interest amortization schedule with no
 *     balloon payment.
 *
 * Like the Seller Financing Payment Calculator, the seller-carry payment
 * is built from a true month-by-month amortization schedule (interest on
 * the declining balance, not a flat estimate), so principal grows and
 * interest shrinks over the 360 payments and the schedule always lands
 * on an exact $0.00 ending balance.
 *
 * Illustrative and educational only. Not an offer, guarantee, or
 * substitute for underwriting, title review, lender consent, or legal
 * and tax advice; the disclaimer below says so explicitly. Nothing here
 * is submitted anywhere, it is all computed client-side.
 */

import { useMemo, useState } from "react";

const MAX_CASH_RATE = 0.07; // cash at closing capped at 7% of property value
const ANNUAL_INTEREST_RATE = 0.02; // 2% fixed annual interest on seller carry
const AMORTIZATION_YEARS = 30;
const NUM_PAYMENTS = AMORTIZATION_YEARS * 12; // 360 monthly payments
const MONTHLY_RATE = ANNUAL_INTEREST_RATE / 12;

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

type AmortizationRow = {
  payment: number;
  beginningBalance: number;
  principal: number;
  interest: number;
  totalPayment: number;
  endingBalance: number;
};

type Schedule = {
  monthlyPayment: number;
  rows: AmortizationRow[];
  totalPrincipal: number;
  totalInterest: number;
  totalPayments: number;
};

/** True, fully amortizing month-by-month schedule: interest each month is
 * charged on the remaining unpaid balance (declining balance, not flat
 * interest), principal and interest are equal for every payment except
 * the last, and the final payment is adjusted so the schedule always
 * lands on exactly $0.00. */
function buildAmortizationSchedule(principal: number): Schedule {
  if (principal <= 0) {
    return { monthlyPayment: 0, rows: [], totalPrincipal: 0, totalInterest: 0, totalPayments: 0 };
  }

  const r = MONTHLY_RATE;
  const n = NUM_PAYMENTS;
  const rawPayment =
    (principal * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
  const monthlyPayment = round2(rawPayment);

  const rows: AmortizationRow[] = [];
  let balance = principal;
  let totalPrincipal = 0;
  let totalInterest = 0;
  let totalPayments = 0;

  for (let i = 1; i <= n; i++) {
    const beginningBalance = balance;
    const interest = round2(beginningBalance * r);
    let principalPaid: number;
    let totalPaymentThisRow: number;

    if (i < n) {
      totalPaymentThisRow = monthlyPayment;
      principalPaid = round2(totalPaymentThisRow - interest);
    } else {
      principalPaid = beginningBalance;
      totalPaymentThisRow = round2(principalPaid + interest);
    }

    const endingBalance = round2(beginningBalance - principalPaid);

    rows.push({
      payment: i,
      beginningBalance,
      principal: principalPaid,
      interest,
      totalPayment: totalPaymentThisRow,
      endingBalance,
    });

    totalPrincipal = round2(totalPrincipal + principalPaid);
    totalInterest = round2(totalInterest + interest);
    totalPayments = round2(totalPayments + totalPaymentThisRow);
    balance = endingBalance;
  }

  return { monthlyPayment, rows, totalPrincipal, totalInterest, totalPayments };
}

type AnnualSummaryRow = {
  year: number;
  beginningBalance: number;
  principal: number;
  interest: number;
  endingBalance: number;
};

function buildAnnualSummary(rows: AmortizationRow[]): AnnualSummaryRow[] {
  const years: AnnualSummaryRow[] = [];
  for (let y = 0; y < AMORTIZATION_YEARS; y++) {
    const yearRows = rows.slice(y * 12, y * 12 + 12);
    if (yearRows.length === 0) continue;
    const principal = round2(yearRows.reduce((sum, r) => sum + r.principal, 0));
    const interest = round2(yearRows.reduce((sum, r) => sum + r.interest, 0));
    years.push({
      year: y + 1,
      beginningBalance: yearRows[0].beginningBalance,
      principal,
      interest,
      endingBalance: yearRows[yearRows.length - 1].endingBalance,
    });
  }
  return years;
}

function downloadCsv(rows: AmortizationRow[], propertyValue: number) {
  const header = [
    "Payment Number",
    "Beginning Balance",
    "Principal",
    "Interest",
    "Total Payment",
    "Ending Balance",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.payment,
        row.beginningBalance.toFixed(2),
        row.principal.toFixed(2),
        row.interest.toFixed(2),
        row.totalPayment.toFixed(2),
        row.endingBalance.toFixed(2),
      ].join(",")
    );
  }
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `subject-to-seller-carry-schedule-${Math.round(propertyValue)}.csv`;
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
    // Enforce $0 minimum and clamp to the property value on blur, since
    // the mortgage balance being acquired can never exceed what the
    // property is estimated to be worth.
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
    () => buildAmortizationSchedule(sellerCarriedBalance),
    [sellerCarriedBalance]
  );
  const annualSummary = useMemo(() => buildAnnualSummary(schedule.rows), [schedule.rows]);

  const totalReceived = useMemo(
    () => round2(cashAtClosing + schedule.totalPayments),
    [cashAtClosing, schedule.totalPayments]
  );

  const hasSellerCarry = sellerCarriedBalance > 0;

  const scrollToForm = () => {
    document
      .getElementById("contact-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Stacked bar segment widths, as a percentage of the property value, so
  // the three components of the transaction are visible at a glance.
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
            property value. Any remaining equity may be financed by the
            seller.
          </p>
        </div>

        <div className="mt-12 bg-paper text-ink p-7 sm:p-10 md:p-12">
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

          {/* Transaction breakdown: stacked bar showing the three
              components of the structure relative to the property value,
              plus a legend with exact amounts. */}
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

          {/* Results */}
          <div className="mt-10 pt-8 border-t border-line-dark grid sm:grid-cols-2 gap-4">
            <div className="border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">Estimated Property Value</p>
              <p className="font-display text-2xl">{formatWhole(propertyValue)}</p>
            </div>

            <div className="border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">
                Existing Mortgage Purchased Subject To
              </p>
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
                Remaining Equity Financed by Seller
              </p>
              <p className="font-display text-2xl">{formatWhole(sellerCarriedBalance)}</p>
            </div>

            {/* Monthly seller-carry payment: headline figure, largest
                type, brass on dark, full width for prominence. */}
            <div className="sm:col-span-2 border border-line-dark bg-ink text-bone p-7 md:p-8">
              <p className="eyebrow text-brass-light mb-1.5">
                Estimated Monthly Principal and Interest Payment to Seller
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

            <div className="border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">
                Total of 360 Seller-Carry Payments
              </p>
              <p className="font-display text-2xl">{formatWhole(schedule.totalPayments)}</p>
            </div>

            <div className="border border-line-dark bg-paper-2 p-6">
              <p className="eyebrow text-ink/50 mb-1.5">
                Estimated Interest Received on Seller-Carried Balance
              </p>
              <p className="font-display text-2xl">{formatWhole(schedule.totalInterest)}</p>
            </div>

            {/* Total received: second headline figure, matching
                prominence treatment. */}
            <div className="sm:col-span-2 border border-line-dark bg-ink text-bone p-6">
              <p className="eyebrow text-brass-light mb-1.5">
                Total Received by Seller From Cash and Seller-Carry
                Payments
              </p>
              <p className="font-display text-3xl text-brass-light">
                {formatWhole(totalReceived)}
              </p>
              <p className="mt-2 text-slate text-xs leading-relaxed max-w-lg">
                This figure does not include mortgage payments made
                directly to the existing lender under the subject-to
                arrangement.
              </p>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-line-dark">
            <p className="eyebrow text-ink/50 mb-3">Assumed Structure</p>
            <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm text-ink/70">
              <li>Existing mortgage purchased subject to</li>
              <li>Cash paid at closing capped at 7% of property value</li>
              <li>Remaining equity seller financed</li>
              <li>2% fixed interest rate on seller-carried balance</li>
              <li>30-year amortization</li>
              <li>360 monthly payments</li>
              <li>No balloon payment assumed</li>
            </ul>
          </div>

          {/* Amortization schedule for the seller-carried balance, only
              relevant when a seller-carried balance actually exists. */}
          <div className="mt-10 pt-8 border-t border-line-dark">
            {hasSellerCarry ? (
              <>
                <button
                  type="button"
                  onClick={() => setScheduleOpen((v) => !v)}
                  aria-expanded={scheduleOpen}
                  className="inline-flex items-center gap-2 border border-line-dark px-5 py-2.5 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                >
                  {scheduleOpen ? "Hide" : "View"} Estimated Seller-Carry
                  Amortization Schedule
                </button>

                {scheduleOpen && (
                  <div className="mt-6">
                    <p className="text-ink/60 text-sm leading-relaxed max-w-2xl">
                      Annual summary of the estimated 360-payment
                      seller-carry schedule. Principal grows and interest
                      shrinks each year as the balance declines,
                      consistent with a standard fixed-rate amortizing
                      loan.
                    </p>

                    <div className="mt-4 overflow-x-auto border border-line-dark">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead>
                          <tr className="bg-paper-2 text-left">
                            <th className="p-3 eyebrow text-ink/50 font-normal">Year</th>
                            <th className="p-3 eyebrow text-ink/50 font-normal">
                              Beginning Balance
                            </th>
                            <th className="p-3 eyebrow text-ink/50 font-normal">
                              Principal
                            </th>
                            <th className="p-3 eyebrow text-ink/50 font-normal">
                              Interest
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
                                {formatWhole(row.interest)}
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
          estimated property value, the existing mortgage is purchased
          subject to its current financing, cash paid to the seller at
          closing is capped at 7% of the property value, and any
          remaining equity is seller financed at 2% interest over 30
          years. Actual transaction terms depend on the property,
          existing loan documents, lender rights, title review, taxes,
          insurance, servicing, closing costs, negotiation, written
          agreements, and professional legal and tax advice. Subject-to
          transactions may involve a due-on-sale clause. This calculator
          does not constitute an offer or guarantee.
        </p>
      </div>
    </section>
  );
}
