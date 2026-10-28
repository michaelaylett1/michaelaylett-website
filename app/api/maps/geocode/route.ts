import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/transit/googleLookup";

/**
 * Server-side geocoding for the Underwriting page's Property Address.
 *
 * Why this exists as its own route: previously the property's
 * latitude/longitude (which Street View needs) only ever came back as a
 * side effect of the nearest-bus-stop lookup, so any failure in the
 * Places/Directions steps -- or in the bus-stop pipeline as a whole --
 * also took Street View down with it. Geocoding is now an independent
 * first step that works for any complete address, whether it was picked
 * from the autocomplete dropdown or typed by hand, and returns the
 * formatted address, coordinates, state, and county in one call.
 *
 * Uses GOOGLE_MAPS_API_KEY (server-only). Always responds 200 with a
 * JSON body; errors carry a specific `kind` and a key-redacted `detail`.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("[geocode] GOOGLE_MAPS_API_KEY is not set in this deployment's environment.");
    return NextResponse.json({ status: "error", kind: "not_configured", detail: "GOOGLE_MAPS_API_KEY is not set" });
  }
  let address = "";
  try {
    const body = (await req.json()) as { address?: unknown };
    if (typeof body?.address === "string") address = body.address.trim();
  } catch {
    return NextResponse.json({ status: "error", kind: "unknown", detail: "bad request body" }, { status: 400 });
  }
  if (address.length < 5) {
    return NextResponse.json({ status: "error", kind: "address_not_found", detail: "address too short" }, { status: 400 });
  }
  const result = await geocodeAddress(address, apiKey);
  if (!result.ok) {
    console.error(`[geocode] failed: kind=${result.kind} detail=${result.detail}`);
    return NextResponse.json({ status: "error", kind: result.kind, detail: result.detail });
  }
  return NextResponse.json({
    status: "found",
    latitude: result.location.lat,
    longitude: result.location.lng,
    formattedAddress: result.formattedAddress,
    stateAbbreviation: result.stateAbbreviation,
    county: result.county,
  });
}
