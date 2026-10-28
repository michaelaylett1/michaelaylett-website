import { NextRequest, NextResponse } from "next/server";
import { classifyGoogleFailure, sanitizeGoogleDetail } from "@/lib/transit/googleErrors";

/**
 * Server-side fallback for Property Address autocomplete. The primary
 * path runs in the browser (Maps JavaScript API "places" library, using
 * the public NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY, which is subject to
 * HTTP-referrer restrictions). If that path fails for any reason -- the
 * script is blocked, the public key's referrer/API restrictions don't
 * cover Places, an ad blocker interferes -- the page transparently
 * retries here instead, using the private server key
 * (GOOGLE_MAPS_API_KEY) against Places API (New) Autocomplete. The
 * private key never leaves the server; the browser only sees the
 * resulting suggestion text.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ status: "error", kind: "not_configured", detail: "GOOGLE_MAPS_API_KEY is not set" });
  }
  let input = "";
  let sessionToken: string | undefined;
  try {
    const body = (await req.json()) as { input?: unknown; sessionToken?: unknown };
    if (typeof body?.input === "string") input = body.input.trim();
    if (typeof body?.sessionToken === "string" && /^[A-Za-z0-9_-]{8,36}$/.test(body.sessionToken)) sessionToken = body.sessionToken;
  } catch {
    return NextResponse.json({ status: "error", kind: "unknown", detail: "bad request body" }, { status: 400 });
  }
  if (input.length < 3 || input.length > 200) return NextResponse.json({ status: "ok", suggestions: [] });

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "suggestions.placePrediction.text.text,suggestions.placePrediction.placeId",
      },
      body: JSON.stringify({
        input,
        includedRegionCodes: ["us"],
        includedPrimaryTypes: ["street_address", "premise", "subpremise"],
        regionCode: "us",
        ...(sessionToken ? { sessionToken } : {}),
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      suggestions?: Array<{ placePrediction?: { text?: { text?: string }; placeId?: string } }>;
      error?: { status?: string; message?: string; code?: number };
    } | null;
    if (!res.ok) {
      const kind = classifyGoogleFailure(body?.error?.status || String(res.status), body?.error?.message);
      const detail = sanitizeGoogleDetail(`${body?.error?.status || res.status}: ${body?.error?.message || ""}`);
      console.error(`[autocomplete proxy] failed: kind=${kind} detail=${detail}`);
      return NextResponse.json({ status: "error", kind, detail });
    }
    const suggestions = (body?.suggestions || [])
      .map((s) => ({ text: s.placePrediction?.text?.text || "", placeId: s.placePrediction?.placeId || "" }))
      .filter((s) => s.text);
    return NextResponse.json({ status: "ok", suggestions });
  } catch (err) {
    const detail = sanitizeGoogleDetail(err);
    console.error(`[autocomplete proxy] network error: ${detail}`);
    return NextResponse.json({ status: "error", kind: "network", detail });
  }
}
