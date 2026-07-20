const WAYS = [
  {
    n: "01",
    t: "Traditional Purchase",
    d: "A straightforward cash purchase, closed on your timeline with no financing contingencies or repair demands. This is often the right fit when you want the simplest possible path to closing.",
  },
  {
    n: "02",
    t: "Seller Financing",
    d: "Instead of receiving all your proceeds at closing, you act as the lender and receive payments over time — often at attractive terms for both sides, and with potential tax advantages worth discussing with your advisor.",
  },
  {
    n: "03",
    t: "Subject-To",
    d: "I take over the property and its existing mortgage payments while the loan stays in your name. This can be a fit when a traditional sale isn't practical, though it isn't the right fit for every situation and every existing loan.",
  },
];

export default function WaysIPurchase() {
  return (
    <section className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass mb-4">Ways I Purchase Properties</p>
        <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-2xl">
          Not every property fits the same box — so I don&apos;t use one.
        </h2>
        <p className="mt-6 max-w-2xl text-ink/70 leading-relaxed">
          Below is a plain-language look at how each option works. None of
          these is guaranteed to fit your property — the right structure
          depends on your equity position, your loan, and your goals. We&apos;ll
          work through that together before anything is decided.
        </p>

        <div className="mt-16 grid md:grid-cols-3 gap-x-10 gap-y-12">
          {WAYS.map((w) => (
            <div key={w.n} className="border-t border-line-dark pt-6">
              <span className="font-mono text-brass text-sm">{w.n}</span>
              <h3 className="font-display text-xl mt-3">{w.t}</h3>
              <p className="mt-3 text-ink/70 leading-relaxed text-sm">{w.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
