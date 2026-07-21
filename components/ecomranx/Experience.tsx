export default function Experience() {
  return (
    <section className="bg-graphite py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
          <div>
            <p className="eyebrow text-signal mb-4">Background</p>
            <h2 className="font-body font-semibold text-3xl md:text-4xl text-white leading-tight tracking-tight">
              Managed at scale, before it was a consulting pitch.
            </h2>
            <p className="mt-6 text-white/60 leading-relaxed max-w-md">
              Before founding EcomRanx, I managed Amazon accounts for major
              brands including NetGear and Overstock, overseeing more than
              $72 million in combined annual revenue. That experience (the
              account-health issues, the advertising trade-offs, the
              catalog decisions that actually move revenue) is what
              EcomRanx is built on.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-graphite-2 p-8 md:p-10">
            <div className="font-body font-semibold text-5xl text-signal tracking-tight">
              $72M+
            </div>
            <div className="eyebrow text-white/50 mt-3">
              Annual Amazon Revenue Managed
            </div>
            <div className="mt-8 pt-8 border-t border-white/10 text-white/60 text-sm leading-relaxed">
              Across major brand accounts, spanning catalog management,
              advertising, and day-to-day account operations.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
