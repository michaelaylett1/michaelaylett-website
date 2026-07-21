import Image from "next/image";
import type { PropertyImage } from "@/lib/propertyImages";

export default function ImageBanner({
  image,
  caption,
  eyebrow,
  height = "h-[52vh] md:h-[62vh]",
  priority = false,
}: {
  image: PropertyImage;
  caption?: string;
  eyebrow?: string;
  height?: string;
  priority?: boolean;
}) {
  return (
    <div className={`relative w-full ${height} overflow-hidden bg-ink-2`}>
      <Image
        src={image.src}
        alt={image.alt}
        fill
        sizes="100vw"
        className="object-cover"
        loading={priority ? "eager" : "lazy"}
        priority={priority}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/10 to-transparent" />
      {(caption || eyebrow) && (
        <div className="absolute inset-x-0 bottom-0 px-6 md:px-10 pb-8 md:pb-10">
          <div className="mx-auto max-w-content">
            {eyebrow && (
              <p className="eyebrow text-brass-light mb-2">{eyebrow}</p>
            )}
            {caption && (
              <p className="font-display text-xl md:text-2xl text-bone max-w-xl leading-snug">
                {caption}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
