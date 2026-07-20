"use client";

import { useState } from "react";

const EMAIL = "michael@ecomranx.com"; // TODO: replace with real contact email

const FIELDS: {
  id: string;
  label: string;
  type: "text" | "email" | "tel" | "date" | "textarea";
  span?: "full";
}[] = [
  { id: "name", label: "Name", type: "text" },
  { id: "email", label: "Email", type: "email" },
  { id: "phone", label: "Phone", type: "tel" },
  { id: "address", label: "Property Address", type: "text", span: "full" },
  { id: "value", label: "Estimated Property Value", type: "text" },
  { id: "balance", label: "Mortgage Balance", type: "text" },
  { id: "payment", label: "Monthly Mortgage Payment", type: "text" },
  { id: "rate", label: "Interest Rate", type: "text" },
  { id: "cashNeeded", label: "Cash Needed at Closing", type: "text" },
  { id: "closingDate", label: "Desired Closing Date", type: "date" },
  { id: "situation", label: "Tell me about your situation", type: "textarea", span: "full" },
];

export default function SellerForm() {
  const [values, setValues] = useState<Record<string, string>>({});

  const set = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));

  const body = FIELDS.map((f) => `${f.label}: ${values[f.id] || "—"}`).join("\n");
  const mailtoHref = `mailto:${EMAIL}?subject=${encodeURIComponent(
    `Property Inquiry — ${values.address || "New Submission"}`
  )}&body=${encodeURIComponent(body)}`;

  return (
    <section id="contact-form" className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="max-w-2xl mb-12">
          <p className="eyebrow text-brass mb-4">Get Started</p>
          <h2 className="font-display text-3xl md:text-4xl leading-tight">
            Tell me about your property.
          </h2>
          <p className="mt-5 text-ink/70 leading-relaxed">
            Share a few details and I&apos;ll follow up personally. There&apos;s
            no obligation, and everything here stays confidential.
          </p>
        </div>

        <form
          className="grid sm:grid-cols-2 gap-6 max-w-3xl"
          onSubmit={(e) => e.preventDefault()}
        >
          {FIELDS.map((f) => (
            <div key={f.id} className={f.span === "full" ? "sm:col-span-2" : ""}>
              <label htmlFor={f.id} className="eyebrow text-ink/50 block mb-2">
                {f.label}
              </label>
              {f.type === "textarea" ? (
                <textarea
                  id={f.id}
                  rows={4}
                  value={values[f.id] || ""}
                  onChange={(e) => set(f.id, e.target.value)}
                  className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink placeholder:text-ink/30 focus:border-brass outline-none resize-none"
                />
              ) : (
                <input
                  id={f.id}
                  type={f.type}
                  value={values[f.id] || ""}
                  onChange={(e) => set(f.id, e.target.value)}
                  className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink placeholder:text-ink/30 focus:border-brass outline-none"
                />
              )}
            </div>
          ))}

          <a
            href={mailtoHref}
            className="sm:col-span-2 mt-2 inline-flex w-full sm:w-fit justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
          >
            Send My Information
          </a>
        </form>
      </div>
    </section>
  );
}
