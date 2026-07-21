import { NextResponse } from "next/server";
import {
  getClientIdentifier,
  isHoneypotTripped,
  isRateLimited,
  isSubmissionTimingSuspicious,
} from "./spam";
import { jsonError, jsonSuccess } from "./response";

/**
 * Runs the shared spam checks. Returns a NextResponse to send immediately
 * if the submission should be blocked (or silently "succeeded" for
 * honeypot hits, which keeps automated senders from noticing and adapting),
 * or `null` if the submission should proceed to real validation.
 */
export function runSpamGuards(
  formData: FormData,
  request: Request
): NextResponse | null {
  if (isHoneypotTripped(formData)) {
    // Pretend success so bots don't learn the honeypot was detected.
    return jsonSuccess();
  }

  if (isSubmissionTimingSuspicious(formData)) {
    return jsonError(
      "We couldn't process that submission. Please refresh the page and try again.",
      400
    );
  }

  const identifier = getClientIdentifier(request);
  if (isRateLimited(identifier)) {
    return jsonError(
      "Too many submissions from this connection. Please try again in a minute.",
      429
    );
  }

  return null;
}
