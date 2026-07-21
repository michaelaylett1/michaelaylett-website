import Link from "next/link";

const POINTS = [
  "A direct conversation about your goals and how you like to invest",
  "Full transparency on how a specific deal is underwritten before you commit",
  "Clear terms, put in writing, before any capital changes hands",
  "Ongoing reporting once a property is acquired and operating",
];

export default function WorkWithPartners() {
  return (
    <section id="schedule" className="bg-paper text-ink py-24 md:py-28">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-start">
          <div>
            <p className="eyebrow text-brass mb-4">How I Work With Partners</p>
            <h2 className="font-display text-3xl md:text-4xl leading-tight">
              A relationship first, a deal second.
            </h2>
            <p className="mt-6 text-ink/70 leading-relaxed max-w-md">
              I&apos;m interested in building long-term relationships with
              qualified capital partners whose goals align with my
              acquisition strategy, and I&apos;d rather build a real
              relationship than rush a single transaction. Here&apos;s what
              that looks like in practice.
            </p>

            <ul className="mt-10 space-y-4">
              {POINTS.map((p) => (
                <li key={p} className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-brass" />
                  <span className="text-ink/85">{p}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border border-line-dark bg-ink text-bone p-8 md:p-10">
            <h3 className="font-display text-2xl">Schedule a Conversation</h3>
            <p className="mt-4 text-slate leading-relaxed text-sm">
              If you&apos;re interested in learning more about partnering on a
              future acquisition, reach out and we&apos;ll set up a time to talk.
            </p>
            <Link
              href="/contact"
              className="mt-8 inline-flex items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
            >
              Get in Touch
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
