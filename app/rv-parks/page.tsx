import type { Metadata } from "next";
import RVParksHero from "@/components/rv-parks/Hero";
import BuyBox from "@/components/rv-parks/BuyBox";
import WhatWeLookFor from "@/components/rv-parks/WhatWeLookFor";
import FlexibleStructures from "@/components/rv-parks/FlexibleStructures";
import RVParkForm from "@/components/rv-parks/RVParkForm";

export const metadata: Metadata = {
  title: "RV Parks - Michael Aylett",
  description:
    "Michael Aylett acquires established RV parks using flexible and creative financing structures, including seller financing and subject-to transactions.",
};

export default function RVParksPage() {
  return (
    <>
      <RVParksHero />
      <BuyBox />
      <WhatWeLookFor />
      <FlexibleStructures />
      <RVParkForm />
    </>
  );
}
