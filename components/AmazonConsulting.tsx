const SERVICES = [
  {
    n: "01",
    t: "Account management",
    d: "Hands-on management of catalog, inventory, and account health for established Amazon brands.",
  },
  {
    n: "02",
    t: "Revenue growth",
    d: "Advertising and listing strategy aimed at growing top-line revenue without eroding margin.",
  },
  {
    n: "03",
    t: "Brand strategy",
    d: "Positioning and operational guidance drawn from managing accounts at real scale.",
  },
];

export default function AmazonConsulting() {
  return (
    <section id="ecomranx" className="bg-paper text-ink py-24 md:py-32">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass mb-4">05 — Amazon Consulting</p>
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-start">
          <div>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              EcomRanx: Amazon growth, run by someone who&apos;s managed
              the real numbers.
            </h2>
            <p className="mt-6 text-ink/70 leading-relaxed max-w-lg">
              Before real estate, I managed over $72 million in annual Amazon
              revenue for major brand accounts, including NetGear and
              Overstock. I founded EcomRanx to bring that same
              account-management discipline to brands that want to grow on
              Amazon without guessing at what actually moves revenue.
            </p>

            <div className="mt-10 border border-line-dark p-6 bg-ink text-bone inline-block">
              <div className="font-display text-4xl text-brass-light">$72M+</div>
              <div className="eyebrow text-slate mt-2">
                Annual Amazon Revenue Managed
              </div>
            </div>
          </div>

          <div className="space-y-8">
            {SERVICES.map((s) => (
              <div key={s.n} className="flex gap-6 border-t border-line-dark pt-6">
                <span className="font-mono text-brass text-sm pt-1">{s.n}</span>
                <div>
                  <h3 className="font-display text-xl">{s.t}</h3>
                  <p className="mt-2 text-ink/70 leading-relaxed text-sm">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
