import type { Metadata } from "next";
import ContactHero from "@/components/contact/Hero";
import ContactSelector from "@/components/contact/ContactSelector";

export const metadata: Metadata = {
  title: "Contact - Michael Aylett",
  description:
    "Reach out about selling a property, a capital partnership, or Amazon consulting with EcomRanx.",
};

export default function ContactPage() {
  return (
    <>
      <ContactHero />
      <ContactSelector />
    </>
  );
}
