"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/sellers", label: "Sellers" },
  { href: "/rv-parks", label: "RV Parks" },
  { href: "/capital-partners", label: "Capital Partners" },
  { href: "/ecomranx", label: "EcomRanx" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
        scrolled ? "bg-ink/90 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="flex h-16 md:h-20 items-center justify-between border-b border-line">
          <Link href="/" className="font-display text-lg text-bone tracking-wide">
            Michael Aylett
          </Link>

          <nav className="hidden lg:flex items-center gap-5 xl:gap-7">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`eyebrow transition-colors underline-brass pb-1 ${
                  pathname === l.href ? "text-brass-light" : "text-slate hover:text-bone"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/contact"
            className="hidden lg:inline-flex items-center gap-2 border border-brass/60 px-4 py-2 eyebrow text-brass-light hover:bg-brass hover:text-ink transition-colors"
          >
            Get in Touch
          </Link>

          <button
            aria-label="Toggle menu"
            className="lg:hidden text-bone"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden bg-ink border-b border-line">
          <nav className="mx-auto max-w-content px-6 py-6 flex flex-col gap-5">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`eyebrow transition-colors ${
                  pathname === l.href ? "text-brass-light" : "text-slate hover:text-bone"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/contact"
              className="inline-flex w-fit items-center gap-2 border border-brass/60 px-4 py-2 eyebrow text-brass-light"
            >
              Get in Touch
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
