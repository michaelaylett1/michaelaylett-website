"use client";

/**
 * All three topics on this page submit directly to the site's own API
 * routes, which validate the submission, upload any attached files to
 * private storage, and email a notification to michael@michaelaylett.com
 * via Resend. See /api/forms/contact, /api/forms/capital-partner, and
 * /api/forms/rv-park, and lib/forms/ for the shared implementation.
 *
 * The "RV Park" tab renders the same RVParkForm component used on the
 * dedicated /rv-parks page (rendered with `standalone={false}` here so it
 * fits this page's own section/heading instead of bringing its own), so
 * the form's fields, validation, and submission logic only live in one
 * place. See components/rv-parks/RVParkForm.tsx.
 *
 * There is no Amazon Consulting / EcomRanx option on this page. EcomRanx
 * has its own dedicated page at /ecomranx and its own links to
 * ecomranx.com elsewhere on the site; it is a separate, non-real-estate
 * business and intentionally out of scope for this contact form.
 */

import { useState } from "react";
import { useFormSubmission } from "@/lib/forms/useFormSubmission";
import FormHoneypot from "@/components/shared/FormHoneypot";
import FormStatusMessages from "@/components/shared/FormStatusMessages";
import RVParkForm from "@/components/rv-parks/RVParkForm";

type Topic = "sell" | "capital" | "rvpark";

const TOPICS: { id: Topic; label: string }[] = [
  { id: "sell", label: "Selling a Property" },
  { id: "capital", label: "Capital Partnership" },
  { id: "rvpark", label: "RV Park" },
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
/* Capital Partner questionnaire (real submission, with file uploads)     */
/* ---------------------------------------------------------------------- */

const READY_OPTIONS = [
  "Ready now",
  "Within 3 months",
  "3 to 6 months",
  "6 to 12 months",
  "12+ months",
  "Just exploring",
];

const RANGE_OPTIONS = [
  "Under $50K",
  "$50K to $100K",
  "$100K to $250K",
  "$250K to $500K",
  "$500K to $1M",
  "$1M to $3M",
  "$3M to $10M",
  "$10M to $30M",
  "$30 Million+",
];

const HEARD_OPTIONS = [
  "Referral",
  "SubTo Community",
  "Social Media",
  "LinkedIn",
  "BiggerPockets",
  "Real Estate Event",
  "Google Search",
  "Existing Business Relationship",
  "Other",
];

function CapitalPartnerForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [readyToInvest, setReadyToInvest] = useState("");
  const [investmentRange, setInvestmentRange] = useState("");
  const [howHeard, setHowHeard] = useState("");
  const [comments, setComments] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const { isSubmitting, isSuccess, isError, errorMessage, fieldErrors, submit } =
    useFormSubmission("/api/forms/capital-partner");

  const fileNames = files ? Array.from(files).map((f) => f.name) : [];

  const clientCanSubmit =
    firstName && lastName && email && phone && files && files.length > 0 && acknowledged;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttemptedSubmit(true);
    if (!clientCanSubmit) return;

    const formData = new FormData();
    formData.set("firstName", firstName);
    formData.set("lastName", lastName);
    formData.set("email", email);
    formData.set("phone", phone);
    formData.set("readyToInvest", readyToInvest);
    formData.set("investmentRange", investmentRange);
    formData.set("howHeard", howHeard);
    formData.set("comments", comments);
    formData.set("acknowledged", acknowledged ? "true" : "false");
    if (files) {
      Array.from(files).forEach((file) => formData.append("proofOfFunds", file));
    }

    const result = await submit(formData);
    if (result.success) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setReadyToInvest("");
      setInvestmentRange("");
      setHowHeard("");
      setComments("");
      setFiles(null);
      setAcknowledged(false);
      setAttemptedSubmit(false);
    }
  };

  return (
    <form className="max-w-3xl space-y-8" onSubmit={handleSubmit} noValidate>
      <FormHoneypot />

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="firstName" className="eyebrow text-ink/50 block mb-2">
            First Name *
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.firstName)}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          />
          {fieldErrors.firstName && (
            <p className="mt-1.5 text-sm text-red-700">{fieldErrors.firstName}</p>
          )}
        </div>
        <div>
          <label htmlFor="lastName" className="eyebrow text-ink/50 block mb-2">
            Last Name *
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.lastName)}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          />
          {fieldErrors.lastName && (
            <p className="mt-1.5 text-sm text-red-700">{fieldErrors.lastName}</p>
          )}
        </div>
        <div>
          <label htmlFor="email" className="eyebrow text-ink/50 block mb-2">
            Email *
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          />
          {fieldErrors.email && (
            <p className="mt-1.5 text-sm text-red-700">{fieldErrors.email}</p>
          )}
        </div>
        <div>
          <label htmlFor="phone" className="eyebrow text-ink/50 block mb-2">
            Phone Number *
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={Boolean(fieldErrors.phone)}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          />
          {fieldErrors.phone && (
            <p className="mt-1.5 text-sm text-red-700">{fieldErrors.phone}</p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="readyToInvest" className="eyebrow text-ink/50 block mb-2">
            When are you ready to invest?
          </label>
          <select
            id="readyToInvest"
            value={readyToInvest}
            onChange={(e) => setReadyToInvest(e.target.value)}
            className="w-full bg-paper border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          >
            <option value="">Select an option</option>
            {READY_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="investmentRange" className="eyebrow text-ink/50 block mb-2">
            Investment range
          </label>
          <select
            id="investmentRange"
            value={investmentRange}
            onChange={(e) => setInvestmentRange(e.target.value)}
            className="w-full bg-paper border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          >
            <option value="">Select an option</option>
            {RANGE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="howHeard" className="eyebrow text-ink/50 block mb-2">
            How did you hear about Michael?
          </label>
          <select
            id="howHeard"
            value={howHeard}
            onChange={(e) => setHowHeard(e.target.value)}
            className="w-full bg-paper border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          >
            <option value="">Select an option</option>
            {HEARD_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="comments" className="eyebrow text-ink/50 block mb-2">
            Questions or Comments
          </label>
          <textarea
            id="comments"
            rows={6}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass resize-none"
          />
        </div>
      </div>

      {/* Proof of Funds upload */}
      <div className="border border-line-dark p-6">
        <label htmlFor="proofOfFunds" className="eyebrow text-ink/50 block mb-2">
          Proof of Funds *
        </label>
        <p className="text-ink/60 text-sm leading-relaxed mb-4">
          Please upload a recent bank statement, brokerage statement,
          lender letter, or other documentation showing available funds.
          You may redact account numbers and other sensitive identifying
          information. PDF or image files up to 8MB each.
        </p>
        <input
          id="proofOfFunds"
          name="proofOfFunds"
          type="file"
          required
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
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
        {fieldErrors.proofOfFunds && (
          <p className="mt-2 text-sm text-red-700">{fieldErrors.proofOfFunds}</p>
        )}

        <p className="mt-5 border-t border-line-dark pt-4 text-xs text-ink/50 leading-relaxed">
          Documents are uploaded to secure, private storage and are never
          publicly accessible. Only a private link, sent to Michael in the
          notification email, can open them.
        </p>

        <p className="mt-4 text-ink/60 text-sm leading-relaxed">
          Information and documents submitted through this form will be
          used only to evaluate potential partnership opportunities and
          should be handled securely.
        </p>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          required
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-brass"
        />
        <span className="text-ink/75 text-sm leading-relaxed">
          I understand that submitting this form does not constitute an
          investment agreement, offering, or guarantee of participation in
          any transaction.
        </span>
      </label>
      {fieldErrors.acknowledged && (
        <p className="text-sm text-red-700">{fieldErrors.acknowledged}</p>
      )}

      {attemptedSubmit && !clientCanSubmit && (
        <p className="text-sm text-red-700">
          Please complete all required fields, attach at least one Proof of
          Funds file, and check the acknowledgment box before submitting.
        </p>
      )}

      <FormStatusMessages
        isSuccess={isSuccess}
        isError={isError}
        errorMessage={errorMessage}
        successBody="I've received your information and documents securely, and will follow up personally soon."
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full sm:w-fit justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Submitting..." : "Submit Capital Partner Information"}
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

        {topic === "capital" ? (
          <CapitalPartnerForm key="capital" />
        ) : topic === "rvpark" ? (
          <RVParkForm key="rvpark" standalone={false} />
        ) : (
          <SellForm key="sell" />
        )}
      </div>
    </section>
  );
}
