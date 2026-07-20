"use client";

import { useState } from "react";
import { Linkedin, Mail, ArrowUpRight } from "lucide-react";

const EMAIL = "michael@ecomranx.com"; // TODO: replace with real contact email
const LINKEDIN = "https://www.linkedin.com/in/themichaela/";
const INVESTOR_FORM = "https://form.jotform.com/252527587810160";

export default function Contact() {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("Capital Partnership");
  const [message, setMessage] = useState("");

  const mailtoHref = `mailto:${EMAIL}?subject=${encodeURIComponent(
    `${reason} — from ${name || "your website"}`
  )}&body=${encodeURIComponent(message)}`;

  return (
    <section id="contact" className="bg-ink text-bone py-24 md:py-32">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <p className="eyebrow text-brass-light mb-4">06 — Contact</p>
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-20">
          <div>
            <h2 className="font-display text-3xl md:text-4xl leading-tight max-w-lg">
              Interested in partnering, or growing your Amazon brand? Let&apos;s talk.
            </h2>
            <p className="mt-6 text-slate leading-relaxed max-w-md">
              Whether you&apos;re exploring a capital partnership on the next
              co-living deal or want EcomRanx to look at your Amazon
              account, reach out directly.
            </p>

            <div className="mt-10 space-y-4">
              <a
                href={INVESTOR_FORM}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between border border-line px-6 py-4 hover:border-brass/60 transition-colors group"
              >
                <span>Apply as an investor partner</span>
                <ArrowUpRight
                  size={18}
                  className="text-slate group-hover:text-brass-light transition-colors"
                />
              </a>
              <a
                href={LINKEDIN}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between border border-line px-6 py-4 hover:border-brass/60 transition-colors group"
              >
                <span className="flex items-center gap-3">
                  <Linkedin size={18} className="text-slate" />
                  Connect on LinkedIn
                </span>
                <ArrowUpRight
                  size={18}
                  className="text-slate group-hover:text-brass-light transition-colors"
                />
              </a>
              <a
                href={`mailto:${EMAIL}`}
                className="flex items-center justify-between border border-line px-6 py-4 hover:border-brass/60 transition-colors group"
              >
                <span className="flex items-center gap-3">
                  <Mail size={18} className="text-slate" />
                  {EMAIL}
                </span>
                <ArrowUpRight
                  size={18}
                  className="text-slate group-hover:text-brass-light transition-colors"
                />
              </a>
            </div>
          </div>

          <form
            className="border border-line bg-ink-2 p-8 md:p-10 space-y-6"
            onSubmit={(e) => e.preventDefault()}
          >
            <div>
              <label className="eyebrow text-slate block mb-2" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-transparent border border-line px-4 py-3 text-bone placeholder:text-slate/60 focus:border-brass/60 outline-none"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="eyebrow text-slate block mb-2" htmlFor="reason">
                I&apos;m reaching out about
              </label>
              <select
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full bg-ink border border-line px-4 py-3 text-bone outline-none focus:border-brass/60"
              >
                <option>Capital Partnership</option>
                <option>Amazon Consulting (EcomRanx)</option>
                <option>Something else</option>
              </select>
            </div>

            <div>
              <label className="eyebrow text-slate block mb-2" htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="w-full bg-transparent border border-line px-4 py-3 text-bone placeholder:text-slate/60 focus:border-brass/60 outline-none resize-none"
                placeholder="A little about what you're looking for..."
              />
            </div>

            <a
              href={mailtoHref}
              className="inline-flex w-full sm:w-auto justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors"
            >
              Send Message
            </a>
          </form>
        </div>
      </div>
    </section>
  );
}
