import Link from "next/link";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-ink bg-noise pt-32 pb-20 md:pt-44 md:pb-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(237,231,218,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(237,231,218,0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-6">
          Real Estate Acquisitions · Capital Partnerships
        </p>

        <h1 className="font-display text-bone leading-[1.05] text-[2.5rem] sm:text-6xl md:text-7xl max-w-3xl">
          Flexible ways to sell,{" "}
          <em className="text-brass-light not-italic font-medium">
            professionally managed housing
          </em>{" "}
          on the other side.
        </h1>

        <p className="mt-8 max-w-xl text-slate text-base md:text-lg leading-relaxed">
          I&apos;m Michael Aylett. I buy property directly from owners —
          through traditional purchases and creative financing structures —
          and turn select acquisitions into well-run, professionally managed
          shared housing. I also partner with qualified capital investors and
          founded EcomRanx, an Amazon consulting company.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row flex-wrap gap-4">
          <Link
            href="/sellers"
            className="inline-flex justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
          >
            Sell Your Property
          </Link>
          <Link
            href="/capital-partners"
            className="inline-flex justify-center items-center border border-line px-7 py-3.5 text-bone hover:border-brass/60 transition-colors"
          >
            Capital Partnerships
          </Link>
          <Link
            href="/ecomranx"
            className="inline-flex justify-center items-center border border-line px-7 py-3.5 text-bone hover:border-brass/60 transition-colors"
          >
            Amazon Consulting
          </Link>
        </div>
      </div>
    </section>
  );
}
