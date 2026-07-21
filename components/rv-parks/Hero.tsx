export default function RVParksHero() {
  return (
    <section className="relative overflow-hidden bg-ink bg-noise pt-32 pb-16 md:pt-40 md:pb-20">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(237,231,218,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(237,231,218,0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="relative mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-6">
          For RV Park Owners, Brokers, and Operators
        </p>
        <h1 className="font-display text-bone leading-[1.05] text-[2.4rem] sm:text-5xl md:text-6xl max-w-2xl">
          We Buy RV Parks
        </h1>
        <p className="mt-8 max-w-xl text-slate text-base md:text-lg leading-relaxed">
          We are actively acquiring established RV parks that meet our
          operating and financial criteria. We are particularly interested
          in opportunities where creative financing can provide a flexible
          solution for the seller.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row flex-wrap gap-4">
          <a
            href="#rv-form"
            className="inline-flex justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
          >
            Submit an RV Park
          </a>
          <a
            href="/contact"
            className="inline-flex justify-center items-center border border-line px-7 py-3.5 text-bone hover:border-brass/60 transition-colors"
          >
            Discuss a Property
          </a>
        </div>
      </div>
    </section>
  );
}
