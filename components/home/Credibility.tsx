import Image from "next/image";
import { propertyImages } from "@/lib/propertyImages";

const STATS = [
  { value: "91", label: "Doors Owned" },
  { value: "3+", label: "Markets" },
  { value: "Long-Term", label: "Owner / Operator" },
  { value: "Conservative", label: "Underwriting Standard" },
];

const PILLARS = [
  "Long-term ownership",
  "Professional management",
  "Disciplined underwriting",
  "Resident-focused operations",
];

export default function Credibility() {
  const img = propertyImages.diningFireplace;

  return (
    <>
      <section className="bg-ink text-bone py-20 md:py-24 border-t border-line">
        <div className="mx-auto max-w-content px-6 md:px-10">
          <p className="eyebrow text-slate mb-10 max-w-md">
            Building long-term value through creative real estate
            acquisitions.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 border-t border-line">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="border-r border-line last:border-r-0 py-6 px-4 md:px-6 text-center"
              >
                <div className="font-display text-2xl md:text-3xl text-brass-light">
                  {s.value}
                </div>
                <div className="eyebrow text-slate mt-2">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Standalone mission section, image on one side, text vertically centered on the other */}
      <section className="bg-ink text-bone border-t border-line">
        <div className="grid lg:grid-cols-2">
          <div className="relative h-[42vh] lg:h-auto min-h-[420px]">
            <Image
              src={img.src}
              alt={img.alt}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-ink/10" />
          </div>

          <div className="flex items-center py-20 md:py-28 lg:py-0">
            <div className="px-6 md:px-10 lg:pl-16 lg:pr-16 xl:pl-20 xl:pr-24 max-w-2xl">
              <div className="border-l-2 border-brass/60 pl-6">
                <p className="eyebrow text-brass-light mb-6">
                  Long-Term Ownership
                </p>
                <h2 className="font-display font-medium text-bone leading-[1.1] text-4xl sm:text-5xl md:text-[3.4rem]">
                  91 doors owned and professionally managed.
                </h2>
                <p className="mt-8 text-slate text-lg leading-relaxed">
                  Every property I acquire is intended to be owned and
                  operated for the long term, not flipped or left vacant.
                </p>
                <p className="mt-5 text-slate text-lg leading-relaxed">
                  My focus is disciplined underwriting, responsible
                  ownership, and professionally managed shared housing that
                  creates value for property owners, residents, brokers,
                  and capital partners.
                </p>

                <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
                  {PILLARS.map((p) => (
                    <span key={p} className="eyebrow text-slate/80">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
