import type { Metadata } from "next";
import Link from "next/link";
import SellerCalculatorSelector from "@/components/sellers/SellerCalculatorSelector";

export const metadata: Metadata = {
  title: "Seller Financing & Subject-To Calculators | Michael Aylett",
  description:
    "Estimate seller financing and subject-to payments using free interactive calculators. Explore hypothetical creative financing scenarios for your property.",
};

export default function SellerCalculatorsPage() {
  return (
    <>
      {/* Simple, focused intro: no property imagery or long educational
          content here, that lives on the Sellers page. This page exists
          to get a visitor straight to the calculators. */}
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
            <p className="eyebrow text-brass-light mb-6">Seller Calculators</p>
            <h1 className="font-display text-bone leading-[1.05] text-[2.4rem] sm:text-5xl md:text-6xl">
              Seller Calculators
            </h1>
            <p className="mt-8 text-slate text-base md:text-lg leading-relaxed">
              Estimate how different creative financing structures could
              work for your property.
            </p>
            <p className="mt-6 text-slate/90 leading-relaxed max-w-xl">
              Whether your property is free and clear or still has an
              existing mortgage, these calculators provide illustrative
              examples of how a creative finance purchase could be
              structured. They are educational tools only and are
              designed to help you better understand common seller
              financing and subject-to scenarios before reaching out to
              discuss your property.
            </p>
          </div>
        </div>
      </section>

      <SellerCalculatorSelector />

      {/* Simple closing CTA, this page stays focused on the calculators
          rather than repeating the Sellers page's fuller pitch. */}
      <section className="bg-paper text-ink py-24 md:py-28 border-t border-line-dark">
        <div className="mx-auto max-w-content px-6 md:px-10 text-center">
          <div className="mx-auto max-w-xl">
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              Ready to Discuss Your Property?
            </h2>
            <p className="mt-5 text-ink/70 leading-relaxed">
              If you&apos;d like to explore whether a creative financing
              solution could work for your property, I&apos;d be happy to
              review your situation and discuss potential options.
            </p>
            <Link
              href="/sellers#contact-form"
              className="mt-8 inline-flex items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
            >
              Discuss Your Property
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
