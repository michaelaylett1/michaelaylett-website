import Image from "next/image";
import { propertyImages } from "@/lib/propertyImages";

const STEPS = [
  { n: "01", t: "Conversation", d: "A no-pressure call to understand your property and your goals." },
  { n: "02", t: "Property Review", d: "I look at the property, the loan (if any), and the numbers." },
  { n: "03", t: "Discuss Options", d: "We talk through which structures, if any, could work for you." },
  { n: "04", t: "Purchase Agreement", d: "If it's a fit, we put terms in writing that you're comfortable with." },
  { n: "05", t: "Closing", d: "We close through a title company or attorney, on the timeline we agreed to." },
];

export default function Process() {
  const img = propertyImages.kitchenWhiteRenovated;

  return (
    <section className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        {/* Two-column header: heading and intro copy on the left, a
            substantially larger, landscape-cropped image on the right,
            vertically centered against the text block. On mobile this
            collapses to a single column with the image appearing below
            the heading (its natural DOM position) and above the five
            steps. The image runs roughly 40% of the content width on
            desktop, an offset brass rule behind it gives it a light
            framed treatment consistent with the site's flat, line-based
            design language elsewhere on the page. */}
        <div className="grid lg:grid-cols-5 gap-10 lg:gap-14 items-center">
          <div className="lg:col-span-3">
            <p className="eyebrow text-brass mb-4">My Process</p>
            <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-xl">
              Five steps, from first call to closing.
            </h2>
            <p className="mt-5 max-w-md text-ink/70 leading-relaxed">
              Every property is different, but the path from our first
              conversation to a closed transaction generally looks like
              this, so you always know what comes next.
            </p>
          </div>

          <div className="lg:col-span-2 relative">
            <div
              aria-hidden="true"
              className="hidden sm:block absolute -bottom-4 -right-4 w-full h-full border border-brass/40"
            />
            <div className="relative aspect-[3/2] w-full border border-line-dark">
              <Image
                src={img.src}
                alt={img.alt}
                fill
                sizes="(min-width: 1024px) 40vw, 100vw"
                className="object-cover"
                loading="lazy"
              />
            </div>
          </div>
        </div>

        <div className="mt-16 relative">
          {/* connecting line */}
          <div className="hidden md:block absolute top-6 left-0 right-0 h-px bg-line-dark" />
          <div className="grid md:grid-cols-5 gap-10 md:gap-6">
            {STEPS.map((s) => (
              <div key={s.n} className="relative">
                <div className="hidden md:flex h-12 w-12 items-center justify-center rounded-full bg-ink text-bone font-mono text-sm relative z-10">
                  {s.n}
                </div>
                <div className="md:hidden font-mono text-brass text-sm mb-2">{s.n}</div>
                <h3 className="font-display text-lg mt-4 md:mt-5">{s.t}</h3>
                <p className="mt-2 text-ink/70 leading-relaxed text-sm">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
