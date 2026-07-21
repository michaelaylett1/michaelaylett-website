const STATS = [
  { value: "91", label: "Doors Owned" },
  { value: "3+", label: "Markets" },
  { value: "Long-Term", label: "Owner / Operator" },
  { value: "Conservative", label: "Underwriting Standard" },
];

export default function Credibility() {
  return (
    <section className="bg-ink text-bone py-20 md:py-24 border-t border-line">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-slate mb-10 max-w-md">
          A long-term owner and operator, not a wholesaler passing contracts
          to someone else.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 border-t border-line">
          {STATS.map((s) => (
            <div key={s.label} className="border-r border-line last:border-r-0 py-6 pr-6">
              <div className="font-display text-2xl md:text-3xl text-brass-light">
                {s.value}
              </div>
              <div className="eyebrow text-slate mt-2">{s.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-10 max-w-2xl text-slate leading-relaxed text-sm">
          91 doors owned and professionally managed after closing, not
          flipped, not left vacant. That combination of disciplined
          underwriting and hands-on, long-term management is what property
          owners, brokers, and capital partners can expect when they work
          with me.
        </p>
      </div>
    </section>
  );
}
