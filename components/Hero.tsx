const STATS = [
  { value: "83", label: "Doors Owned" },
  { value: "$50K+", label: "Monthly Rental Revenue" },
  { value: "25%+", label: "COC Return, Flagship Property" },
  { value: "3", label: "States — TX / GA / UT" },
];

export default function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-ink bg-noise pt-32 pb-20 md:pt-44 md:pb-28"
    >
      {/* faint blueprint grid, evokes floor plans / underwriting sheets */}
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
          Salt Lake City, Utah — Co-Living Real Estate &amp; Amazon Growth
        </p>

        <h1 className="font-display text-bone leading-[1.03] text-[2.6rem] sm:text-6xl md:text-7xl max-w-3xl">
          I turn single-family homes into{" "}
          <em className="text-brass-light not-italic font-medium">income-producing rooms.</em>
        </h1>

        <p className="mt-8 max-w-xl text-slate text-base md:text-lg leading-relaxed">
          I&apos;m Michael Aylett — a co-living investor building a cash-flowing
          portfolio of PadSplit properties, and the founder of EcomRanx, an
          Amazon growth consultancy. I partner with capital investors on new
          acquisitions and help brands scale on Amazon.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <a
            href="#capital"
            className="inline-flex justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
          >
            Become a Capital Partner
          </a>
          <a
            href="#portfolio"
            className="inline-flex justify-center items-center border border-line px-7 py-3.5 text-bone hover:border-brass/60 transition-colors"
          >
            View the Portfolio
          </a>
        </div>

        <div className="mt-20 grid grid-cols-2 md:grid-cols-4 border-t border-line">
          {STATS.map((s) => (
            <div key={s.label} className="border-r border-line last:border-r-0 py-6 pr-6">
              <div className="font-display text-3xl md:text-4xl text-bone">{s.value}</div>
              <div className="eyebrow text-slate mt-2">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
