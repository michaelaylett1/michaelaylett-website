"use client";

/**
 * Gates the two Sellers-page payment calculators behind a single
 * question, so a visitor only ever sees the one calculator that actually
 * applies to their property instead of both at once. Neither calculator
 * renders until an answer is chosen, and the answer can be changed at
 * any time (the two option cards stay visible and interactive above
 * whichever calculator is currently shown) without a page reload.
 */

import { useState } from "react";
import SubjectToCalculator from "@/components/sellers/SubjectToCalculator";
import SellerFinancingCalculator from "@/components/sellers/SellerFinancingCalculator";

type MortgageChoice = "has-mortgage" | "free-and-clear" | null;

export default function SellerCalculatorSelector() {
  const [choice, setChoice] = useState<MortgageChoice>(null);

  const cardClasses = (active: boolean) =>
    [
      "text-left border p-6 md:p-7 transition-colors",
      active
        ? "border-brass bg-ink-2"
        : "border-line bg-transparent hover:border-brass/60",
    ].join(" ");

  return (
    <>
      <section className="bg-ink text-bone py-24 md:py-28 border-t border-line">
        <div className="mx-auto max-w-content px-6 md:px-10">
          <div className="max-w-2xl">
            <p className="eyebrow text-brass-light mb-4">Payment Illustrations</p>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              Which financing situation applies to your property?
            </h2>
            <p className="mt-5 text-slate leading-relaxed">
              Select whether the property currently has a mortgage so we
              can show the most relevant payment illustration.
            </p>
          </div>

          <p className="mt-10 eyebrow text-bone/60">
            Does the property currently have a mortgage?
          </p>

          <div className="mt-4 grid sm:grid-cols-2 gap-5 max-w-3xl" role="group" aria-label="Does the property currently have a mortgage?">
            <button
              type="button"
              onClick={() => setChoice("has-mortgage")}
              aria-pressed={choice === "has-mortgage"}
              className={cardClasses(choice === "has-mortgage")}
            >
              <span className="eyebrow text-brass-light mb-2 block">Option A</span>
              <span className="font-display text-xl leading-snug block">
                Yes, the property has a mortgage
              </span>
              <span className="mt-3 block text-sm text-slate">
                See the Subject-To and Seller Carry Calculator.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setChoice("free-and-clear")}
              aria-pressed={choice === "free-and-clear"}
              className={cardClasses(choice === "free-and-clear")}
            >
              <span className="eyebrow text-brass-light mb-2 block">Option B</span>
              <span className="font-display text-xl leading-snug block">
                No, the property is owned free and clear
              </span>
              <span className="mt-3 block text-sm text-slate">
                See the Seller Financing Payment Calculator.
              </span>
            </button>
          </div>

          {choice && (
            <p className="mt-6 text-sm text-slate">
              You can change this selection at any time.
            </p>
          )}
        </div>
      </section>

      {choice === "has-mortgage" && <SubjectToCalculator />}
      {choice === "free-and-clear" && <SellerFinancingCalculator />}
    </>
  );
}
