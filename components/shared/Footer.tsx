import Link from "next/link";

const COLUMNS = [
  {
    title: "Site",
    links: [
      { href: "/", label: "Home" },
      { href: "/sellers", label: "Sellers" },
      { href: "/capital-partners", label: "Capital Partners" },
      { href: "/rv-parks", label: "RV Parks" },
      { href: "/about", label: "About" },
    ],
  },
  {
    title: "Connect",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/ecomranx", label: "EcomRanx" },
      { href: "https://www.linkedin.com/in/themichaela/", label: "LinkedIn" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="bg-ink border-t border-line pt-16 pb-10">
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
