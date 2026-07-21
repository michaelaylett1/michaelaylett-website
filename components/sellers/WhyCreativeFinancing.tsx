import Image from "next/image";
import { propertyImages } from "@/lib/propertyImages";

const REASONS = [
  "Limited equity in the property",
  "Wanting monthly income rather than a lump sum",
  "An upcoming relocation on a tight timeline",
  "Repairs the seller doesn't want to fund or manage",
  "A property that's difficult to sell traditionally",
  "Tax planning around how proceeds are received",
  "Needing a flexible or delayed closing date",
];

export default function WhyCreativeFinancing() {
  const img = propertyImages.entrywayStaircase;

  return (
    <section className="bg-ink text-bone py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-20">
          <div>
            <p className="eyebrow text-brass-light mb-4">
              Why Sellers Consider Creative Financing
            </p>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              A traditional sale isn&apos;t always the goal.
            </h2>
            <p className="mt-6 text-slate leading-relaxed max-w-md">
              Sellers come to these conversations for a lot of different
              reasons. Here are some of the most common ones I hear:
              yours may be one of these, a combination, or something else
              entirely.
            </p>

            <div className="relative mt-10 aspect-[3/2] w-full max-w-md border border-line">
              <Image
                src={img.src}
                alt={img.alt}
                fill
                sizes="(max-width: 1024px) 100vw, 40vw"
                className="object-cover"
                loading="lazy"
              />
            </div>
          </div>

          <ul className="divide-y divide-line border-t border-b border-line">
            {REASONS.map((r) => (
              <li key={r} className="py-5 flex items-start gap-4">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-brass" />
                <span className="text-bone/90">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
