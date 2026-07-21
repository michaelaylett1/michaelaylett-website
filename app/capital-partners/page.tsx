import type { Metadata } from "next";
import CapitalHero from "@/components/capital/Hero";
import WhoIAm from "@/components/capital/WhoIAm";
import Philosophy from "@/components/capital/Philosophy";
import WorkWithPartners from "@/components/capital/WorkWithPartners";

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
      <Philosophy />
      <WorkWithPartners />
    </>
  );
}
