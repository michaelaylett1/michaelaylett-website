"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

const LINKS = [
  { href: "#about", label: "About" },
  { href: "#portfolio", label: "Portfolio" },
  { href: "#strategy", label: "Strategy" },
  { href: "#capital", label: "Capital Raising" },
  { href: "#ecomranx", label: "Amazon Consulting" },
  { href: "#contact", label: "Contact" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
        scrolled ? "bg-ink/90 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="flex h-16 md:h-20 items-center justify-between border-b border-line">
          <a href="#top" className="font-display text-lg text-bone tracking-wide">
            Michael Aylett
          </a>

          <nav className="hidden lg:flex items-center gap-8">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="eyebrow text-slate hover:text-bone transition-colors underline-brass pb-1"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <a
            href="#contact"
            className="hidden lg:inline-flex items-center gap-2 border border-brass/60 px-4 py-2 eyebrow text-brass-light hover:bg-brass hover:text-ink transition-colors"
          >
            Partner With Me
          </a>

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
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="eyebrow text-slate hover:text-bone transition-colors"
              >
                {l.label}
              </a>
            ))}
            <a
              href="#contact"
              onClick={() => setOpen(false)}
              className="inline-flex w-fit items-center gap-2 border border-brass/60 px-4 py-2 eyebrow text-brass-light"
            >
              Partner With Me
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
