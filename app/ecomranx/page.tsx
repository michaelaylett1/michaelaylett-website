import type { Metadata } from "next";
import EcomRanxHero from "@/components/ecomranx/Hero";
import Services from "@/components/ecomranx/Services";
import Experience from "@/components/ecomranx/Experience";
import CaseStudies from "@/components/ecomranx/CaseStudies";
import CTA from "@/components/ecomranx/CTA";

export const metadata: Metadata = {
  title: "EcomRanx - Amazon Consulting by Michael Aylett",
  description:
    "EcomRanx is an independent Amazon consulting company founded by Michael Aylett, offering account management, advertising, and growth strategy for established brands.",
};

export default function EcomRanxPage() {
  return (
    <div className="bg-graphite">
      <EcomRanxHero />
      <Services />
      <Experience />
      <CaseStudies />
      <CTA />
    </div>
  );
}
