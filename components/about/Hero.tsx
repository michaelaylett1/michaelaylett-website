import Image from "next/image";
import { profileImage } from "@/lib/propertyImages";

export default function AboutHero() {
  return (
    <section className="relative overflow-hidden bg-ink bg-noise pt-32 pb-16 md:pt-40 md:pb-20">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(237,231,218,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(237,231,218,0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="relative mx-auto max-w-content px-6 md:px-10">
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-12 lg:gap-16 items-center">
          <div>
            <p className="eyebrow text-brass-light mb-6">About</p>
            <h1 className="font-display text-bone leading-[1.05] text-[2.4rem] sm:text-5xl md:text-6xl max-w-xl">
              From Amazon accounts to real estate ownership.
            </h1>
            <p className="mt-8 max-w-xl text-slate text-base md:text-lg leading-relaxed">
              Based in Salt Lake City, Utah. Here&apos;s how I got here, and
              why I do the work the way I do.
            </p>
          </div>

          <div className="relative aspect-[4/5] w-full max-w-xs mx-auto lg:max-w-sm rounded-md border border-line overflow-hidden">
            <Image
              src={profileImage.src}
              alt={profileImage.alt}
              fill
              sizes="(max-width: 1024px) 320px, 380px"
              className="object-cover"
              priority
            />
          </div>
        </div>
      </div>
    </section>
  );
}
