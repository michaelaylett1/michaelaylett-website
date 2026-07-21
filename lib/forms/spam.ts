/**
 * Lightweight, dependency-free spam protection shared by every form route.
 *
 * Three layers, in order of cost:
 *  1. Honeypot field: a hidden input real visitors never fill in.
 *  2. Time-trap: rejects submissions completed implausibly fast (bots that
 *     fill and submit a form in under a second).
 *  3. Best-effort in-memory rate limiting per server instance.
 *
 * These are "basic" protections by design, matching what was asked for.
 * They are not a substitute for a dedicated service (e.g. Vercel Firewall,
 * Cloudflare Turnstile, or a Redis-backed rate limiter) if spam becomes a
 * real problem later. See the README for upgrade notes.
 */

export const HONEYPOT_FIELD_NAME = "companyWebsite";
export const FORM_RENDERED_AT_FIELD_NAME = "formRenderedAt";

const MIN_SUBMIT_MS = 1500; // Real humans take at least ~1.5s to fill a form.
const MAX_SUBMIT_MS = 1000 * 60 * 60 * 2; // Reject stale/replayed submissions after 2 hours.

export function isHoneypotTripped(formData: FormData): boolean {
  const value = formData.get(HONEYPOT_FIELD_NAME);
  return typeof value === "string" && value.trim().length > 0;
}

export function isSubmissionTimingSuspicious(formData: FormData): boolean {
  const raw = formData.get(FORM_RENDERED_AT_FIELD_NAME);
  const renderedAt = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(renderedAt)) return true;

  const elapsed = Date.now() - renderedAt;
  return elapsed < MIN_SUBMIT_MS || elapsed > MAX_SUBMIT_MS;
}

// Best-effort, per-instance rate limit. Serverless functions are ephemeral,
// so this only protects against bursts hitting a warm instance. It is
// intentionally simple and requires no external service or env vars.
const submissionLog = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

export function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  const timestamps = (submissionLog.get(identifier) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    submissionLog.set(identifier, timestamps);
    return true;
  }

  timestamps.push(now);
  submissionLog.set(identifier, timestamps);

  // Opportunistically prevent unbounded growth.
  if (submissionLog.size > 5000) {
    for (const [key, values] of submissionLog) {
      if (values.every((t) => now - t > RATE_LIMIT_WINDOW_MS)) {
        submissionLog.delete(key);
      }
    }
  }

  return false;
}

export function getClientIdentifier(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}
