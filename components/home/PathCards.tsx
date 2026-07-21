import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const CARDS = [
  {
    n: "01",
    t: "Selling Your Property",
    d: "I purchase property through creative financing structures, including seller financing and subject-to transactions, built around your timeline and goals rather than a one-size-fits-all offer.",
    cta: "Learn More",
    href: "/sellers",
  },
  {
    n: "02",
    t: "Capital Partnerships",
    d: "I partner with qualified investors on acquisitions that meet my underwriting standards, taking a long-term, conservative approach to ownership and operations.",
    cta: "Learn More",
    href: "/capital-partners",
  },
  {
    n: "03",
    t: "Amazon Growth Consulting",
    d: "I also own EcomRanx, an Amazon consulting company that helps brands manage and grow their presence on the platform.",
    cta: "Visit EcomRanx",
    href: "/ecomranx",
  },
];

export default function PathCards() {
  return (
    <section className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid md:grid-cols-3 gap-px bg-line-dark border border-line-dark">
          {CARDS.map((c) => (
            <div key={c.t} className="bg-paper p-8 md:p-10 flex flex-col">
              <span className="font-mono text-brass text-sm">{c.n}</span>
              <h3 className="font-display text-2xl mt-4">{c.t}</h3>
              <p className="mt-4 text-ink/70 leading-relaxed text-sm flex-1">
                {c.d}
              </p>
              <Link
                href={c.href}
                className="mt-8 inline-flex items-center gap-2 eyebrow text-ink hover:text-brass transition-colors w-fit"
              >
                {c.cta}
                <ArrowUpRight size={15} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
