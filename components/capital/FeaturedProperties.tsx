import Image from "next/image";
import { propertyImages } from "@/lib/propertyImages";

const FEATURED = [
  {
    // Atlanta and Dallas share an equal-width, equal-height two-column
    // row on desktop (both lg:col-span-6, both aspect-[4/3]) so neither
    // reads as bigger than the other; below lg the shared parent grid
    // (grid-cols-1 sm:grid-cols-2) already puts them side by side on
    // tablet and stacked on mobile at matching sizes.
    image: propertyImages.aerialNeighborhood,
    location: "Atlanta, Georgia",
    caption: "Suburban community with the downtown Atlanta skyline in view",
    span: "lg:col-span-6",
    aspect: "aspect-[4/3]",
  },
  {
    image: propertyImages.aerialDallas,
    location: "Dallas, Texas",
    caption: "Established residential neighborhood in Dallas, Texas",
    span: "lg:col-span-6",
    aspect: "aspect-[4/3]",
  },
  {
    image: propertyImages.hallwayNumberedDoors,
    location: "Professionally Managed",
    caption: "Numbered rooms inside an operating co-living residence",
    span: "lg:col-span-4",
    aspect: "aspect-square",
  },
  {
    image: propertyImages.kitchenWhiteRenovated,
    location: "Modern Kitchen",
    caption: "Updated finishes designed for long-term durability",
    span: "lg:col-span-4",
    aspect: "aspect-square",
  },
  {
    image: propertyImages.bathroomRenovated,
    location: "Renovated Bathroom",
    caption: "High-quality materials and professional craftsmanship",
    span: "lg:col-span-4",
    aspect: "aspect-square",
  },
  {
    image: propertyImages.diningFireplace,
    location: "Shared Common Area",
    caption: "Comfortable shared common areas",
    span: "lg:col-span-12",
    aspect: "aspect-[21/9]",
  },
];

export default function FeaturedProperties() {
  return (
    <section className="bg-ink text-bone py-24 md:py-28 border-t border-line">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-4">
          Properties We Own and Operate
        </p>
        <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-xl">
          A look at the kind of assets we acquire and operate.
        </h2>
        <p className="mt-5 max-w-2xl text-slate leading-relaxed text-sm">
          A small sample of properties currently owned and professionally
          managed across the portfolio, spanning multiple markets.
        </p>

        <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-6">
          {FEATURED.map((item, i) => (
            <figure
              key={item.location}
              className={`group relative overflow-hidden ${item.span} ${item.aspect}`}
            >
              <Image
                src={item.image.src}
                alt={item.image.alt}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 40vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                loading={i === 0 ? "eager" : "lazy"}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/5 to-transparent" />
              <figcaption className="absolute inset-x-0 bottom-0 p-5 md:p-6">
                <p className="eyebrow text-brass-light mb-1">{item.location}</p>
                <p className="text-bone text-sm md:text-base leading-snug max-w-xs">
                  {item.caption}
                </p>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-8 max-w-2xl text-slate/70 leading-relaxed text-xs">
          Images are representative of properties owned or operated by
          Michael Aylett and are provided for general background purposes
          only. They do not represent a current investment offering.
        </p>
      </div>
    </section>
  );
}
