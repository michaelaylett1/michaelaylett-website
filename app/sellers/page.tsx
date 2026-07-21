import type { Metadata } from "next";
import SellersHero from "@/components/sellers/Hero";
import WaysIPurchase from "@/components/sellers/WaysIPurchase";
import WhyCreativeFinancing from "@/components/sellers/WhyCreativeFinancing";
import LongTermOwnership from "@/components/sellers/LongTermOwnership";
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
      <LongTermOwnership />
      <Process />
      <FAQ />
      <ImageBanner
        image={propertyImages.hallwayNumberedDoors}
        eyebrow="Ready When You Are"
        caption="Let's talk about your property and the options that could work for you."
        height="h-[42vh] md:h-[50vh]"
      />
      <SellerForm />
    </>
  );
}
