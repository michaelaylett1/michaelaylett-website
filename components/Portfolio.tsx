const HOLDINGS = [
  { state: "Texas", detail: "Co-living / PadSplit rooms" },
  { state: "Georgia", detail: "Co-living / PadSplit rooms" },
  { state: "Utah", detail: "Co-living / PadSplit rooms" },
];

export default function Portfolio() {
  return (
    <section id="portfolio" className="bg-ink text-bone py-24 md:py-32">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-4">02 — Current Portfolio</p>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-xl">
            83 doors, generating $50,000+ a month.
          </h2>
          <p className="max-w-sm text-slate leading-relaxed">
            The portfolio is concentrated in co-living and PadSplit rooms
            across three states, chosen for strong rent-to-price ratios and
            durable renter demand.
          </p>
        </div>

        {/* holdings ledger */}
        <div className="mt-16 border-t border-line">
          {HOLDINGS.map((h, i) => (
            <div
              key={h.state}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-6 py-5 border-b border-line"
            >
              <span className="font-mono text-slate text-sm">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-display text-xl md:text-2xl">{h.state}</span>
              <span className="eyebrow text-slate hidden sm:inline">{h.detail}</span>
            </div>
          ))}
        </div>

        {/* featured case study */}
        <div className="mt-20 grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
          <div>
            <p className="eyebrow text-brass-light mb-4">Featured Property</p>
            <h3 className="font-display text-2xl md:text-3xl leading-tight">
              An 8-room PadSplit, fully occupied for months running.
            </h3>
            <p className="mt-5 text-slate leading-relaxed max-w-lg">
              This is my third PadSplit conversion — eight private, furnished
              rooms inside a single-family home, with every room leased for
              several consecutive months. It&apos;s a clear example of what a
              stabilized co-living property looks like once it&apos;s past the
              rehab and lease-up phase.
            </p>
          </div>

          <div className="border border-line p-8 md:p-10 bg-ink-2">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <div className="font-display text-4xl text-brass-light">8</div>
                <div className="eyebrow text-slate mt-2">Private Rooms</div>
              </div>
              <div>
                <div className="font-display text-4xl text-brass-light">100%</div>
                <div className="eyebrow text-slate mt-2">Occupancy, Sustained</div>
              </div>
              <div className="col-span-2 pt-6 border-t border-line">
                <div className="font-display text-4xl text-moss">25%+</div>
                <div className="eyebrow text-slate mt-2">
                  Cash-on-Cash Return
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
