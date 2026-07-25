import { NextResponse } from "next/server";
import { runTransitLookup, TransitLookupError } from "@/lib/transit/lookup";
import { looksLikeCompleteAddress } from "@/lib/transit/evaluate";
import type {
  TransitLookupRequestBody,
  TransitLookupResponseBody,
  TransitMaxWalkSetting,
} from "@/lib/transit/types";

export const runtime = "nodejs";

// In-flight request de-duplication (spec section 6/18: "Do not perform
// multiple simultaneous requests for the same address"), scoped to this
// server instance. The client also guards against duplicate submissions,
// but this is a second, server-side backstop for the same rule.
const inFlight = new Map<string, Promise<TransitLookupResponseBody>>();

function isValidMaxWalkSetting(value: unknown): value is TransitMaxWalkSetting {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.mode === "time" || v.mode === "distance") &&
    typeof v.minutes === "number" &&
    typeof v.miles === "number" &&
    Number.isFinite(v.minutes) &&
    Number.isFinite(v.miles)
  );
}

export async function POST(request: Request) {
  let body: TransitLookupRequestBody & { maxWalkSetting?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<TransitLookupResponseBody>(
      { success: false, errorCode: "unknown", error: "Invalid request body." },
      { status: 400 }
    );
  }

  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!looksLikeCompleteAddress(address)) {
    return NextResponse.json<TransitLookupResponseBody>(
      {
        success: false,
        errorCode: "incomplete_address",
        error: "Please enter a complete property address, including city, state, and ZIP code.",
      },
      { status: 400 }
    );
  }

  const maxWalkSetting = isValidMaxWalkSetting(body.maxWalkSetting) ? body.maxWalkSetting : undefined;
  const forceRefresh = body.forceRefresh === true;
  const dedupeKey = `${address.toLowerCase()}|${forceRefresh ? "force" : "cached"}`;

  const existing = inFlight.get(dedupeKey);
  if (existing) {
    const result = await existing;
    return NextResponse.json<TransitLookupResponseBody>(result);
  }

  const task = (async (): Promise<TransitLookupResponseBody> => {
    try {
      const result = await runTransitLookup(address, { forceRefresh, maxWalkSetting });
      return { success: true, result };
    } catch (err) {
      if (err instanceof TransitLookupError) {
        // Non-sensitive summary only -- never the API key or raw
        // provider response, matching the logging convention in
        // lib/forms/response.ts.
        console.error(`[transit:lookup] ${err.code}: ${err.message}`);
        return { success: false, errorCode: err.code, error: err.message, diagnostics: err.diagnostics };
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[transit:lookup] Unhandled error: ${message}`);
      return {
        success: false,
        errorCode: "unknown",
        error: "Transit lookup failed unexpectedly. Please try again.",
      };
    }
  })();

  inFlight.set(dedupeKey, task);
  try {
    const result = await task;
    const status = result.success ? 200 : result.errorCode === "incomplete_address" ? 400 : 502;
    return NextResponse.json<TransitLookupResponseBody>(result, { status });
  } finally {
    inFlight.delete(dedupeKey);
  }
}
