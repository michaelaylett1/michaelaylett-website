/**
 * Shared server-side validation and sanitization helpers for all form API
 * routes. Keeping this logic in one place means every form gets the same
 * baseline protection: trimmed/length-capped strings, HTML-escaped output
 * for the notification email, and consistent required-field checking.
 */

export type FieldErrors = Record<string, string>;

const MAX_SHORT_LENGTH = 300;
const MAX_LONG_LENGTH = 5000;

/**
 * Removes control characters, trims whitespace, and caps length. This is
 * applied to every string value pulled out of form submissions before it
 * touches validation, storage, or the outgoing email.
 */
export function sanitizeString(
  value: FormDataEntryValue | null | undefined,
  { long = false }: { long?: boolean } = {}
): string {
  if (typeof value !== "string") return "";
  // Strip control characters (except newline/tab, which textareas use).
  const stripped = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  const trimmed = stripped.trim();
  const max = long ? MAX_LONG_LENGTH : MAX_SHORT_LENGTH;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Escapes a string for safe inclusion in an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Loose phone check: allow digits, spaces, parentheses, dashes, and a
// leading +. Requires at least 7 digits so obviously-fake input is caught
// without being overly strict about international formats.
const PHONE_PATTERN = /^[+()\d][\d\s().-]{6,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value) && value.length <= 254;
}

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(value) && value.replace(/\D/g, "").length >= 7;
}

/**
 * Validates the universal contact fields (name, email, phone) that every
 * form on the site collects. Returns field-level error messages so the
 * client can show helpful, specific validation feedback.
 */
export function validateContactBasics(fields: {
  name: string;
  email: string;
  phone: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  if (!fields.name || fields.name.length < 2) {
    errors.name = "Please enter your full name.";
  }

  if (!fields.email) {
    errors.email = "Please enter your email address.";
  } else if (!isValidEmail(fields.email)) {
    errors.email = "Please enter a valid email address.";
  }

  if (!fields.phone) {
    errors.phone = "Please enter your phone number.";
  } else if (!isValidPhone(fields.phone)) {
    errors.phone = "Please enter a valid phone number.";
  }

  return errors;
}

export function formatTimestamp(date: Date = new Date()): string {
  return `${date.toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  })} UTC`;
}
