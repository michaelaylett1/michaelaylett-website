import Image from "next/image";
import { propertyImages } from "@/lib/propertyImages";

export default function LongTermOwnership() {
  const img = propertyImages.diningFireplace;

  return (
    <section className="bg-paper text-ink py-24 md:py-28 border-t border-line-dark">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="relative aspect-[4/3] w-full border border-line-dark">
            <Image
              src={img.src}
              alt={img.alt}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              loading="lazy"
            />
          </div>

          <div>
            <p className="eyebrow text-brass mb-4">Long-Term Ownership</p>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              Cared for after closing, not just before it.
            </h2>
            <p className="mt-6 text-ink/70 leading-relaxed max-w-md">
              What happens to your property after we close matters to me.
              Every acquisition is professionally managed for the long
              term: maintained, kept occupied, and treated the way an
              owner who plans to hold it for years would treat it, because
              that is exactly the plan.
            </p>
            <p className="mt-5 text-ink/70 leading-relaxed max-w-md">
              That is part of why sellers, brokers, and title companies
              come back to work with me again.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
