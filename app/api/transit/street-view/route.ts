import { NextRequest, NextResponse } from "next/server";
import { classifyGoogleFailure, sanitizeGoogleDetail } from "@/lib/transit/googleErrors";
import { computeHeadingDegrees } from "@/lib/transit/streetViewGeo";

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
 * Before requesting the (paid) image, this route first calls the Street
 * View Static API's metadata endpoint -- a free request that reports
 * whether imagery actually exists near the given location without
 * billing for an image -- and only proceeds to fetch the image if the
 * metadata reports status "OK". This matters because the paid image
 * endpoint itself returns an HTTP 200 "Sorry, we have no imagery here"
 * placeholder image, not an error status, when nothing is available at
 * a location, so skipping the metadata check would let the printable
 * report silently embed that placeholder instead of a real photo. The
 * metadata response's own resolved pano_id/location is used for the
 * actual image request, so the print image is pinned to the exact same
 * panorama the metadata check confirmed exists (rather than re-deriving
 * "nearest" separately and risking a mismatch).
 *
 * This is defense-in-depth on top of (not a replacement for) the
 * client-side availability check: in normal operation this route is
 * only ever requested with the coordinates of a panorama that
 * google.maps.StreetViewService.getPanorama() already confirmed exists
 * client-side (see PropertyStreetView in SharedHousingCalculator.tsx),
 * using the exact lat/lng/heading the live page is showing, so the
 * printed image matches what the user saw interactively. A failure or
 * "no imagery" result from this route only affects the printable
 * report image -- it cannot affect, and is never read by, the
 * interactive on-page Street View viewer, which is a fully independent
 * code path (google.maps.StreetViewPanorama rendered client-side via
 * the public NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY, not this route).
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
  // Optional target (the property itself): when supplied and no explicit
  // heading is given, the camera is aimed from the panorama's resolved
  // location toward the property (computed below, after the metadata
  // check). Used by the on-page static fallback, which has no
  // client-side panorama lookup to take a heading from.
  const targetLat = parseCoord(params.get("targetLat"));
  const targetLng = parseCoord(params.get("targetLng"));
  let heading = headingParsed === null ? 0 : ((headingParsed % 360) + 360) % 360;
  const pitchParsed = parseCoord(params.get("pitch"));
  const pitch = pitchParsed === null ? 0 : Math.max(-90, Math.min(90, pitchParsed));

  if (lat === null || lng === null) {
    return NextResponse.json({ error: "missing_coordinates" }, { status: 400 });
  }

  // Free metadata pre-check: confirms imagery actually exists near
  // (lat,lng) -- and gives back the exact panorama's own location --
  // before spending a paid image request on it. See the file-header
  // comment for why this matters (the image endpoint alone can't tell
  // "no imagery" apart from a real photo).
  const metadataUrl =
    `https://maps.googleapis.com/maps/api/streetview/metadata` +
    `?location=${lat},${lng}` +
    `&source=outdoor` +
    `&key=${apiKey}`;

  let imageLat = lat;
  let imageLng = lng;

  try {
    const metaRes = await fetch(metadataUrl);
    if (!metaRes.ok) {
      console.error(`[street-view route] metadata request failed with HTTP ${metaRes.status}`);
      return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
    }
    const meta = (await metaRes.json()) as {
      status?: string;
      location?: { lat?: number; lng?: number };
    };
    if (meta.status !== "OK") {
      // ZERO_RESULTS (no imagery), REQUEST_DENIED (key/API-config
      // problem), INVALID_REQUEST, OVER_QUERY_LIMIT, etc. -- none of
      // these mean an image exists to fetch, so stop here rather than
      // requesting (and billing for) the paid placeholder image.
      console.error(
        `[street-view route] metadata status "${meta.status}"${(meta as { error_message?: string }).error_message ? ` -- ${sanitizeGoogleDetail((meta as { error_message?: string }).error_message)}` : ""}; no image request made.`
      );
      return NextResponse.json(
        {
          error: meta.status === "ZERO_RESULTS" ? "no_imagery" : "api_error",
          kind: classifyGoogleFailure(meta.status, (meta as { error_message?: string }).error_message),
          metadataStatus: meta.status ?? "UNKNOWN",
        },
        { status: meta.status === "ZERO_RESULTS" ? 404 : 502 }
      );
    }
    // Pin the image request to the metadata's own resolved panorama
    // location, if present, so the fetched image matches exactly what
    // the metadata check confirmed exists (rather than re-deriving
    // "nearest" a second time via the image endpoint's own snapping).
    if (typeof meta.location?.lat === "number" && typeof meta.location?.lng === "number") {
      imageLat = meta.location.lat;
      imageLng = meta.location.lng;
      if (headingParsed === null && targetLat !== null && targetLng !== null) {
        heading = Math.round(computeHeadingDegrees({ lat: imageLat, lng: imageLng }, { lat: targetLat, lng: targetLng }));
      }
    }
  } catch (err) {
    console.error("[street-view route] metadata request threw:", err);
    return NextResponse.json({ error: "request_failed" }, { status: 502 });
  }

  // 640x400 at the API's own max free-tier resolution for a single
  // request -- large enough to inspect the driveway, curb space, and
  // frontage once printed, while keeping a fixed 8:5 aspect ratio the
  // print layout can size predictably.
  const streetViewUrl =
    `https://maps.googleapis.com/maps/api/streetview` +
    `?size=640x400` +
    `&location=${imageLat},${imageLng}` +
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
  } catch (err) {
    console.error("[street-view route] image request threw:", err);
    return NextResponse.json({ error: "request_failed" }, { status: 502 });
  }
}
