"use client";

/**
 * Capital Partner questionnaire: real submission, with a required Proof of
 * Funds file upload. Submits to /api/forms/capital-partner, which
 * validates the fields, uploads any files to a private Vercel Blob store,
 * and emails a "New Capital Partner Submission" notification to
 * michael@michaelaylett.com. See lib/forms/ for the shared implementation.
 *
 * This is the single implementation used by both the "Capital Partnership"
 * tab on /contact (embedded, `standalone={false}`) and the bottom of the
 * /capital-partners page (`standalone={true}`, the default), so field
 * changes, validation, uploads, and submission logic only need to be
 * updated here.
 */

import { useState } from "react";
import { useFormSubmission } from "@/lib/forms/useFormSubmission";
import FormHoneypot from "@/components/shared/FormHoneypot";
import FormStatusMessages from "@/components/shared/FormStatusMessages";

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

type CapitalPartnerFormProps = {
  /**
   * When true (default), renders the full section used at the bottom of
   * the `/capital-partners` page: background, padding, and an "Interested
   * in Partnering?" heading/intro copy above the form.
   *
   * When false, renders just the `<form>` itself with no outer section or
   * heading, so it can be embedded inside another page's own layout (the
   * "Capital Partnership" tab on `/contact`, whose ContactSelector already
   * provides the surrounding section, padding, and tab label).
   */
  standalone?: boolean;
};

export default function CapitalPartnerForm({
  standalone = true,
}: CapitalPartnerFormProps = {}) {
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

  const form = (
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

  if (!standalone) {
    return form;
  }

  return (
    <section id="capital-partner-form" className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="max-w-2xl mb-12">
          <p className="eyebrow text-brass mb-4">Interested in Partnering?</p>
          <h2 className="font-display text-3xl md:text-4xl leading-tight">
            Tell me about your investment goals.
          </h2>
          <p className="mt-5 text-ink/70 leading-relaxed">
            If you are a qualified capital partner interested in future
            acquisitions, share a few details below. There is no obligation,
            and everything here stays confidential.
          </p>
        </div>

        {form}
      </div>
    </section>
  );
}
