const PILLARS = [
  {
    n: "01",
    t: "Investment Philosophy",
    d: "I look for properties with a clear, durable path to stable income, not deals that only work under best-case assumptions. If the underwriting only pencils on paper, I pass.",
  },
  {
    n: "02",
    t: "Target Markets",
    d: "I focus on a small set of markets I know well, with strong rental demand fundamentals, rather than chasing whichever market is trending.",
  },
  {
    n: "03",
    t: "Acquisition Strategy",
    d: "Properties are sourced directly from owners, brokers, and my existing network, allowing for more flexible terms than a competitive open-market listing.",
  },
  {
    n: "04",
    t: "Long-Term Ownership",
    d: "I hold what I buy. Properties are underwritten and managed for multi-year performance, not a fast resale.",
  },
  {
    n: "05",
    t: "Conservative Underwriting",
    d: "I build in reserves for repairs and vacancy, and I stress-test assumptions before closing rather than after.",
  },
  {
    n: "06",
    t: "Professional Operations",
    d: "Once acquired, properties are professionally managed with consistent processes for tenant screening, maintenance, and reporting.",
  },
];

export default function Philosophy() {
  return (
    <section className="bg-ink text-bone py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-4">How I Operate</p>
        <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-xl mb-16">
          Six principles that guide every acquisition.
        </h2>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-12">
          {PILLARS.map((p) => (
            <div key={p.n} className="border-t border-line pt-6">
              <span className="font-mono text-brass-light text-sm">{p.n}</span>
              <h3 className="font-display text-xl mt-3">{p.t}</h3>
              <p className="mt-3 text-slate leading-relaxed text-sm">{p.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
