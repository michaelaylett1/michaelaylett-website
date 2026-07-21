"use client";

/**
 * DEVELOPER CONFIGURATION NOTE
 * -----------------------------------------------------------------------
 * The "Selling a Property" and "Amazon Consulting" forms below submit via
 * a mailto: link, which works without a backend but cannot carry file
 * attachments and depends on the visitor's device having a mail client
 * configured.
 *
 * The "Capital Partnership" form includes a required Proof of Funds file
 * upload. Browsers cannot attach files to a mailto: link, so file uploads
 * are NOT currently wired to a working backend. Before launch, connect
 * the Proof of Funds field (and ideally the rest of this form) to a real
 * form-handling service that supports secure file uploads, for example:
 *
 *   - Jotform (an existing Jotform for this exact questionnaire already
 *     lives at https://form.jotform.com/252527587810160 and is linked
 *     below as a working fallback in the meantime)
 *   - Formspree (with file upload support enabled on a paid plan)
 *   - Basin or Uploadcare, paired with a serverless function
 *
 * Whichever service you choose, set its endpoint / API key as an
 * environment variable (e.g. NEXT_PUBLIC_CAPITAL_FORM_ENDPOINT) and
 * replace the handleCapitalSubmit function below with a fetch() call to
 * that endpoint. Never commit uploaded financial documents, API keys, or
 * form submissions to this repository.
 * -----------------------------------------------------------------------
 */

import { useState } from "react";

const EMAIL = "michael@ecomranx.com"; // TODO: replace with real contact email
const CAPITAL_JOTFORM = "https://form.jotform.com/252527587810160";

type Topic = "sell" | "capital" | "ecomranx";

const TOPICS: { id: Topic; label: string }[] = [
  { id: "sell", label: "Selling a Property" },
  { id: "capital", label: "Capital Partnership" },
  { id: "ecomranx", label: "Amazon Consulting" },
];

/* ---------------------------------------------------------------------- */
/* Simple field sets: Selling a Property / Amazon Consulting              */
/* ---------------------------------------------------------------------- */

type Field = {
  id: string;
  label: string;
  type: "text" | "email" | "tel" | "date" | "textarea";
  span?: "full";
};

const FIELD_SETS: Record<"sell" | "ecomranx", Field[]> = {
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
  ecomranx: [
    { id: "name", label: "Name", type: "text" },
    { id: "email", label: "Email", type: "email" },
    { id: "company", label: "Company / Brand Name", type: "text" },
    { id: "store", label: "Amazon Store or Website", type: "text" },
    { id: "message", label: "Tell me about your account", type: "textarea", span: "full" },
  ],
};

const SUBJECTS: Record<"sell" | "ecomranx", string> = {
  sell: "Property Inquiry",
  ecomranx: "Amazon Consulting Inquiry",
};

function SimpleForm({ topic }: { topic: "sell" | "ecomranx" }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));

  const fields = FIELD_SETS[topic];
  const body = fields.map((f) => `${f.label}: ${values[f.id] || "Not provided"}`).join("\n");
  const mailtoHref = `mailto:${EMAIL}?subject=${encodeURIComponent(
    SUBJECTS[topic]
  )}&body=${encodeURIComponent(body)}`;

  return (
    <form
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
  );
}

/* ---------------------------------------------------------------------- */
/* Capital Partner questionnaire                                         */
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

  const fileNames = files ? Array.from(files).map((f) => f.name) : [];

  const canSubmit =
    firstName && lastName && email && phone && files && files.length > 0 && acknowledged;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAttemptedSubmit(true);
    if (!canSubmit) return;

    // NOTE: mailto cannot carry file attachments. This is a temporary
    // fallback until a real upload-capable endpoint is connected (see the
    // developer note at the top of this file).
    const body = [
      `First Name: ${firstName}`,
      `Last Name: ${lastName}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      `Ready to invest: ${readyToInvest || "Not provided"}`,
      `Investment range: ${investmentRange || "Not provided"}`,
      `How they heard about Michael: ${howHeard || "Not provided"}`,
      `Questions or comments: ${comments || "Not provided"}`,
      `Proof of funds files selected (not attached, see note): ${
        fileNames.length ? fileNames.join(", ") : "None"
      }`,
    ].join("\n");

    window.location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(
      "Capital Partnership Inquiry"
    )}&body=${encodeURIComponent(body)}`;
  };

  return (
    <form className="max-w-3xl space-y-8" onSubmit={handleSubmit}>
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="firstName" className="eyebrow text-ink/50 block mb-2">
            First Name *
          </label>
          <input
            id="firstName"
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="eyebrow text-ink/50 block mb-2">
            Last Name *
          </label>
          <input
            id="lastName"
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          />
        </div>
        <div>
          <label htmlFor="email" className="eyebrow text-ink/50 block mb-2">
            Email *
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          />
        </div>
        <div>
          <label htmlFor="phone" className="eyebrow text-ink/50 block mb-2">
            Phone Number *
          </label>
          <input
            id="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
          />
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
          information.
        </p>
        <input
          id="proofOfFunds"
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

        <div className="mt-5 border-t border-line-dark pt-4 text-xs text-ink/50 leading-relaxed">
          Online upload for this field is being connected to a secure
          document service. Until that&apos;s live, files selected here are
          listed in your submission but are not actually transmitted. To
          make sure your documents reach us securely right now, please use
          our{" "}
          <a
            href={CAPITAL_JOTFORM}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-brass"
          >
            secure capital partner application
          </a>
          , which supports file uploads today.
        </div>

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

      {attemptedSubmit && !canSubmit && (
        <p className="text-sm text-red-700">
          Please complete all required fields, attach at least one Proof of
          Funds file, and check the acknowledgment box before submitting.
        </p>
      )}

      <button
        type="submit"
        className="inline-flex w-full sm:w-fit justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors disabled:opacity-50"
      >
        Submit Capital Partner Information
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
        ) : (
          <SimpleForm key={topic} topic={topic} />
        )}
      </div>
    </section>
  );
}
