const STRUCTURES = [
  {
    n: "01",
    t: "Seller Financing",
    d: "The seller finances some or all of the purchase price and receives payments over time under terms we agree to in writing, rather than a lump sum at closing.",
  },
  {
    n: "02",
    t: "Subject-To Existing Financing",
    d: "We take on responsibility for the existing loan payments under a written agreement, while the loan itself stays in place as it currently is.",
  },
  {
    n: "03",
    t: "A Combination of Both",
    d: "Existing financing stays in place while the seller carries the remaining balance through a separate seller-financed note.",
  },
  {
    n: "04",
    t: "Other Creative Structures",
    d: "Every park and every seller's situation is different, so we are open to other mutually agreed structures that make sense for both sides.",
  },
];

export default function FlexibleStructures() {
  return (
    <section className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass mb-4">Flexible Acquisition Structures</p>
        <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-2xl">
          Purchases can be structured a number of ways.
        </h2>
        <p className="mt-6 max-w-2xl text-ink/70 leading-relaxed">
          Every transaction depends on the park, the existing financing,
          the seller's goals, and a written agreement both sides are
          comfortable with. None of these is guaranteed to fit every
          property; we will work through the details together.
        </p>

        <div className="mt-16 grid sm:grid-cols-2 gap-x-10 gap-y-12">
          {STRUCTURES.map((s) => (
            <div key={s.n} className="border-t border-line-dark pt-6">
              <span className="font-mono text-brass text-sm">{s.n}</span>
              <h3 className="font-display text-xl mt-3">{s.t}</h3>
              <p className="mt-3 text-ink/70 leading-relaxed text-sm">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
