import type { Metadata } from "next";
import CapitalHero from "@/components/capital/Hero";
import WhoIAm from "@/components/capital/WhoIAm";
import Philosophy from "@/components/capital/Philosophy";
import FeaturedProperties from "@/components/capital/FeaturedProperties";
import WorkWithPartners from "@/components/capital/WorkWithPartners";
import Testimonials from "@/components/capital/Testimonials";
import CapitalPartnerForm from "@/components/capital/CapitalPartnerForm";
import ImageBanner from "@/components/shared/ImageBanner";
import { propertyImages } from "@/lib/propertyImages";

export const metadata: Metadata = {
  title: "Capital Partners - Michael Aylett",
  description:
    "Learn how Michael Aylett underwrites, acquires, and operates real estate, and how he works with qualified capital partners.",
};

export default function CapitalPartnersPage() {
  return (
    <>
      <CapitalHero />
      <WhoIAm />
      <ImageBanner
        image={propertyImages.aerialNeighborhood}
        eyebrow="Target Markets"
        caption="Focused on markets with strong long-term rental fundamentals, not wherever happens to be trending."
        height="h-[46vh] md:h-[56vh]"
      />
      <Philosophy />
      <FeaturedProperties />
      <WorkWithPartners />
      <Testimonials />
      <CapitalPartnerForm />
    </>
  );
}
