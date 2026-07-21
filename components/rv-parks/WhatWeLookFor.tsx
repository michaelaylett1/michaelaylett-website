const FACTORS = [
  "Established operating history",
  "Reliable financial records",
  "Long-term, seasonal, or mixed occupancy",
  "Opportunities to improve operations or add sites",
  "Professional or transferable management systems",
  "Strong local demand drivers",
  "Seller financing or other creative financing opportunities",
];

export default function WhatWeLookFor() {
  return (
    <section className="bg-ink text-bone py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-20">
          <div>
            <p className="eyebrow text-brass-light mb-4">What We Look For</p>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              A general profile, not a strict checklist.
            </h2>
            <p className="mt-6 text-slate leading-relaxed max-w-md">
              A property does not need to check every box below. These are
              the factors we weigh most, and every opportunity is reviewed
              individually on its own merits.
            </p>
          </div>

          <ul className="divide-y divide-line border-t border-b border-line">
            {FACTORS.map((f) => (
              <li key={f} className="py-5 flex items-start gap-4">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-brass" />
                <span className="text-bone/90">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
