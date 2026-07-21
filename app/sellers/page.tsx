import type { Metadata } from "next";
import SellersHero from "@/components/sellers/Hero";
import WaysIPurchase from "@/components/sellers/WaysIPurchase";
import WhyCreativeFinancing from "@/components/sellers/WhyCreativeFinancing";
import Process from "@/components/sellers/Process";
import FAQ from "@/components/sellers/FAQ";
import SellerForm from "@/components/sellers/SellerForm";
import ImageBanner from "@/components/shared/ImageBanner";
import { propertyImages } from "@/lib/propertyImages";

export const metadata: Metadata = {
  title: "Sell Your Property - Michael Aylett",
  description:
    "Subject-to, seller financing, or subject-to with seller financing: learn how Michael Aylett structures creative-financing property purchases around your goals.",
};

export default function SellersPage() {
  return (
    <>
      <SellersHero />
      <WaysIPurchase />
      <WhyCreativeFinancing />
      <Process />
      <ImageBanner
        image={propertyImages.hallwayNumberedDoors}
        eyebrow="A Real, Managed Property"
        caption="Every property I acquire is professionally managed after closing, not flipped, not left vacant."
        height="h-[46vh] md:h-[56vh]"
      />
      <FAQ />
      <SellerForm />
    </>
  );
}
