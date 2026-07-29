import { NextRequest, NextResponse } from "next/server";
import { lookupCountyFromAddress } from "@/lib/propertyTax/countyLookup";

/**
 * Server-side automatic county lookup used by the Underwriting page's
 * Property Tax section ("Suggested from property address"). Reads
 * GOOGLE_MAPS_API_KEY (a server-only environment variable, never sent to
 * the browser) and calls Google's Geocoding API on the client's behalf,
 * exactly the same pattern app/api/transit/auto-lookup/route.ts already
 * uses for the automatic transit lookup -- so that key never has to be
 * exposed client-side, unlike NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY,
 * which is intentionally public and restricted to the Maps Embed API
 * only.
 *
 * Always returns a 200 with a JSON body describing what happened
 * (found / notFound / error), even when the lookup itself failed -- the
 * client already knows how to fall back to manual county entry for any
 * of those, so a county-lookup failure never blocks the rest of
 * underwriting.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ status: "error", reason: "not_configured" });
  }

  let address = "";
  try {
    const body = (await req.json()) as { address?: unknown };
    if (typeof body?.address === "string") address = body.address;
  } catch {
    return NextResponse.json({ status: "error", reason: "request_failed" }, { status: 400 });
  }

  address = address.trim();
  if (address.length < 5) {
    return NextResponse.json({ status: "error", reason: "request_failed" }, { status: 400 });
  }

  try {
    const result = await lookupCountyFromAddress(address, apiKey);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ status: "error", reason: "request_failed" });
  }
}
