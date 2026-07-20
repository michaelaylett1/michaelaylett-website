const FACTS = [
  {
    k: "Based",
    v: "Salt Lake City, Utah",
  },
  {
    k: "Investor's eye",
    v: "Having been a capital partner myself, I know exactly what investors look for — and I structure every deal to protect their interests first.",
  },
  {
    k: "Selective by design",
    v: "I pass on far more deals than I take. Every acquisition has to clear a high bar for cash flow and downside protection.",
  },
  {
    k: "eCommerce background",
    v: "Before real estate, I managed over $72M in annual Amazon revenue for accounts including NetGear and Overstock.",
  },
  {
    k: "Service",
    v: "I served an LDS mission in Richmond, Virginia from 2012–2014 — the years that shaped my work ethic and my commitment to the people I work with.",
  },
];

export default function About() {
  return (
    <section id="about" className="bg-paper text-ink py-24 md:py-32">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid md:grid-cols-12 gap-12 md:gap-16">
          <div className="md:col-span-4">
            <p className="eyebrow text-brass mb-4">01 — About Me</p>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              A capital partner before I was ever a sponsor.
            </h2>
            <p className="mt-6 text-ink/70 leading-relaxed">
              That order matters. I underwrite every deal the way I&apos;d want
              it underwritten if it were my own money going in first —
              because for most of my career, it was.
            </p>
          </div>

          <div className="md:col-span-8">
            <dl className="divide-y divide-line-dark border-t border-b border-line-dark">
              {FACTS.map((f) => (
                <div key={f.k} className="grid sm:grid-cols-[180px_1fr] gap-2 sm:gap-8 py-6">
                  <dt className="eyebrow text-ink/50">{f.k}</dt>
                  <dd className="text-ink/85 leading-relaxed">{f.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
