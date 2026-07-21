const STATS = [
  { value: "91", label: "Doors Owned" },
  { value: "3+", label: "Markets" },
  { value: "Long-Term", label: "Owner / Operator" },
  { value: "Conservative", label: "Underwriting Standard" },
];

export default function Credibility() {
  return (
    <>
      <section className="bg-ink text-bone py-20 md:py-24 border-t border-line">
        <div className="mx-auto max-w-content px-6 md:px-10">
          <p className="eyebrow text-slate mb-10 max-w-md">
            Building long-term value through creative real estate
            acquisitions.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 border-t border-line">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="border-r border-line last:border-r-0 py-6 px-4 md:px-6 text-center"
              >
                <div className="font-display text-2xl md:text-3xl text-brass-light">
                  {s.value}
                </div>
                <div className="eyebrow text-slate mt-2">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Standalone mission statement, deliberately set apart from the stats above */}
      <section className="bg-ink text-bone py-28 md:py-40 border-t border-line">
        <div className="mx-auto max-w-[880px] px-6 md:px-10 text-center">
          <p className="eyebrow text-brass-light mb-8">Mission</p>
          <h2 className="font-display font-medium text-bone leading-[1.15] text-3xl sm:text-4xl md:text-5xl">
            91 doors owned and professionally managed.
          </h2>
          <p className="mt-8 md:mt-10 text-slate text-lg md:text-xl leading-relaxed md:leading-loose max-w-2xl mx-auto">
            Every property I acquire is intended to be owned and operated
            for the long term, not flipped or left vacant.
          </p>
          <p className="mt-6 text-slate text-lg md:text-xl leading-relaxed md:leading-loose max-w-2xl mx-auto">
            My focus is disciplined underwriting, responsible ownership,
            and creating professionally managed shared housing that
            benefits property owners, residents, brokers, and capital
            partners alike.
          </p>
        </div>
      </section>
    </>
  );
}
