import Link from "next/link";

// Ordered to match the site-wide navigation order: Home, Sellers, "How
// Much Will I Be Paid If I Sell?", RV Parks, Capital Partners, Shared
// Housing Calculator, EcomRanx, About (see components/shared/Header.tsx).
// Split across two columns for layout, but each column preserves that
// relative order, and read top to bottom (Site, then Connect) reproduces
// it exactly, with LinkedIn appended at the end since it isn't a site
// page. There is no standalone Contact page; "Get in Touch" links point
// to the Sellers page's contact form instead (see Header.tsx).
const COLUMNS = [
  {
    title: "Site",
    links: [
      { href: "/", label: "Home" },
      { href: "/sellers", label: "Sellers" },
      { href: "/seller-calculators", label: "How Much Will I Be Paid If I Sell?" },
      { href: "/rv-parks", label: "RV Parks" },
      { href: "/capital-partners", label: "Capital Partners" },
      { href: "/shared-housing-calculator", label: "Shared Housing Calculator" },
      { href: "/ecomranx", label: "EcomRanx" },
      { href: "/about", label: "About" },
    ],
  },
  {
    title: "Connect",
    links: [
      { href: "/sellers#contact-form", label: "Get in Touch" },
      { href: "https://www.linkedin.com/in/themichaela/", label: "LinkedIn" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="print:hidden bg-ink border-t border-line pt-16 pb-10">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid md:grid-cols-[1.4fr_1fr_1fr] gap-10 md:gap-16">
          <div>
            <span className="font-display text-xl text-bone">Michael Aylett</span>
            <p className="mt-4 text-slate leading-relaxed max-w-sm text-sm">
              A professional real estate investment company purchasing
              property directly from owners, partnering with capital
              investors on select acquisitions, and operating EcomRanx, an
              independent Amazon consulting practice.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="eyebrow text-slate/70 mb-4">{col.title}</p>
              <ul className="space-y-3">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-bone/80 hover:text-brass-light transition-colors text-sm"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="eyebrow text-slate">
            © {new Date().getFullYear()} Michael Aylett
          </span>
          <span className="eyebrow text-slate/70 text-center">
            Real Estate Acquisitions · Capital Partnerships · EcomRanx
          </span>
        </div>
      </div>
    </footer>
  );
}
