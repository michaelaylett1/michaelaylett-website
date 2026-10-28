import { NextRequest, NextResponse } from "next/server";
import { lookupNearestBusStopByWalking } from "@/lib/transit/googleLookup";
import { sanitizeGoogleDetail } from "@/lib/transit/googleErrors";

/**
 * Server-side automatic bus-stop lookup used by the Underwriting page's
 * "Transit and Bus Stop Access" section. Reads GOOGLE_MAPS_API_KEY (a
 * server-only environment variable, never sent to the browser) and
 * calls Google's Geocoding, Places, and Directions/Routes APIs on the
 * client's behalf so that key never has to be exposed client-side.
 *
 * Accepts optional `lat`/`lng` (from /api/maps/geocode) so the address
 * is not geocoded a second time. Always returns a 200 with a JSON body
 * describing what happened (found / notFound / error); error bodies now
 * carry a specific `kind`, `stage`, and key-redacted `detail` so the
 * client and server logs can tell an API-authorization problem from a
 * quota problem from a bad address.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("[auto-lookup] GOOGLE_MAPS_API_KEY is not set in this deployment's environment.");
    return NextResponse.json({ status: "error", reason: "not_configured", kind: "not_configured" });
  }

  let address = "";
  let lat: number | null = null;
  let lng: number | null = null;
  try {
    const body = (await req.json()) as { address?: unknown; lat?: unknown; lng?: unknown };
    if (typeof body?.address === "string") address = body.address;
    if (typeof body?.lat === "number" && typeof body?.lng === "number") {
      lat = body.lat;
      lng = body.lng;
    }
  } catch {
    return NextResponse.json({ status: "error", reason: "request_failed" }, { status: 400 });
  }

  address = address.trim();
  if (address.length < 5) {
    return NextResponse.json({ status: "error", reason: "request_failed" }, { status: 400 });
  }

  try {
    const result = await lookupNearestBusStopByWalking(
      address,
      apiKey,
      lat !== null && lng !== null ? { lat, lng } : undefined
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[auto-lookup] unexpected error:", sanitizeGoogleDetail(err));
    return NextResponse.json({ status: "error", reason: "request_failed", kind: "unknown", detail: sanitizeGoogleDetail(err) });
  }
}
