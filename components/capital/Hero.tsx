export default function CapitalHero() {
  return (
    <section className="relative overflow-hidden bg-ink bg-noise pt-32 pb-16 md:pt-44 md:pb-20">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(237,231,218,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(237,231,218,0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="relative mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-6">For Capital Partners</p>
        <h1 className="font-display text-bone leading-[1.05] text-[2.4rem] sm:text-5xl md:text-6xl max-w-2xl">
          Disciplined acquisitions, long-term ownership.
        </h1>
        <p className="mt-8 max-w-xl text-slate text-base md:text-lg leading-relaxed">
          I occasionally partner with qualified investors on acquisitions
          that meet my underwriting standards. This page explains how I
          think about deals, markets, and ownership — so you know what to
          expect before we ever discuss a specific opportunity.
        </p>
        <a
          href="#schedule"
          className="mt-10 inline-flex items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
        >
          Schedule a Conversation
        </a>
      </div>
    </section>
  );
}
