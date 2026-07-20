export default function EcomRanxHero() {
  return (
    <section className="relative overflow-hidden bg-graphite pt-32 pb-20 md:pt-44 md:pb-24">
      <div
        className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, #4FD1B5, transparent 70%)" }}
      />
      <div className="relative mx-auto max-w-content px-6 md:px-10">
        <div className="flex items-center gap-3 mb-8">
          <span className="h-2 w-2 rounded-full bg-signal" />
          <p className="eyebrow text-signal">An Independent Company by Michael Aylett</p>
        </div>

        <h1 className="font-body font-semibold text-white leading-[1.05] text-[2.5rem] sm:text-6xl md:text-7xl max-w-2xl tracking-tight">
          EcomRanx
        </h1>
        <p className="mt-6 max-w-xl text-white/60 text-lg md:text-xl leading-relaxed">
          Amazon account management and growth consulting for brands that
          need real operational experience behind the strategy.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <a
            href="https://www.ecomranx.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex justify-center items-center bg-signal text-graphite px-7 py-3.5 font-medium hover:bg-signal-light transition-colors rounded-full"
          >
            Visit EcomRanx.com
          </a>
          <a
            href="#services"
            className="inline-flex justify-center items-center border border-white/15 px-7 py-3.5 text-white hover:border-signal/60 transition-colors rounded-full"
          >
            See Services
          </a>
        </div>
      </div>
    </section>
  );
}
