import Image from "next/image";
import { profileImage } from "@/lib/propertyImages";

const VALUES = [
  { t: "Transparency", d: "Partners and sellers get straight answers, including when the answer is that a deal isn't a fit." },
  { t: "Discipline", d: "Conservative underwriting over exciting projections, every time." },
  { t: "Service", d: "The best outcome is the one that actually works for the person on the other side of the table." },
];

export default function ValuesMission() {
  return (
    <section className="bg-ink text-bone py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-20">
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="relative h-14 w-11 shrink-0 rounded-sm overflow-hidden border border-line">
                <Image
                  src={profileImage.src}
                  alt={profileImage.alt}
                  fill
                  sizes="44px"
                  className="object-cover"
                  loading="lazy"
                />
              </div>
              <p className="eyebrow text-brass-light">Mission</p>
            </div>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              Create real value for the people on both sides of a deal.
            </h2>
            <p className="mt-6 text-slate leading-relaxed max-w-md">
              For sellers, that means honest options instead of a single
              lowball offer. For residents, it means a well-run, affordable
              place to live. For capital partners, it means disciplined,
              transparent ownership. Those aren't separate goals: they're
              the same one, seen from different sides.
            </p>
          </div>

          <div>
            <p className="eyebrow text-slate mb-6">Values</p>
            <div className="space-y-6">
              {VALUES.map((v) => (
                <div key={v.t} className="border-t border-line pt-5">
                  <h3 className="font-display text-xl">{v.t}</h3>
                  <p className="mt-2 text-slate leading-relaxed text-sm">{v.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
