const SERVICES = [
  {
    t: "Account Management",
    d: "Hands-on management of catalog, inventory, and account health for established Amazon brands.",
  },
  {
    t: "Advertising & Growth",
    d: "Advertising and listing strategy aimed at growing revenue without eroding margin.",
  },
  {
    t: "Brand Strategy",
    d: "Positioning and operational guidance drawn from managing accounts at real scale.",
  },
];

export default function Services() {
  return (
    <section id="services" className="bg-graphite-2 py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-signal mb-4">Services</p>
        <h2 className="font-body font-semibold text-3xl md:text-4xl text-white leading-tight max-w-xl tracking-tight">
          Built for brands that need results, not theory.
        </h2>

        <div className="mt-16 grid md:grid-cols-3 gap-6">
          {SERVICES.map((s) => (
            <div
              key={s.t}
              className="rounded-2xl border border-white/10 p-8 hover:border-signal/40 transition-colors"
            >
              <h3 className="font-body font-semibold text-xl text-white">{s.t}</h3>
              <p className="mt-3 text-white/55 leading-relaxed text-sm">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
