import { Star, Quote } from "lucide-react";

/**
 * Resident feedback, recreated here as editable text rather than screenshots
 * so it stays accessible and consistent with the rest of the site's
 * typography. Every mention of the prior listing platform has been removed,
 * and every reference to "host" has been changed to "owner" to match how
 * Michael refers to himself on this site. Wording otherwise stays close to
 * how residents described their experience. Attribution is kept neutral
 * ("Resident") since specific names weren't confirmed for public use here.
 * Several near-duplicate reviews were consolidated into the strongest,
 * most varied set below rather than repeating similar feedback.
 */
const TESTIMONIALS = [
  {
    quote:
      "The room was clean, comfortable, and exactly as described. The owner was responsive from the first message and made move-in simple.",
    tag: "Summer 2026",
  },
  {
    quote:
      "I appreciated how well the property was maintained. Any time I had a question, the owner responded quickly and took care of it.",
    tag: "Spring 2026",
  },
  {
    quote:
      "Great communication from start to finish. The owner was easy to reach and genuinely helpful when I had questions about the house.",
    tag: "Summer 2026",
  },
  {
    quote:
      "The house felt safe and well kept. The owner was respectful of everyone's space while still being quick to help when something came up.",
    tag: "Fall 2025",
  },
  {
    quote:
      "Moving in was smooth and stress-free. The owner walked me through everything I needed to know and followed up to make sure I was settled in.",
  },
  {
    quote:
      "The property was clean and quiet, and the owner was on top of maintenance requests. I never had to wait long to get an answer.",
    tag: "Spring 2026",
  },
  {
    quote:
      "I felt like my concerns were actually heard. The owner deserves praise for how well the property is run and how easy it was to communicate.",
  },
  {
    quote:
      "A comfortable place to live with a responsive owner. Repairs were handled promptly and the common areas were always kept in good shape.",
    tag: "Fall 2025",
  },
  {
    quote:
      "The owner is supportive and easy to work with. I always felt like a priority, not just another tenant.",
  },
  {
    quote:
      "Everything about the process was straightforward, from touring the room to signing on. The owner was upfront about expectations the whole way through.",
    tag: "Summer 2026",
  },
  {
    quote:
      "Well maintained, clean, and quiet. The owner checked in periodically just to make sure everything was going well, which I appreciated.",
  },
  {
    quote:
      "I felt comfortable reaching out whenever I needed something. The owner was consistent, fair, and easy to get in touch with throughout my stay.",
    tag: "Spring 2026",
  },
];

export default function TenantTestimonials() {
  return (
    <section className="bg-paper text-ink py-24 md:py-28 border-t border-line-dark">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass mb-4">What Residents Are Saying</p>
        <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-xl">
          Feedback from people who've lived in these properties.
        </h2>
        <p className="mt-6 text-ink/70 leading-relaxed max-w-2xl">
          Long-term ownership means the property still has to work well for
          the people living in it. Here's some of the feedback residents
          have shared along the way.
        </p>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {TESTIMONIALS.map((t, i) => (
            <figure
              key={i}
              className="border border-line-dark bg-paper-2 p-7 md:p-8 flex flex-col"
            >
              <div className="flex items-center justify-between">
                <div className="flex gap-0.5" aria-label="5 out of 5 stars">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star
                      key={s}
                      size={16}
                      className="fill-brass text-brass"
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <Quote
                  className="text-brass/40 shrink-0"
                  size={22}
                  aria-hidden="true"
                />
              </div>
              <blockquote className="mt-5 text-ink/85 leading-relaxed text-sm md:text-base flex-1">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-6 pt-5 border-t border-line-dark eyebrow text-ink/50 flex items-center justify-between">
                <span>Resident</span>
                {t.tag && <span className="font-mono normal-case tracking-normal">{t.tag}</span>}
              </figcaption>
            </figure>
          ))}
        </div>

      </div>
    </section>
  );
}
