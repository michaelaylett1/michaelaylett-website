export default function WhoIAm() {
  return (
    <section className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid md:grid-cols-12 gap-12 md:gap-16">
          <div className="md:col-span-4">
            <p className="eyebrow text-brass mb-4">Who I Am</p>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              An owner-operator, not a syndicator chasing scale.
            </h2>
          </div>
          <div className="md:col-span-8 space-y-5 text-ink/75 leading-relaxed max-w-2xl">
            <p>
              I&apos;m a real estate investor who acquires property directly
              from owners and holds it for the long term. Before real
              estate, I spent years managing large Amazon accounts, which
              is where I built the operational discipline I now apply to
              underwriting and running properties.
            </p>
            <p>
              I&apos;m not raising a fund or offering a public investment
              product. When a deal meets my standards and needs outside
              capital, I bring it to a small number of partners I know and
              trust, and we work through the specifics of that deal
              together.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
