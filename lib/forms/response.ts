import { NextResponse } from "next/server";
import type { FieldErrors } from "./validate";

export function jsonSuccess(): NextResponse {
  return NextResponse.json({ success: true }, { status: 200 });
}

export function jsonError(
  message: string,
  status = 400,
  fieldErrors?: FieldErrors
): NextResponse {
  return NextResponse.json(
    { success: false, error: message, fieldErrors },
    { status }
  );
}

/**
 * Standard handler for the catch-all block in every form route: logs a
 * tagged, non-sensitive summary of the failure (never the request body,
 * uploaded file contents, or API keys) to the Vercel Function log, then
 * returns a safe, generic message to the visitor. Use this instead of
 * inventing a new console.error format per route so failures are easy to
 * grep for in production logs (search "[forms:" in Vercel's Runtime Logs).
 */
export function jsonServerError(formTag: string, err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[forms:${formTag}] Unhandled error: ${message}`);
  return jsonError(
    "Something went wrong while sending your submission. Please try again in a moment, or email michael@michaelaylett.com directly.",
    500
  );
}
