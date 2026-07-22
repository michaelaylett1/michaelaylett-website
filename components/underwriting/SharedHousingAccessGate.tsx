"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Lock } from "lucide-react";

// sessionStorage (not localStorage) is used deliberately: it keeps a
// visitor unlocked for the rest of the current browser tab/session
// (surviving a refresh) without granting permanent access that would
// persist after the browser is closed. The value is only ever "granted";
// the actual password check happens server-side in
// /api/shared-housing-auth, so the password itself never appears in this
// file or in any client-side JavaScript bundle.
const SESSION_KEY = "shared-housing-calculator-access";

type GateStatus = "checking" | "locked" | "unlocked";

export default function SharedHousingAccessGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GateStatus>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const granted = window.sessionStorage.getItem(SESSION_KEY) === "granted";
    setStatus(granted ? "unlocked" : "locked");
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/shared-housing-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({ success: false }));

      if (res.ok && data.success) {
        window.sessionStorage.setItem(SESSION_KEY, "granted");
        setPassword("");
        setStatus("unlocked");
      } else {
        setError("Incorrect password. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleLock() {
    window.sessionStorage.removeItem(SESSION_KEY);
    setPassword("");
    setError("");
    setStatus("locked");
  }

  // Avoids a flash of the password screen (or the calculator) before the
  // sessionStorage check above has run on mount.
  if (status === "checking") {
    return <section className="min-h-[60vh] bg-ink" aria-hidden="true" />;
  }

  if (status === "locked") {
    return (
      <section className="relative overflow-hidden bg-ink bg-noise min-h-[70vh] flex items-center pt-32 pb-16 md:pt-40 md:pb-20">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(237,231,218,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(237,231,218,0.6) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        <div className="relative mx-auto max-w-content px-6 md:px-10 w-full">
          <div className="mx-auto max-w-md bg-paper text-ink px-8 py-10 md:px-10 md:py-12">
            <div className="flex items-center gap-2 text-brass mb-4">
              <Lock size={18} />
              <span className="eyebrow">Private Calculator</span>
            </div>
            <h1 className="font-display text-3xl leading-tight">Shared Housing Calculator</h1>
            <p className="mt-4 text-ink/70 leading-relaxed">
              This calculator is private. Enter the password to continue.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="shared-housing-password" className="block eyebrow text-ink/60 mb-2">
                  Password
                </label>
                <input
                  id="shared-housing-password"
                  type="password"
                  autoComplete="off"
                  autoFocus
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError("");
                  }}
                  className="w-full bg-transparent border border-line-dark px-4 py-3 text-ink outline-none focus:border-brass"
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || password.length === 0}
                className="inline-flex w-full sm:w-fit justify-center items-center bg-brass text-ink px-7 py-3.5 font-medium hover:bg-brass-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Checking..." : "Access Calculator"}
              </button>
            </form>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      {children}
      <div className="bg-paper border-t border-line-dark py-6">
        <div className="mx-auto max-w-content px-6 md:px-10 flex justify-end">
          <button
            type="button"
            onClick={handleLock}
            className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
          >
            <Lock size={14} />
            Lock Calculator
          </button>
        </div>
      </div>
    </>
  );
}
