const BENEFITS = [
  "50% ownership of the property",
  "50% of the monthly cash flow",
  "Principal paydown as the mortgage is paid off",
  "Depreciation and other tax advantages",
];

export default function CapitalRaising() {
  return (
    <section id="capital" className="bg-ink text-bone py-24 md:py-32">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-4">04 — Capital Raising</p>
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-20">
          <div>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              Fund the deal. Own half of it.
            </h2>
            <p className="mt-6 text-slate leading-relaxed max-w-lg">
              I&apos;m looking for capital partners to fund new co-living
              acquisitions in full. In exchange, you get an equal seat at the
              table — half the ownership and half the cash flow, with me
              sourcing, underwriting, renovating, and operating the deal.
            </p>

            <ul className="mt-10 space-y-4">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-brass" />
                  <span className="text-bone/90">{b}</span>
                </li>
              ))}
            </ul>

            <a
              href="#contact"
              className="mt-10 inline-flex items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
            >
              Start the Conversation
            </a>
          </div>

          <div className="border border-line bg-ink-2 p-8 md:p-10">
            <p className="eyebrow text-slate mb-8">Typical Deal Terms</p>

            <div className="space-y-6">
              <div className="flex items-baseline justify-between border-b border-line pb-4">
                <span className="text-slate">Capital required</span>
                <span className="font-display text-2xl text-brass-light">~$100K</span>
              </div>
              <div className="flex items-baseline justify-between border-b border-line pb-4">
                <span className="text-slate">Partner ownership</span>
                <span className="font-display text-2xl text-bone">50%</span>
              </div>
              <div className="flex items-baseline justify-between border-b border-line pb-4">
                <span className="text-slate">Partner cash flow share</span>
                <span className="font-display text-2xl text-bone">50%</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-slate">Target COC return</span>
                <span className="font-display text-2xl text-moss">10–20%</span>
              </div>
            </div>

            <p className="mt-8 text-xs text-slate leading-relaxed">
              Terms vary by deal and are finalized in underwriting. Monthly
              cash flow can fluctuate slightly even once a property is
              stabilized.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
