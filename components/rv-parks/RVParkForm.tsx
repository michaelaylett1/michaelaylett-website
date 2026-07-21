"use client";

import { useState } from "react";
import { useFormSubmission } from "@/lib/forms/useFormSubmission";
import FormHoneypot from "@/components/shared/FormHoneypot";
import FormStatusMessages from "@/components/shared/FormStatusMessages";

type Field = {
  id: string;
  label: string;
  type: "text" | "email" | "tel" | "url";
  span?: "full";
  required?: boolean;
};

const FIELDS: Field[] = [
  { id: "name", label: "Name", type: "text", required: true },
  { id: "email", label: "Email", type: "email", required: true },
  { id: "phone", label: "Phone", type: "tel", required: true },
  { id: "propertyName", label: "Property Name", type: "text" },
  { id: "propertyAddress", label: "Property Address", type: "text", span: "full" },
  { id: "askingPrice", label: "Asking Price", type: "text" },
  { id: "existingPads", label: "Number of Existing RV Pads", type: "text" },
  { id: "additionalPads", label: "Additional Approved or Possible Pads", type: "text" },
  { id: "annualRevenue", label: "Annual Revenue", type: "text" },
  { id: "annualNOI", label: "Annual NOI", type: "text" },
  { id: "occupancy", label: "Occupancy", type: "text" },
  { id: "siteMix", label: "Long-Term Versus Short-Term Site Mix", type: "text" },
  { id: "mortgageBalance", label: "Existing Mortgage Balance", type: "text" },
  { id: "interestRate", label: "Interest Rate", type: "text" },
  { id: "cashAtClosing", label: "Desired Cash at Closing", type: "text" },
  { id: "listingLink", label: "Link to Listing or Offering Memorandum", type: "url", span: "full" },
];

const SELLER_FINANCING_OPTIONS = ["Yes", "No", "Possibly, open to discussion"];

type RVParkFormProps = {
  /**
   * When true (default), renders the full section used on the `/rv-parks`
   * page: background, padding, and the "Submit an RV Park" heading/intro
   * copy above the form.
   *
   * When false, renders just the `<form>` itself with no outer section or
   * heading, so it can be embedded inside another page's own layout (for
   * example the "RV Park" tab on `/contact`, whose ContactSelector already
   * provides the surrounding section, padding, and tab label). This is the
   * single form implementation used by both pages, so field changes,
   * validation, uploads, and submission logic only need to be updated here.
   */
  standalone?: boolean;
};

export default function RVParkForm({ standalone = true }: RVParkFormProps = {}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sellerFinancing, setSellerFinancing] = useState("");
  const [comments, setComments] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const { isSubmitting, isSuccess, isError, errorMessage, fieldErrors, submit } =
    useFormSubmission("/api/forms/rv-park");

  const set = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));
  const fileNames = files ? Array.from(files).map((f) => f.name) : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    for (const f of FIELDS) {
      formData.set(f.id, values[f.id] || "");
    }
    formData.set("sellerFinancing", sellerFinancing);
    formData.set("comments", comments);
    if (files) {
      Array.from(files).forEach((file) => formData.append("rvDocs", file));
    }

    const result = await submit(formData);
    if (result.success) {
      setValues({});
      setSellerFinancing("");
      setComments("");
      setFiles(null);
    }
  };

  const form = (
    <form className="grid sm:grid-cols-2 gap-6 max-w-3xl" onSubmit={handleSubmit} noValidate>
      <FormHoneypot />

      {FIELDS.map((f) => (
        <div key={f.id} className={f.span === "full" ? "sm:col-span-2" : ""}>
          <label htmlFor={f.id} className="eyebrow text-ink/50 block mb-2">
            {f.label}
            {f.required && <span className="text-brass"> *</span>}
          </label>
          <input
            id={f.id}
            name={f.id}
            type={f.type}
            value={values[f.id] || ""}
            onChange={(e) => set(f.id, e.target.value)}
            aria-invalid={Boolean(fieldErrors[f.id])}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          />
          {fieldErrors[f.id] && (
            <p className="mt-1.5 text-sm text-red-700">{fieldErrors[f.id]}</p>
          )}
        </div>
      ))}

      <div className="sm:col-span-2">
        <label htmlFor="sellerFinancing" className="eyebrow text-ink/50 block mb-2">
          Is Seller Financing Available?
        </label>
        <select
          id="sellerFinancing"
          value={sellerFinancing}
          onChange={(e) => setSellerFinancing(e.target.value)}
          className="w-full bg-paper-2 border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
        >
          <option value="">Select an option</option>
          {SELLER_FINANCING_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="comments" className="eyebrow text-ink/50 block mb-2">
          Additional Comments
        </label>
        <textarea
          id="comments"
          rows={5}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass resize-none"
        />
      </div>

      <div className="sm:col-span-2 border border-line-dark p-6">
        <label htmlFor="rvDocs" className="eyebrow text-ink/50 block mb-2">
          Financials or Property Documents
        </label>
        <p className="text-ink/60 text-sm leading-relaxed mb-4">
          Rent rolls, profit and loss statements, a site plan, or an
          offering memorandum, if available. PDF, image, spreadsheet, or
          Word files up to 8MB each.
        </p>
        <input
          id="rvDocs"
          name="rvDocs"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv,.doc,.docx"
          onChange={(e) => setFiles(e.target.files)}
          className="w-full text-sm text-ink/80 file:mr-4 file:py-2.5 file:px-5 file:border file:border-line-dark file:bg-paper-2 file:text-ink file:eyebrow hover:file:border-brass file:cursor-pointer"
        />
        {fileNames.length > 0 && (
          <ul className="mt-3 text-ink/60 text-sm list-disc list-inside">
            {fileNames.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {fieldErrors.rvDocs && (
          <p className="mt-2 text-sm text-red-700">{fieldErrors.rvDocs}</p>
        )}
        <p className="mt-5 border-t border-line-dark pt-4 text-xs text-ink/50 leading-relaxed">
          Documents are uploaded to secure, private storage and are never
          publicly accessible. Only a private link, sent to Michael in the
          notification email, can open them.
        </p>
      </div>

      <FormStatusMessages
        isSuccess={isSuccess}
        isError={isError}
        errorMessage={errorMessage}
        successBody="I've received the property details and any documents you attached, and will follow up soon."
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="sm:col-span-2 mt-2 inline-flex w-full sm:w-fit justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Submitting..." : "Submit RV Park"}
      </button>
    </form>
  );

  if (!standalone) {
    return form;
  }

  return (
    <section id="rv-form" className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="max-w-2xl mb-12">
          <p className="eyebrow text-brass mb-4">Submit an RV Park</p>
          <h2 className="font-display text-3xl md:text-4xl leading-tight">
            Tell us about the property.
          </h2>
          <p className="mt-5 text-ink/70 leading-relaxed">
            Share what you know, even if some fields are estimates. We will
            follow up directly with any questions.
          </p>
        </div>

        {form}
      </div>
    </section>
  );
}
