import type { Metadata } from "next";
import AboutHero from "@/components/about/Hero";
import Story from "@/components/about/Story";
import ValuesMission from "@/components/about/ValuesMission";
import ImageBanner from "@/components/shared/ImageBanner";
import { propertyImages } from "@/lib/propertyImages";

export const metadata: Metadata = {
  title: "About - Michael Aylett",
  description:
    "Michael Aylett's background: from managing Amazon accounts to becoming a professional real estate investor and owner-operator.",
};

export default function AboutPage() {
  return (
    <>
      <AboutHero />
      <Story />
      <ImageBanner
        image={propertyImages.kitchenClassicMaintained}
        eyebrow="Pride of Ownership"
        caption="Properties improved and maintained for long-term ownership."
        height="h-[42vh] md:h-[52vh]"
      />
      <ValuesMission />
    </>
  );
}
