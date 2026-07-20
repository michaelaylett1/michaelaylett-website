const CASES = [
  {
    tag: "Consumer Electronics",
    challenge: "Inconsistent advertising spend was driving traffic without driving profitable growth.",
    approach: "Rebuilt the advertising structure around margin targets instead of raw traffic, and cleaned up underperforming campaigns.",
  },
  {
    tag: "Home & Retail Goods",
    challenge: "A large, inconsistent catalog was making account health difficult to manage.",
    approach: "Standardized listing content and inventory processes to reduce account-health flags and improve visibility.",
  },
];

export default function CaseStudies() {
  return (
    <section className="bg-graphite-2 py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-signal mb-4">The Kind of Work</p>
        <h2 className="font-body font-semibold text-3xl md:text-4xl text-white leading-tight max-w-xl tracking-tight">
          Two examples of the problems we get called in for.
        </h2>
        <p className="mt-5 max-w-xl text-white/55 leading-relaxed text-sm">
          Client details are kept confidential — these are representative
          of the categories and challenges EcomRanx works on.
        </p>

        <div className="mt-14 grid md:grid-cols-2 gap-6">
          {CASES.map((c) => (
            <div key={c.tag} className="rounded-2xl border border-white/10 p-8">
              <span className="eyebrow text-signal">{c.tag}</span>
              <div className="mt-5 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/40 mb-1">Challenge</p>
                  <p className="text-white/75 text-sm leading-relaxed">{c.challenge}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/40 mb-1">Approach</p>
                  <p className="text-white/75 text-sm leading-relaxed">{c.approach}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
