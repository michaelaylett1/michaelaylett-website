import { Quote } from "lucide-react";

/**
 * Real testimonials from past capital partners, recreated here as styled
 * text rather than screenshots so they stay accessible, editable, and
 * consistent with the rest of the site's typography. Attribution is kept
 * neutral ("Capital Partner") since no name, title, company, or location
 * was provided or should be invented. No performance guarantees or return
 * figures are implied here or anywhere else on this page.
 */
const TESTIMONIALS = [
  {
    quote:
      "This was my first business collaboration with Michael, and I was very impressed with both the process and the results. He was thorough, provided helpful background information, and answered most of my questions before we even met. He is very easy to work with and has proven himself time and time again. I am very happy with our first collaboration and look forward to working with him for a long time to come.",
    attribution: "Capital Partner",
  },
  {
    quote:
      "Michael has been great to partner with on a real estate opportunity. The process was smooth and transparent, with all necessary capital and expenses clearly laid out. He provided valuable insight based on his experience and answered every question I had as a new investor. Michael continues to underpromise and overdeliver, and I look forward to partnering with him again on the next investment opportunity.",
    attribution: "Capital Partner",
  },
];

export default function Testimonials() {
  return (
    <section className="bg-ink text-bone py-24 md:py-28 border-t border-line">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-4">What Capital Partners Say</p>
        <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-xl">
          Feedback from partners I&apos;ve worked with.
        </h2>

        <div className="mt-14 grid md:grid-cols-2 gap-6 md:gap-8">
          {TESTIMONIALS.map((t, i) => (
            <figure
              key={i}
              className="border border-line bg-ink-2 p-8 md:p-10 flex flex-col"
            >
              <Quote className="text-brass-light shrink-0" size={28} aria-hidden="true" />
              <blockquote className="mt-6 text-bone/90 leading-relaxed text-base md:text-lg">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-8 pt-6 border-t border-line eyebrow text-slate">
                {t.attribution}
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-8 max-w-2xl text-slate/70 leading-relaxed text-xs">
          Shared with permission. Individual experiences vary, and past
          collaborations are not a guarantee of future results.
        </p>
      </div>
    </section>
  );
}
