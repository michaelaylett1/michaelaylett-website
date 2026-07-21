"use client";

/**
 * DEVELOPER CONFIGURATION NOTE
 * -----------------------------------------------------------------------
 * This form submits via a mailto: link, which works without a backend but
 * cannot carry file attachments. The "Financials or Property Documents"
 * upload field below is NOT currently wired to a working backend for that
 * reason.
 *
 * Before launch, connect this field (and ideally the rest of the form) to
 * a real form-handling service that supports secure file uploads, for
 * example Jotform, Formspree with file uploads enabled, Basin, or
 * Uploadcare paired with a serverless function. Set the service's
 * endpoint or API key as an environment variable (for example
 * NEXT_PUBLIC_RV_PARK_FORM_ENDPOINT) and replace the handleSubmit
 * function below with a fetch() call to that endpoint.
 *
 * Never commit uploaded financial documents, API keys, or real form
 * submissions to this repository.
 * -----------------------------------------------------------------------
 */

import { useState } from "react";

const EMAIL = "michael@ecomranx.com"; // TODO: replace with real contact email

type Field = {
  id: string;
  label: string;
  type: "text" | "email" | "tel" | "url";
  span?: "full";
};

const FIELDS: Field[] = [
  { id: "name", label: "Name", type: "text" },
  { id: "email", label: "Email", type: "email" },
  { id: "phone", label: "Phone", type: "tel" },
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

export default function RVParkForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sellerFinancing, setSellerFinancing] = useState("");
  const [comments, setComments] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);

  const set = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));
  const fileNames = files ? Array.from(files).map((f) => f.name) : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = [
      ...FIELDS.map((f) => `${f.label}: ${values[f.id] || "Not provided"}`),
      `Seller financing available: ${sellerFinancing || "Not provided"}`,
      `Additional comments: ${comments || "Not provided"}`,
      `Documents selected (not attached, see note above the upload field): ${
        fileNames.length ? fileNames.join(", ") : "None"
      }`,
    ].join("\n");

    window.location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(
      `RV Park Submission: ${values.propertyName || "New Submission"}`
    )}&body=${encodeURIComponent(body)}`;
  };

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

        <form className="grid sm:grid-cols-2 gap-6 max-w-3xl" onSubmit={handleSubmit}>
          {FIELDS.map((f) => (
            <div key={f.id} className={f.span === "full" ? "sm:col-span-2" : ""}>
              <label htmlFor={f.id} className="eyebrow text-ink/50 block mb-2">
                {f.label}
              </label>
              <input
                id={f.id}
                type={f.type}
                value={values[f.id] || ""}
                onChange={(e) => set(f.id, e.target.value)}
                className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
              />
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
              offering memorandum, if available.
            </p>
            <input
              id="rvDocs"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
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
            <p className="mt-5 border-t border-line-dark pt-4 text-xs text-ink/50 leading-relaxed">
              Online upload for this field is not yet connected to a secure
              document service. Files selected here are listed in your
              submission but are not actually transmitted. If you would
              rather send documents directly, email them to {EMAIL} after
              submitting this form.
            </p>
          </div>

          <button
            type="submit"
            className="sm:col-span-2 mt-2 inline-flex w-full sm:w-fit justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
          >
            Submit RV Park
          </button>
        </form>
      </div>
    </section>
  );
}
