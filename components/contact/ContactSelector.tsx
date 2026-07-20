"use client";

import { useState } from "react";

const EMAIL = "michael@ecomranx.com"; // TODO: replace with real contact email

type Topic = "sell" | "capital" | "ecomranx";

const TOPICS: { id: Topic; label: string }[] = [
  { id: "sell", label: "Selling a Property" },
  { id: "capital", label: "Capital Partnership" },
  { id: "ecomranx", label: "Amazon Consulting" },
];

type Field = {
  id: string;
  label: string;
  type: "text" | "email" | "tel" | "date" | "textarea";
  span?: "full";
};

const FIELD_SETS: Record<Topic, Field[]> = {
  sell: [
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
  ],
  capital: [
    { id: "name", label: "Name", type: "text" },
    { id: "email", label: "Email", type: "email" },
    { id: "phone", label: "Phone", type: "tel" },
    { id: "background", label: "Investing Background", type: "text", span: "full" },
    { id: "message", label: "What are you hoping to discuss?", type: "textarea", span: "full" },
  ],
  ecomranx: [
    { id: "name", label: "Name", type: "text" },
    { id: "email", label: "Email", type: "email" },
    { id: "company", label: "Company / Brand Name", type: "text" },
    { id: "store", label: "Amazon Store or Website", type: "text" },
    { id: "message", label: "Tell me about your account", type: "textarea", span: "full" },
  ],
};

const SUBJECTS: Record<Topic, string> = {
  sell: "Property Inquiry",
  capital: "Capital Partnership Inquiry",
  ecomranx: "Amazon Consulting Inquiry",
};

export default function ContactSelector() {
  const [topic, setTopic] = useState<Topic>("sell");
  const [values, setValues] = useState<Record<string, string>>({});

  const set = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));

  const fields = FIELD_SETS[topic];
  const body = fields.map((f) => `${f.label}: ${values[f.id] || "—"}`).join("\n");
  const mailtoHref = `mailto:${EMAIL}?subject=${encodeURIComponent(
    SUBJECTS[topic]
  )}&body=${encodeURIComponent(body)}`;

  return (
    <section className="bg-paper text-ink py-16 md:py-20">
      <div className="mx-auto max-w-content px-6 md:px-10">
        {/* topic selector */}
        <div className="flex flex-wrap gap-3 mb-14">
          {TOPICS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTopic(t.id)}
              className={`eyebrow px-5 py-3 border transition-colors ${
                topic === t.id
                  ? "bg-ink text-bone border-ink"
                  : "border-line-dark text-ink/60 hover:border-brass"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form
          key={topic}
          className="grid sm:grid-cols-2 gap-6 max-w-3xl"
          onSubmit={(e) => e.preventDefault()}
        >
          {fields.map((f) => (
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
            Send Message
          </a>
        </form>
      </div>
    </section>
  );
}
