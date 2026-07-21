"use client";

/**
 * Illustrative seller financing payment calculator for the Sellers page.
 *
 * Models a hypothetical purchase of the seller's property with:
 *   - 7% down payment at closing
 *   - 93% seller-financed balance
 *   - 2% annual interest rate
 *   - 30-year amortization, 360 equal monthly principal and interest
 *     payments, no balloon payment
 *
 * Unlike a simple "balance x rate" estimate, this builds a real month by
 * month amortization schedule: interest each month is calculated on the
 * remaining unpaid principal balance, so principal grows and interest
 * shrinks over the 360 payments exactly like a real amortizing loan. The
 * final payment is nudged by a few cents if needed so the schedule always
 * lands on an exact $0.00 ending balance rather than drifting from
 * cumulative rounding.
 *
 * This is illustrative and educational only. It is not an offer, a
 * guarantee, or a substitute for actual underwriting, title review, or
 * legal and tax advice, and the disclaimer below the calculator says so
 * explicitly. Nothing here is submitted anywhere; it's all client-side.
 */

import { useMemo, useState } from "react";

const DOWN_PAYMENT_RATE = 0.07; // 7% down payment at closing
const FINANCED_RATE = 0.93; // 93% seller-financed balance
const ANNUAL_INTEREST_RATE = 0.02; // 2% annual interest rate
const AMORTIZATION_YEARS = 30;
const NUM_PAYMENTS = AMORTIZATION_YEARS * 12; // 360 monthly payments
const MONTHLY_RATE = ANNUAL_INTEREST_RATE / 12;

const MIN_PRICE = 100000;
const MAX_PRICE = 5000000;
const STEP = 10000;
const DEFAULT_PRICE = 300000;

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

/** Strips everything but digits from free-typed input so a visitor can
 * type "$300,000" or "300000" and still get a clean number out the other
 * end. Blank or unparsable input resolves to 0 rather than NaN. */
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

/**
 * Builds a true, fully amortizing month-by-month schedule for a fixed-rate
 * loan: interest each month is charged on the remaining unpaid balance
 * (declining balance, not flat/simple interest), principal and interest
 * are held equal for every payment except the last, and the final payment
 * is adjusted so the schedule always lands on exactly $0.00.
 */
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
      // Final payment: pay off whatever balance remains exactly, so the
      // schedule always ends at $0.00 rather than a few cents off from
      // accumulated rounding across 360 payments.
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

function downloadCsv(rows: AmortizationRow[], price: number) {
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
  a.download = `seller-financing-amortization-schedule-${Math.round(price)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function SellerFinancingCalculator() {
  const [price, setPrice] = useState(DEFAULT_PRICE);
  const [inputValue, setInputValue] = useState(formatWhole(DEFAULT_PRICE));
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const downPayment = useMemo(() => round2(price * DOWN_PAYMENT_RATE), [price]);
  const financedBalance = useMemo(() => round2(price * FINANCED_RATE), [price]);

  const schedule = useMemo(
    () => buildAmortizationSchedule(financedBalance),
    [financedBalance]
  );

  const annualSummary = useMemo(
    () => buildAnnualSummary(schedule.rows),
    [schedule.rows]
  );

  const totalReceived = useMemo(
    () => round2(downPayment + schedule.totalPayments),
    [downPayment, schedule.totalPayments]
  );

  const commitPrice = (n: number) => {
    const clamped = Math.max(0, n);
    setPrice(clamped);
    setInputValue(formatWhole(clamped));
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setInputValue(raw);
    setPrice(parseTypedAmount(raw));
  };

  const handleTextBlur = () => {
    // Enforce the $100,000 minimum purchase price once the visitor
    // finishes typing, so the schedule never runs on an amount too small
    // to be a realistic purchase price.
    const clamped = Math.max(MIN_PRICE, price);
    setPrice(clamped);
    setInputValue(formatWhole(clamped));
  };

  const belowMinimum = price > 0 && price < MIN_PRICE;

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    commitPrice(Number.isFinite(n) ? n : 0);
  };

  const scrollToForm = () => {
    document
      .getElementById("contact-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sliderValue = Math.min(MAX_PRICE, Math.max(MIN_PRICE, price));

  return (
    <section className="bg-ink text-bone py-24 md:py-28 border-t border-line">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="max-w-2xl">
          <p className="eyebrow text-brass-light mb-4">Payment Calculator</p>
          <h2 className="font-display text-3xl md:text-4xl leading-tight">
            Seller Financing Payment Calculator
          </h2>
          <p className="mt-5 text-slate leading-relaxed">
            Enter a potential purchase price to estimate the down payment
            and monthly principal and interest payments you could receive
            under a hypothetical seller-financing structure.
          </p>
        </div>

        <div className="mt-12 bg-paper text-ink p-7 sm:p-10 md:p-12">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-10 lg:gap-16 items-start">
            {/* Input side */}
            <div>
              <label htmlFor="purchasePrice" className="eyebrow text-ink/50 block mb-3">
                Potential Purchase Price
              </label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/50 font-display text-xl"
                  aria-hidden="true"
                >
                  $
                </span>
                <input
                  id="purchasePrice"
                  type="text"
                  inputMode="numeric"
                  value={inputValue}
                  onChange={handleTextChange}
                  onBlur={handleTextBlur}
                  placeholder="$300,000"
                  aria-label="Potential Purchase Price in dollars"
                  aria-invalid={belowMinimum}
                  className="w-full bg-white border border-line-dark pl-9 pr-4 py-4 text-ink font-display text-2xl outline-none focus:border-brass"
                />
              </div>
              {belowMinimum && (
                <p className="mt-2 text-sm text-red-700">
                  The minimum purchase price is {formatWhole(MIN_PRICE)}.
                </p>
              )}

              <div className="mt-6">
                <input
                  type="range"
                  min={MIN_PRICE}
                  max={MAX_PRICE}
                  step={STEP}
                  value={sliderValue}
                  onChange={handleSlider}
                  aria-label="Potential purchase price slider"
                  className="w-full accent-brass cursor-pointer"
                />
                <div className="mt-2 flex justify-between text-xs text-ink/50 font-mono">
                  <span>{formatWhole(MIN_PRICE)}</span>
                  <span>{formatWhole(MAX_PRICE)}</span>
                </div>
              </div>

              <p className="mt-6 text-ink/50 text-xs leading-relaxed">
                Type any amount, or use the slider between{" "}
                {formatWhole(MIN_PRICE)} and {formatWhole(MAX_PRICE)}.
              </p>

              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Assumed Terms</p>
                <ul className="space-y-1.5 text-sm text-ink/70">
                  <li>7% down payment</li>
                  <li>2% annual interest rate</li>
                  <li>30-year amortization</li>
                  <li>360 monthly payments</li>
                  <li>No balloon payment assumed</li>
                </ul>
              </div>
            </div>

            {/* Results side */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="border border-line-dark bg-paper-2 p-6">
                <p className="eyebrow text-ink/50 mb-1.5">
                  Potential Purchase Price
                </p>
                <p className="font-display text-2xl">{formatWhole(price)}</p>
              </div>

              <div className="border border-line-dark bg-paper-2 p-6">
                <p className="eyebrow text-ink/50 mb-1.5">
                  7% Down Payment at Closing
                </p>
                <p className="font-display text-2xl">{formatWhole(downPayment)}</p>
              </div>

              <div className="border border-line-dark bg-paper-2 p-6">
                <p className="eyebrow text-ink/50 mb-1.5">
                  Amount Financed by Seller
                </p>
                <p className="font-display text-2xl">{formatWhole(financedBalance)}</p>
              </div>

              <div className="border border-line-dark bg-paper-2 p-6">
                <p className="eyebrow text-ink/50 mb-1.5">
                  Estimated Interest Received Over 30 Years
                </p>
                <p className="font-display text-2xl">
                  {formatWhole(schedule.totalInterest)}
                </p>
              </div>

              {/* Monthly payment: the headline figure, largest type,
                  brass color, full width for maximum prominence. */}
              <div className="sm:col-span-2 border border-line-dark bg-ink text-bone p-7 md:p-8">
                <p className="eyebrow text-brass-light mb-1.5">
                  Estimated Monthly Principal and Interest Payment
                </p>
                <p className="font-display text-4xl md:text-5xl text-brass-light leading-none">
                  {formatCents(schedule.monthlyPayment)}
                </p>
              </div>

              <div className="border border-line-dark bg-paper-2 p-6">
                <p className="eyebrow text-ink/50 mb-1.5">
                  Total of 360 Monthly Payments
                </p>
                <p className="font-display text-2xl">
                  {formatWhole(schedule.totalPayments)}
                </p>
              </div>

              {/* Total received: the other headline figure, matching
                  prominence treatment to the monthly payment above. */}
              <div className="border border-line-dark bg-ink text-bone p-6">
                <p className="eyebrow text-brass-light mb-1.5">
                  Total Received Including Down Payment
                </p>
                <p className="font-display text-2xl text-brass-light">
                  {formatWhole(totalReceived)}
                </p>
              </div>
            </div>
          </div>

          {/* Amortization schedule: collapsed by default, expands to an
              annual summary (not all 360 rows), with a CSV download for
              the full month-by-month detail. */}
          <div className="mt-10 pt-8 border-t border-line-dark">
            <button
              type="button"
              onClick={() => setScheduleOpen((v) => !v)}
              aria-expanded={scheduleOpen}
              className="inline-flex items-center gap-2 border border-line-dark px-5 py-2.5 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
            >
              {scheduleOpen ? "Hide" : "View"} Estimated Amortization Schedule
            </button>

            {scheduleOpen && (
              <div className="mt-6">
                <p className="text-ink/60 text-sm leading-relaxed max-w-2xl">
                  Annual summary of the estimated 360-payment schedule.
                  Principal grows and interest shrinks each year as the
                  balance declines, consistent with a standard fixed-rate
                  amortizing loan.
                </p>

                <div className="mt-4 overflow-x-auto border border-line-dark">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="bg-paper-2 text-left">
                        <th className="p-3 eyebrow text-ink/50 font-normal">Year</th>
                        <th className="p-3 eyebrow text-ink/50 font-normal">
                          Beginning Balance
                        </th>
                        <th className="p-3 eyebrow text-ink/50 font-normal">Principal</th>
                        <th className="p-3 eyebrow text-ink/50 font-normal">Interest</th>
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
                          <td className="p-3 text-ink/80">{formatWhole(row.principal)}</td>
                          <td className="p-3 text-ink/80">{formatWhole(row.interest)}</td>
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
                  onClick={() => downloadCsv(schedule.rows, price)}
                  className="mt-5 inline-flex items-center gap-2 border border-line-dark px-5 py-2.5 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                >
                  Download Full 360-Payment Schedule (CSV)
                </button>
              </div>
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
          purposes only. It assumes a 7% down payment, a 2% annual
          interest rate, and payments amortized over 30 years with no
          balloon payment. The estimate includes principal and interest
          only and does not include taxes, insurance, servicing fees, late
          charges, closing costs, or other transaction expenses. Actual
          purchase terms are subject to property review, existing
          financing, title review, negotiation, written agreements, and
          professional legal and tax advice. The calculator does not
          constitute an offer or guarantee.
        </p>
      </div>
    </section>
  );
}
