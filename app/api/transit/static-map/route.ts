import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for a static, print-safe transit map image.
 *
 * The printable underwriting report needs a map showing the property,
 * the nearest bus stop, and the walking route between them as a plain
 * <img>, not the live page's interactive Maps Embed iframe -- browser
 * print/PDF output can crop or omit an iframe entirely, but a same-
 * origin <img> rasterizes reliably every time.
 *
 * This route builds the Google Static Maps API request and fetches the
 * image entirely server-side using GOOGLE_MAPS_API_KEY (the existing
 * private, server-only key already used by /api/transit/auto-lookup --
 * never NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY, which is the
 * intentionally public, Embed-API-only key). The browser only ever
 * requests this app's own /api/transit/static-map URL with plain
 * geographic query params (never the API key), and this route streams
 * back the resulting image bytes -- so the private key never appears
 * in any browser-visible markup, network request, or JS bundle.
 *
 * All coordinates and the encoded route polyline are passed in as query
 * params by the client, sourced from the same lookupNearestBusStopByWalking
 * result already shown on the live underwriting page (see
 * lib/transit/googleLookup.ts and the auto-lookup useEffect in
 * SharedHousingCalculator.tsx) -- this route never performs its own
 * Places/Directions lookup or picks a different bus stop, it only
 * renders whatever winning result the client already has.
 */
export const runtime = "nodejs";
// GET route handlers can otherwise be statically cached/prerendered by
// Next.js -- this one's entire response depends on per-request query
// params (a different property/stop/route every time), so it must
// always run dynamically, never serve a cached response for a
// different property.
export const dynamic = "force-dynamic";

function parseCoord(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 404 });
  }

  const params = req.nextUrl.searchParams;
  const propertyLat = parseCoord(params.get("propertyLat"));
  const propertyLng = parseCoord(params.get("propertyLng"));
  const stopLat = parseCoord(params.get("stopLat"));
  const stopLng = parseCoord(params.get("stopLng"));
  const polyline = params.get("polyline");

  if (propertyLat === null || propertyLng === null || stopLat === null || stopLng === null) {
    return NextResponse.json({ error: "missing_coordinates" }, { status: 400 });
  }

  // 640x400 at scale=2 (1280x800 actual pixels) -- large enough for the
  // route line, both markers, and any Google-drawn labels to stay
  // readable once printed, while keeping a fixed 8:5 aspect ratio the
  // client can size predictably without layout shift or page-break
  // surprises.
  const markerProperty = `color:0x1a73e8|label:P|${propertyLat},${propertyLng}`;
  const markerStop = `color:red|label:B|${stopLat},${stopLng}`;
  // Prefer the actual walking-route polyline captured from the same
  // Directions API response that produced the walking time/distance
  // shown on the live page; fall back to a straight line only in the
  // rare case that response had no usable overview polyline, so the
  // map still shows *something* connecting the two points.
  const path = polyline
    ? `color:0x1a73e8ff|weight:4|enc:${polyline}`
    : `color:0x1a73e8ff|weight:4|${propertyLat},${propertyLng}|${stopLat},${stopLng}`;

  const staticMapUrl =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?size=640x400` +
    `&scale=2` +
    `&format=png` +
    `&markers=${encodeURIComponent(markerProperty)}` +
    `&markers=${encodeURIComponent(markerStop)}` +
    `&path=${encodeURIComponent(path)}` +
    `&key=${apiKey}`;

  try {
    const res = await fetch(staticMapUrl);
    if (!res.ok) {
      return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
    }
    const contentType = res.headers.get("content-type") || "image/png";
    const bytes = await res.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Same underwriting session's transit result does not change
        // once found, so a short private cache is safe and avoids
        // re-fetching the same image repeatedly while the report is
        // open or reprinted.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "request_failed" }, { status: 502 });
  }
}
