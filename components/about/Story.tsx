const SECTIONS = [
  {
    n: "01",
    t: "Where I started",
    p: [
      "From 2012 to 2014, I served an LDS mission in Richmond, Virginia. It's an experience that shaped my work ethic and my sense of what it means to actually serve the people you work with, not just talk about it.",
      "My professional career started in Amazon eCommerce, managing accounts for major brands, including NetGear and Overstock. Over time, I was responsible for over $72 million in combined annual revenue, which meant learning, under real pressure, how to make decisions that actually held up.",
    ],
  },
  {
    n: "02",
    t: "The move into real estate",
    p: [
      "Real estate started as a way to build something that didn't depend on a single account or a single platform. I began as a capital partner myself before I ever led a deal of my own, which meant I learned what it feels like to hand your money to someone else and hope they treat it carefully.",
      "That experience is a big part of why I underwrite conservatively today. I know what it's like to be on the other side of the table.",
    ],
  },
  {
    n: "03",
    t: "Why I like complex problems",
    p: [
      "A lot of real estate deals are simple: list it, sell it, done. I'm more interested in the properties and sellers where that doesn't quite work, where a creative structure, a flexible timeline, or a different kind of buyer actually solves a real problem for someone.",
      "That's also true in how I think about housing itself. Turning underused properties into well-managed, professionally operated shared housing is a way to create real value for both residents and owners, not just extract it.",
    ],
  },
];

export default function Story() {
  return (
    <section className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="space-y-20 max-w-3xl">
          {SECTIONS.map((s) => (
            <div key={s.n} className="border-t border-line-dark pt-8">
              <div className="flex items-baseline gap-4 mb-4">
                <span className="font-mono text-brass text-sm">{s.n}</span>
                <h2 className="font-display text-2xl md:text-3xl">{s.t}</h2>
              </div>
              {s.p.map((para, i) => (
                <p key={i} className="mt-4 text-ink/75 leading-relaxed">
                  {para}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
