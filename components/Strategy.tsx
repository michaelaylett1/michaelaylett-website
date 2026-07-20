const TIMELINE = [
  { label: "Rehab", months: "1–3", width: 3, tone: "bg-ink/30" },
  { label: "Stabilizing", months: "4–6", width: 3, tone: "bg-brass/50" },
  { label: "Payouts (12-mo COC window)", months: "7–18", width: 12, tone: "bg-moss" },
];
const TOTAL = TIMELINE.reduce((a, t) => a + t.width, 0);

const RISKS = [
  {
    t: "Co-living structure",
    d: "Multiple residents per home means one vacancy doesn't erase the property's income the way it would in a single-tenant rental.",
  },
  {
    t: "Underwritten reserves",
    d: "Every deal includes reserves for unexpected repairs, so surprises don't interrupt distributions.",
  },
  {
    t: "Careful tenant screening",
    d: "PadSplit screens every applicant, and I personally phone-interview residents to make sure they're a fit for the home.",
  },
  {
    t: "Long-term equity",
    d: "Beyond monthly cash flow, partners benefit from principal paydown and appreciation over the hold period.",
  },
];

export default function Strategy() {
  return (
    <section id="strategy" className="bg-paper text-ink py-24 md:py-32">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass mb-4">03 — Investment Strategy</p>
        <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-2xl">
          Why co-living — and why PadSplit specifically.
        </h2>
        <p className="mt-6 max-w-2xl text-ink/70 leading-relaxed">
          PadSplit is a co-living marketplace that turns single-family homes
          into furnished, private rooms with utilities and Wi-Fi included.
          It gives residents an affordable place to live — often well below
          the cost of a one-bedroom apartment in the same city — and gives
          the property multiple income streams instead of one.
        </p>

        {/* Signature element: stabilization timeline */}
        <div className="mt-20">
          <p className="eyebrow text-ink/50 mb-6">From closing to first full year of payouts</p>

          <div className="flex w-full h-14 md:h-16 overflow-hidden border border-line-dark">
            {TIMELINE.map((t) => (
              <div
                key={t.label}
                className={`${t.tone} flex items-center justify-center relative`}
                style={{ width: `${(t.width / TOTAL) * 100}%` }}
              >
                <span className="eyebrow text-ink/60 hidden md:inline">
                  Mo. {t.months}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5 grid sm:grid-cols-3 gap-6">
            {TIMELINE.map((t) => (
              <div key={t.label} className="flex items-start gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 ${t.tone.replace("/30", "").replace("/50", "")}`} />
                <div>
                  <div className="font-medium text-ink">{t.label}</div>
                  <div className="eyebrow text-ink/50 mt-1">Months {t.months}</div>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 max-w-2xl text-ink/70 leading-relaxed text-sm">
            The cash-on-cash return quoted on any deal is calculated only
            across the 12 months of payouts after stabilization — never the
            rehab or lease-up period — because that&apos;s the window that
            actually reflects how the property performs.
          </p>
        </div>

        {/* Risk mitigation */}
        <div className="mt-24 grid md:grid-cols-2 gap-x-12 gap-y-10">
          {RISKS.map((r) => (
            <div key={r.t} className="border-t border-line-dark pt-5">
              <h3 className="font-display text-xl">{r.t}</h3>
              <p className="mt-2 text-ink/70 leading-relaxed text-sm">{r.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
