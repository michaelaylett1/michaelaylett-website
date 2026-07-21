"use client";

/**
 * All three topics on this page submit directly to the site's own API
 * routes, which validate the submission, upload any attached files to
 * private storage, and email a notification to michael@michaelaylett.com
 * via Resend. See /api/forms/contact, /api/forms/capital-partner, and
 * /api/forms/rv-park, and lib/forms/ for the shared implementation.
 *
 * The "RV Park" and "Capital Partnership" tabs render the same
 * RVParkForm and CapitalPartnerForm components used on the dedicated
 * /rv-parks and /capital-partners pages (rendered with
 * `standalone={false}` here so they fit this page's own section/heading
 * instead of bringing their own), so each form's fields, validation, and
 * submission logic only live in one place. See
 * components/rv-parks/RVParkForm.tsx and
 * components/capital/CapitalPartnerForm.tsx.
 *
 * There is no Amazon Consulting / EcomRanx option on this page. EcomRanx
 * has its own dedicated page at /ecomranx and its own links to
 * ecomranx.com elsewhere on the site; it is a separate, non-real-estate
 * business and intentionally out of scope for this contact form.
 *
 * Tab order is intentionally Selling a Property, RV Park, Capital
 * Partnership, with Selling a Property selected by default.
 */

import { useState } from "react";
import { useFormSubmission } from "@/lib/forms/useFormSubmission";
import FormHoneypot from "@/components/shared/FormHoneypot";
import FormStatusMessages from "@/components/shared/FormStatusMessages";
import RVParkForm from "@/components/rv-parks/RVParkForm";
import CapitalPartnerForm from "@/components/capital/CapitalPartnerForm";

type Topic = "sell" | "rvpark" | "capital";

const TOPICS: { id: Topic; label: string }[] = [
  { id: "sell", label: "Selling a Property" },
  { id: "rvpark", label: "RV Park" },
  { id: "capital", label: "Capital Partnership" },
];

/* ---------------------------------------------------------------------- */
/* Selling a Property (real submission)                                   */
/* ---------------------------------------------------------------------- */

type Field = {
  id: string;
  label: string;
  type: "text" | "email" | "tel" | "date" | "textarea";
  span?: "full";
  required?: boolean;
};

const SELL_FIELDS: Field[] = [
  { id: "name", label: "Name", type: "text", required: true },
  { id: "email", label: "Email", type: "email", required: true },
  { id: "phone", label: "Phone", type: "tel", required: true },
  { id: "address", label: "Property Address", type: "text", span: "full" },
  { id: "value", label: "Estimated Property Value", type: "text" },
  { id: "balance", label: "Mortgage Balance", type: "text" },
  { id: "payment", label: "Monthly Mortgage Payment", type: "text" },
  { id: "rate", label: "Interest Rate", type: "text" },
  { id: "cashNeeded", label: "Cash Needed at Closing", type: "text" },
  { id: "closingDate", label: "Desired Closing Date", type: "date" },
  { id: "situation", label: "Tell me about your situation", type: "textarea", span: "full" },
];

function SellForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const { isSubmitting, isSuccess, isError, errorMessage, fieldErrors, submit } =
    useFormSubmission("/api/forms/contact");

  const set = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    for (const f of SELL_FIELDS) {
      formData.set(f.id, values[f.id] || "");
    }
    const result = await submit(formData);
    if (result.success) setValues({});
  };

  return (
    <form className="grid sm:grid-cols-2 gap-6 max-w-3xl" onSubmit={handleSubmit} noValidate>
      <FormHoneypot />

      {SELL_FIELDS.map((f) => (
        <div key={f.id} className={f.span === "full" ? "sm:col-span-2" : ""}>
          <label htmlFor={f.id} className="eyebrow text-ink/50 block mb-2">
            {f.label}
            {f.required && <span className="text-brass"> *</span>}
          </label>
          {f.type === "textarea" ? (
            <textarea
              id={f.id}
              name={f.id}
              rows={4}
              value={values[f.id] || ""}
              onChange={(e) => set(f.id, e.target.value)}
              className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink placeholder:text-ink/30 focus:border-brass outline-none resize-none"
            />
          ) : (
            <input
              id={f.id}
              name={f.id}
              type={f.type}
              value={values[f.id] || ""}
              onChange={(e) => set(f.id, e.target.value)}
              aria-invalid={Boolean(fieldErrors[f.id])}
              className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink placeholder:text-ink/30 focus:border-brass outline-none"
            />
          )}
          {fieldErrors[f.id] && (
            <p className="mt-1.5 text-sm text-red-700">{fieldErrors[f.id]}</p>
          )}
        </div>
      ))}

      <FormStatusMessages
        isSuccess={isSuccess}
        isError={isError}
        errorMessage={errorMessage}
        successBody="I've received your message and will follow up personally soon."
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="sm:col-span-2 mt-2 inline-flex w-full sm:w-fit justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Sending..." : "Send Message"}
      </button>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/* Top-level selector                                                    */
/* ---------------------------------------------------------------------- */

export default function ContactSelector() {
  const [topic, setTopic] = useState<Topic>("sell");

  return (
    <section className="bg-paper text-ink py-16 md:py-20">
      <div className="mx-auto max-w-content px-6 md:px-10">
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

        {topic === "rvpark" ? (
          <RVParkForm key="rvpark" standalone={false} />
        ) : topic === "capital" ? (
          <CapitalPartnerForm key="capital" standalone={false} />
        ) : (
          <SellForm key="sell" />
        )}
      </div>
    </section>
  );
}
