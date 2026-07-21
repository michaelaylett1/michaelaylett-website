import Image from "next/image";
import { propertyImages } from "@/lib/propertyImages";

const WAYS = [
  {
    n: "01",
    t: "Subject-To",
    d: "I purchase the property subject to the existing mortgage. The loan stays in your name, and I take on responsibility for making the monthly payments according to our written agreement. The lender isn't formally involved in transferring or assuming the loan; we simply agree, in writing, on how those payments will be handled going forward.",
  },
  {
    n: "02",
    t: "Seller Financing",
    d: "I finance some or all of the purchase price directly with you as the seller. You receive payments over time under mutually agreed written terms, rather than a lump sum at closing.",
  },
  {
    n: "03",
    t: "Subject-To With Seller Financing",
    d: "A combination of both: the existing mortgage stays in place while you carry the remaining equity through a separate seller-financed note, with its own written terms.",
  },
];

export default function WaysIPurchase() {
  const img = propertyImages.kitchenRenovated;

  return (
    <section className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <p className="eyebrow text-brass mb-4">Ways I Purchase Properties</p>
            <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-2xl">
              I purchase through creative financing, not a one-size-fits-all offer.
            </h2>
            <p className="mt-6 max-w-2xl text-ink/70 leading-relaxed">
              Below is a plain-language look at how each structure works.
              Every transaction depends on the property, the existing
              financing, title review, your goals as the seller, and a
              written agreement both sides are comfortable with. None of
              these is guaranteed to fit your property; we&apos;ll work
              through that together before anything is decided.
            </p>
          </div>

          <div className="relative aspect-[4/3] w-full border border-line-dark order-first lg:order-last">
            <Image
              src={img.src}
              alt={img.alt}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              loading="lazy"
            />
          </div>
        </div>

        <div className="mt-16 grid md:grid-cols-3 gap-x-10 gap-y-12">
          {WAYS.map((w) => (
            <div key={w.n} className="border-t border-line-dark pt-6">
              <span className="font-mono text-brass text-sm">{w.n}</span>
              <h3 className="font-display text-xl mt-3">{w.t}</h3>
              <p className="mt-3 text-ink/70 leading-relaxed text-sm">{w.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
