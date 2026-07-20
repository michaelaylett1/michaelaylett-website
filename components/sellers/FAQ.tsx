"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

const FAQS = [
  {
    q: "What is subject-to?",
    a: "It means I take ownership of the property and take over making the monthly mortgage payments, while the existing loan stays in your name. It can offer a faster, more flexible path to selling, but it isn't the right fit for every loan or every seller — we'll talk through whether it makes sense for your situation.",
  },
  {
    q: "What is seller financing?",
    a: "Instead of a cash purchase, you act as the lender: I make agreed-upon payments to you over time, typically with interest. It can create ongoing income and potential tax benefits, and terms are negotiated to work for both sides.",
  },
  {
    q: "Do I still receive monthly payments?",
    a: "With seller financing, yes — that's the structure. With subject-to, no; you're selling the property and I take over the existing payments going forward. With a traditional purchase, you receive your proceeds at closing.",
  },
  {
    q: "Who makes the mortgage payments?",
    a: "In a subject-to purchase, I make the payments once we close, even though the loan remains in your name. We'll walk through exactly how that works, including how payments are documented, before you decide anything.",
  },
  {
    q: "Can I sell if I have little equity?",
    a: "Often, yes. Limited equity is one of the more common reasons sellers explore creative financing in the first place, since it can open up options a traditional sale wouldn't.",
  },
  {
    q: "Do I need to make repairs?",
    a: "Generally no. I purchase properties as-is in most cases, which is part of why sellers with deferred maintenance or repair needs reach out.",
  },
  {
    q: "How quickly can we close?",
    a: "It depends on the structure and the property, but I can typically move faster than a traditional listing process, and we'll agree on a closing date that works for you.",
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="bg-ink text-bone py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-4">Frequently Asked Questions</p>
        <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-xl mb-14">
          Straight answers to the questions sellers ask most.
        </h2>

        <div className="border-t border-line">
          {FAQS.map((f, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={f.q} className="border-b border-line">
                <button
                  className="w-full flex items-center justify-between gap-6 py-6 text-left"
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  aria-expanded={isOpen}
                >
                  <span className="font-display text-lg md:text-xl">{f.q}</span>
                  <Plus
                    size={20}
                    className={`shrink-0 text-brass-light transition-transform duration-300 ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="text-slate leading-relaxed pb-6 max-w-2xl">{f.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
