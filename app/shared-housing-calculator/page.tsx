import type { Metadata } from "next";
import SharedHousingCalculator from "@/components/underwriting/SharedHousingCalculator";

export const metadata: Metadata = {
  title: "Shared Housing Calculator | Michael Aylett",
  description:
    "Estimate shared-housing rental income, operating expenses, total capital required, monthly cash flow, and cash-on-cash return with this interactive property underwriting calculator.",
};

export default function SharedHousingCalculatorPage() {
  return (
    <>
      <section className="relative overflow-hidden bg-ink bg-noise pt-32 pb-16 md:pt-40 md:pb-20">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(237,231,218,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(237,231,218,0.6) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        <div className="relative mx-auto max-w-content px-6 md:px-10">
          <div className="max-w-2xl">
            <p className="eyebrow text-brass-light mb-6">Underwriting Calculator</p>
            <h1 className="font-display text-bone leading-[1.05] text-[2.4rem] sm:text-5xl md:text-6xl">
              Shared Housing Calculator
            </h1>
            <p className="mt-8 text-slate text-base md:text-lg leading-relaxed">
              Estimate the monthly cash flow, total capital required, and
              projected cash-on-cash return for a shared-housing
              property.
            </p>
          </div>
        </div>
      </section>

      <SharedHousingCalculator />
    </>
  );
}
