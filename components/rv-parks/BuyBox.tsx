const CRITERIA = [
  { value: "$150K+", label: "Annual NOI" },
  { value: "35+", label: "RV Pads" },
  { value: "10%", label: "Target Cap Rate" },
];

export default function BuyBox() {
  return (
    <section className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass mb-4">RV Park Buy Box</p>
        <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-xl">
          What we are looking for, at a glance.
        </h2>

        <div className="mt-14 grid sm:grid-cols-3 gap-6">
          {CRITERIA.map((c) => (
            <div
              key={c.label}
              className="border border-line-dark bg-ink text-bone px-8 py-10 text-center"
            >
              <div className="font-display text-4xl md:text-5xl text-brass-light">
                {c.value}
              </div>
              <div className="eyebrow text-slate mt-3">{c.label}</div>
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-2xl text-ink/60 leading-relaxed text-sm">
          These figures describe the kind of opportunity we are built to
          move on quickly. Properties outside these ranges are still worth
          a conversation, since every opportunity is reviewed individually.
        </p>
      </div>
    </section>
  );
}
