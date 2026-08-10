import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for a static, print-safe Property Street View
 * image -- the printable underwriting report's "Property Street View"
 * section (mirrors app/api/transit/static-map/route.ts, the existing
 * server-side proxy for the walking-route map, almost exactly).
 *
 * This route fetches the image from the Google Street View Static API
 * entirely server-side using GOOGLE_MAPS_API_KEY (the same private,
 * server-only key already used by /api/transit/auto-lookup and
 * /api/transit/static-map -- never NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_
 * KEY, the intentionally public, browser-facing key the interactive
 * on-page panorama uses instead). The browser only ever requests this
 * app's own /api/transit/street-view URL with plain lat/lng/heading
 * query params (never the API key), and this route streams back the
 * resulting image bytes -- so the private key never appears in any
 * browser-visible markup, network request, or JS bundle.
 *
 * Deliberately does not perform its own availability check (the Street
 * View Static API returns an HTTP 200 "Sorry, we have no imagery here"
 * placeholder image, not an error status, when nothing is available at
 * a location -- so a request-level check here could not reliably tell
 * the two cases apart anyway). Availability is instead determined once,
 * client-side, by the same google.maps.StreetViewService.getPanorama()
 * call that powers the interactive on-page panorama (see
 * PropertyStreetView in SharedHousingCalculator.tsx) -- this route is
 * only ever requested with the coordinates of a panorama that call
 * already confirmed exists, using the exact lat/lng/heading the live
 * page is showing, so the printed image always matches what the user
 * saw interactively.
 */
export const runtime = "nodejs";
// This response depends entirely on per-request query params (a
// different property/panorama/heading every time) -- never statically
// cache or prerender it.
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
  const lat = parseCoord(params.get("lat"));
  const lng = parseCoord(params.get("lng"));
  // Heading defaults to 0 (north) if not supplied; the client always
  // supplies the same heading (panorama location -> property location)
  // the interactive panorama initializes with, so the printed frame
  // matches the live page.
  const headingParsed = parseCoord(params.get("heading"));
  const heading = headingParsed === null ? 0 : ((headingParsed % 360) + 360) % 360;
  const pitchParsed = parseCoord(params.get("pitch"));
  const pitch = pitchParsed === null ? 0 : Math.max(-90, Math.min(90, pitchParsed));

  if (lat === null || lng === null) {
    return NextResponse.json({ error: "missing_coordinates" }, { status: 400 });
  }

  // 640x400 at the API's own max free-tier resolution for a single
  // request -- large enough to inspect the driveway, curb space, and
  // frontage once printed, while keeping a fixed 8:5 aspect ratio the
  // print layout can size predictably.
  const streetViewUrl =
    `https://maps.googleapis.com/maps/api/streetview` +
    `?size=640x400` +
    `&location=${lat},${lng}` +
    `&heading=${heading}` +
    `&pitch=${pitch}` +
    `&fov=90` +
    `&source=outdoor` +
    `&key=${apiKey}`;

  try {
    const res = await fetch(streetViewUrl);
    if (!res.ok) {
      return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const bytes = await res.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Street View imagery for a given panorama does not change
        // within a session, so a short private cache avoids re-fetching
        // the same frame repeatedly while the report is open or
        // reprinted.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "request_failed" }, { status: 502 });
  }
}
