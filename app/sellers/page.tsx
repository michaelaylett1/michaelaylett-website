import type { Metadata } from "next";
import SellersHero from "@/components/sellers/Hero";
import WaysIPurchase from "@/components/sellers/WaysIPurchase";
import WhyCreativeFinancing from "@/components/sellers/WhyCreativeFinancing";
import Process from "@/components/sellers/Process";
import FAQ from "@/components/sellers/FAQ";
import SellerForm from "@/components/sellers/SellerForm";

export const metadata: Metadata = {
  title: "Sell Your Property — Michael Aylett",
  description:
    "Traditional purchase, seller financing, or subject-to — learn how Michael Aylett structures property purchases around your goals.",
};

export default function SellersPage() {
  return (
    <>
      <SellersHero />
      <WaysIPurchase />
      <WhyCreativeFinancing />
      <Process />
      <FAQ />
      <SellerForm />
    </>
  );
}
