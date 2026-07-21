"use client";

/**
 * Illustrative capital partner cash flow calculator for the Capital
 * Partners page.
 *
 * Purely a client-side estimate of the return TO THE CAPITAL PARTNER on
 * their own invested capital: Investment Amount x 10% assumed annual
 * cash-on-cash return, divided by 12 for a monthly figure. Every label
 * here is worded to make clear this is the capital partner's estimated
 * return on their own investment, not the property's total cash-on-cash
 * return or the overall project's return. This is not an offer,
 * projection, or guarantee of any actual investment's performance, and
 * the disclaimer below the calculator says so explicitly. No values here
 * are ever submitted anywhere; nothing here talks to the server.
 */

import { useMemo, useState } from "react";

const ASSUMED_RATE = 0.1; // 10% annual cash-on-cash, illustrative only
const MIN_AMOUNT = 100000;
const MAX_AMOUNT = 1000000;
const STEP = 5000;
const DEFAULT_AMOUNT = 100000;

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

/** Strips everything but digits from free-typed input so a visitor can type
 * "$100,000" or "100000" or paste in stray characters and still get a
 * clean number out the other end. Blank or unparsable input resolves to 0
 * rather than throwing or showing NaN. */
function parseTypedAmount(raw: string): number {
  const digitsOnly = raw.replace(/[^0-9]/g, "");
  if (!digitsOnly) return 0;
  const n = Number(digitsOnly);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export default function CashFlowCalculator() {
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [inputValue, setInputValue] = useState(formatWhole(DEFAULT_AMOUNT));

  const { annual, monthly } = useMemo(() => {
    const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
    const annualCashFlow = safeAmount * ASSUMED_RATE;
    const monthlyCashFlow = Math.round((annualCashFlow / 12) * 100) / 100;
    return { annual: annualCashFlow, monthly: monthlyCashFlow };
  }, [amount]);

  const commitAmount = (n: number) => {
    const clamped = Math.max(0, n);
    setAmount(clamped);
    setInputValue(formatWhole(clamped));
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Keep whatever the visitor is typing visible as-is (so commas don't
    // fight them mid-keystroke), but always parse a clean, non-negative
    // number out of it for the live calculation.
    const raw = e.target.value;
    setInputValue(raw);
    setAmount(parseTypedAmount(raw));
  };

  const handleTextBlur = () => {
    // Once the visitor finishes typing, enforce the $100,000 minimum
    // capital partner investment: anything typed below it snaps up to
    // the minimum rather than silently calculating on an amount that
    // isn't actually a valid investment size.
    const clamped = Math.max(MIN_AMOUNT, amount);
    setAmount(clamped);
    setInputValue(formatWhole(clamped));
  };

  // Shown live, while the visitor is still typing a value below the
  // minimum, so they understand why it will snap up to $100,000 on blur
  // rather than that just happening silently.
  const belowMinimum = amount > 0 && amount < MIN_AMOUNT;

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    commitAmount(Number.isFinite(n) ? n : 0);
  };

  const scrollToForm = () => {
    document
      .getElementById("capital-partner-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sliderValue = Math.min(MAX_AMOUNT, Math.max(MIN_AMOUNT, amount));

  return (
    <section className="bg-ink text-bone py-24 md:py-28 border-t border-line">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="max-w-2xl">
          <p className="eyebrow text-brass-light mb-4">Cash Flow Calculator</p>
          <h2 className="font-display text-3xl md:text-4xl leading-tight">
            Capital Partner Cash Flow Calculator
          </h2>
          <p className="mt-5 text-slate leading-relaxed">
            Estimate the potential cash flow a capital partner could
            receive based on a 10% annual cash-on-cash return on their
            invested capital.
          </p>
        </div>

        <div className="mt-12 bg-paper text-ink p-7 sm:p-10 md:p-12">
          <div className="grid lg:grid-cols-[1fr_auto] gap-10 lg:gap-16 items-start">
            {/* Input side */}
            <div>
              <label htmlFor="investmentAmount" className="eyebrow text-ink/50 block mb-3">
                Capital Partner Investment Amount
              </label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/50 font-display text-xl"
                  aria-hidden="true"
                >
                  $
                </span>
                <input
                  id="investmentAmount"
                  type="text"
                  inputMode="numeric"
                  value={inputValue}
                  onChange={handleTextChange}
                  onBlur={handleTextBlur}
                  placeholder="$100,000"
                  aria-label="Capital Partner Investment Amount in dollars"
                  aria-invalid={belowMinimum}
                  className="w-full bg-white border border-line-dark pl-9 pr-4 py-4 text-ink font-display text-2xl outline-none focus:border-brass"
                />
              </div>
              {belowMinimum && (
                <p className="mt-2 text-sm text-red-700">
                  The minimum capital partner investment is{" "}
                  {formatWhole(MIN_AMOUNT)}.
                </p>
              )}

              <div className="mt-6">
                <input
                  type="range"
                  min={MIN_AMOUNT}
                  max={MAX_AMOUNT}
                  step={STEP}
                  value={sliderValue}
                  onChange={handleSlider}
                  aria-label="Capital partner investment amount slider"
                  className="w-full accent-brass cursor-pointer"
                />
                <div className="mt-2 flex justify-between text-xs text-ink/50 font-mono">
                  <span>{formatWhole(MIN_AMOUNT)}</span>
                  <span>{formatWhole(MAX_AMOUNT)}</span>
                </div>
              </div>

              <p className="mt-6 text-ink/50 text-xs leading-relaxed">
                Type any amount, or use the slider between{" "}
                {formatWhole(MIN_AMOUNT)} and {formatWhole(MAX_AMOUNT)}.
              </p>
            </div>

            {/* Results side */}
            <div className="w-full lg:w-80 border border-line-dark bg-paper-2 p-7 md:p-8">
              <div>
                <p className="eyebrow text-ink/50 mb-1.5">Capital Partner Investment</p>
                <p className="font-display text-2xl">{formatWhole(amount)}</p>
              </div>

              <div className="mt-6 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-1.5">
                  Estimated Annual Cash Flow to Capital Partner
                </p>
                <p className="font-display text-2xl">{formatWhole(annual)}</p>
              </div>

              {/* Monthly cash flow is the headline figure: largest type,
                  brass color, its own emphasized block. */}
              <div className="mt-6 pt-6 border-t border-line-dark">
                <p className="eyebrow text-brass mb-1.5">
                  Estimated Monthly Cash Flow to Capital Partner
                </p>
                <p className="font-display text-4xl md:text-5xl text-brass leading-none">
                  {formatCents(monthly)}
                </p>
              </div>

              <div className="mt-6 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-1.5">
                  Assumed Capital Partner Cash-on-Cash Return
                </p>
                <p className="text-ink/80">
                  10% annual cash-on-cash return to the capital partner
                </p>
              </div>
            </div>
          </div>

          {/* Clarifies exactly what the assumed 10% figure measures, so it
              can't be mistaken for the property's total cash-on-cash
              return or the overall project's return. */}
          <p className="mt-6 max-w-3xl text-ink/50 text-xs leading-relaxed">
            Cash-on-cash return is calculated using the capital
            partner&apos;s invested cash and the estimated cash
            distributions attributable to that investment.
          </p>

          <button
            type="button"
            onClick={scrollToForm}
            className="mt-10 inline-flex w-full sm:w-fit justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
          >
            Discuss a Capital Partnership
          </button>
        </div>

        <p className="mt-8 max-w-3xl text-slate/70 leading-relaxed text-xs">
          This calculator is provided for illustrative purposes only and
          estimates potential cash flow to a capital partner based on an
          assumed 10% annual cash-on-cash return on invested capital. It
          does not represent a guarantee, projection, offer, or promise of
          actual investment performance. Actual returns, distributions,
          timing, expenses, ownership structure, and risks may vary by
          transaction.
        </p>
      </div>
    </section>
  );
}
