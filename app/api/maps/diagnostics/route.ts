import { NextRequest, NextResponse } from "next/server";
import { classifyGoogleFailure, sanitizeGoogleDetail, type GoogleFailureKind } from "@/lib/transit/googleErrors";

/**
 * Google Maps configuration self-test. Open
 *   https://<your-domain>/api/maps/diagnostics?pw=<underwriting password>
 * in a browser (optionally &address=...) and it calls every Google API
 * this site depends on, using the SAME environment variables the live
 * site uses, and reports for each one whether it worked and -- if not --
 * Google's own reason (API not enabled, key restricted, billing, quota,
 * ...). Nothing here ever returns an API key; Google's messages are
 * passed through sanitizeGoogleDetail() first.
 *
 * Gated by the same password as the Underwriting page so it is not a
 * public probe. The browser-key checks send a Referer header equal to
 * the site's own origin, so they exercise the same HTTP-referrer
 * restrictions real visitors hit.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PASSWORD = process.env.SHARED_HOUSING_CALCULATOR_PASSWORD || "9590";
const DEFAULT_ADDRESS = "3255 River Run Trl, Decatur, GA 30034";

interface Check {
  key: "server" | "browser";
  api: string;
  usedFor: string;
  ok: boolean;
  kind?: GoogleFailureKind;
  detail?: string;
  note?: string;
}

async function timedFetch(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, text, json };
  } finally {
    clearTimeout(t);
  }
}

function legacyCheck(key: Check["key"], api: string, usedFor: string, r: { status: number; json: unknown }, okStatuses = ["OK"]): Check {
  const j = (r.json || {}) as { status?: string; error_message?: string };
  if (j.status && okStatuses.includes(j.status)) return { key, api, usedFor, ok: true, detail: j.status };
  const kind = classifyGoogleFailure(j.status || String(r.status), j.error_message);
  return { key, api, usedFor, ok: false, kind, detail: sanitizeGoogleDetail(`${j.status || r.status}${j.error_message ? `: ${j.error_message}` : ""}`) };
}

function newCheck(key: Check["key"], api: string, usedFor: string, r: { status: number; json: unknown }): Check {
  if (r.status >= 200 && r.status < 300) return { key, api, usedFor, ok: true, detail: `HTTP ${r.status}` };
  const e = ((r.json || {}) as { error?: { status?: string; message?: string } }).error || {};
  const kind = classifyGoogleFailure(e.status || String(r.status), e.message);
  return { key, api, usedFor, ok: false, kind, detail: sanitizeGoogleDetail(`${e.status || r.status}${e.message ? `: ${e.message}` : ""}`) };
}

async function safe(fn: () => Promise<Check>, key: Check["key"], api: string, usedFor: string): Promise<Check> {
  try {
    return await fn();
  } catch (err) {
    return { key, api, usedFor, ok: false, kind: "network", detail: sanitizeGoogleDetail(err) };
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (params.get("pw") !== PASSWORD) {
    return NextResponse.json({ error: "Add ?pw=<underwriting password> to the URL." }, { status: 401 });
  }
  const address = params.get("address")?.trim() || DEFAULT_ADDRESS;
  const serverKey = process.env.GOOGLE_MAPS_API_KEY || "";
  const browserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY || "";
  const origin = params.get("origin") || `https://${req.headers.get("host") || "michaelaylett.com"}`;

  const env = {
    GOOGLE_MAPS_API_KEY: serverKey ? "set" : "MISSING",
    NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY: browserKey ? "set" : "MISSING",
    refererUsedForBrowserKeyChecks: origin + "/",
  };

  const checks: Check[] = [];
  let lat = 33.7;
  let lng = -84.3;

  if (!serverKey) {
    checks.push({
      key: "server", api: "(all server features)", usedFor: "Bus stop lookup, geocoding, county, printable Street View/map",
      ok: false, kind: "not_configured", detail: "GOOGLE_MAPS_API_KEY is not set in this deployment (Vercel > Settings > Environment Variables).",
    });
  } else {
    const geo = await safe(async () => {
      const r = await timedFetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${serverKey}`);
      const loc = (r.json as { results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }> } | null)?.results?.[0]?.geometry?.location;
      if (loc) {
        lat = loc.lat;
        lng = loc.lng;
      }
      return legacyCheck("server", "Geocoding API", "Address -> coordinates, state, county", r);
    }, "server", "Geocoding API", "Address -> coordinates, state, county");
    checks.push(geo);

    checks.push(await safe(async () => legacyCheck("server", "Places API (legacy) Nearby Search", "Bus stop discovery (primary)", await timedFetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&rankby=distance&type=bus_station&key=${serverKey}`), ["OK", "ZERO_RESULTS"]),
      "server", "Places API (legacy) Nearby Search", "Bus stop discovery (primary)"));

    checks.push(await safe(async () => newCheck("server", "Places API (New) searchNearby", "Bus stop discovery (automatic fallback)", await timedFetch(
      "https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": serverKey, "X-Goog-FieldMask": "places.id" },
        body: JSON.stringify({ includedTypes: ["bus_station"], maxResultCount: 1, locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 3000 } } }),
      })), "server", "Places API (New) searchNearby", "Bus stop discovery (automatic fallback)"));

    checks.push(await safe(async () => legacyCheck("server", "Directions API (legacy)", "Walking route (primary)", await timedFetch(
      `https://maps.googleapis.com/maps/api/directions/json?origin=${lat},${lng}&destination=${lat + 0.002},${lng + 0.002}&mode=walking&key=${serverKey}`), ["OK", "ZERO_RESULTS"]),
      "server", "Directions API (legacy)", "Walking route (primary)"));

    checks.push(await safe(async () => newCheck("server", "Routes API (computeRoutes)", "Walking route (automatic fallback)", await timedFetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": serverKey, "X-Goog-FieldMask": "routes.duration" },
        body: JSON.stringify({ origin: { location: { latLng: { latitude: lat, longitude: lng } } }, destination: { location: { latLng: { latitude: lat + 0.002, longitude: lng + 0.002 } } }, travelMode: "WALK" }),
      })), "server", "Routes API (computeRoutes)", "Walking route (automatic fallback)"));

    checks.push(await safe(async () => legacyCheck("server", "Street View Static API (metadata)", "Printable report Street View image", await timedFetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&source=outdoor&key=${serverKey}`), ["OK", "ZERO_RESULTS"]),
      "server", "Street View Static API (metadata)", "Printable report Street View image"));

    checks.push(await safe(async () => {
      const r = await timedFetch(`https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=14&size=100x100&key=${serverKey}`);
      const ok = r.status >= 200 && r.status < 300;
      return ok ? { key: "server", api: "Maps Static API", usedFor: "Printable report transit map", ok: true, detail: `HTTP ${r.status}` } as Check
        : { key: "server", api: "Maps Static API", usedFor: "Printable report transit map", ok: false, kind: classifyGoogleFailure(String(r.status), r.text), detail: sanitizeGoogleDetail(`HTTP ${r.status} ${r.text.slice(0, 200)}`) } as Check;
    }, "server", "Maps Static API", "Printable report transit map"));

    checks.push(await safe(async () => newCheck("server", "Places API (New) Autocomplete (server fallback)", "Address suggestions fallback", await timedFetch(
      "https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": serverKey, "X-Goog-FieldMask": "suggestions.placePrediction.text.text" },
        body: JSON.stringify({ input: address.slice(0, 20), includedRegionCodes: ["us"] }),
      })), "server", "Places API (New) Autocomplete (server fallback)", "Address suggestions fallback"));
  }

  if (!browserKey) {
    checks.push({
      key: "browser", api: "(all browser features)", usedFor: "Address autocomplete, interactive Street View, embedded map",
      ok: false, kind: "not_configured", detail: "NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY is not set (and it is inlined at BUILD time: set it, then redeploy).",
    });
  } else {
    const refHeaders = { Referer: origin + "/", Origin: origin };
    checks.push(await safe(async () => newCheck("browser", "Places API (New) Autocomplete", "Primary address suggestions (Maps JS 'places' library)", await timedFetch(
      "https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": browserKey, "X-Goog-FieldMask": "suggestions.placePrediction.text.text", ...refHeaders },
        body: JSON.stringify({ input: address.slice(0, 20), includedRegionCodes: ["us"] }),
      })), "browser", "Places API (New) Autocomplete", "Primary address suggestions (Maps JS 'places' library)"));

    checks.push(await safe(async () => {
      const r = await timedFetch(`https://maps.googleapis.com/maps/api/js?key=${browserKey}&libraries=places,streetView&callback=__diag`, { headers: refHeaders });
      const m = r.text.match(/(RefererNotAllowedMapError|ApiNotActivatedMapError|InvalidKeyMapError|BillingNotEnabledMapError|ApiTargetBlockedMapError|MissingKeyMapError|ExpiredKeyMapError|OverQuotaMapError)/);
      // Google serves this script (HTTP 200) even for bad keys; the error name is embedded in the body.
      if (r.status === 200 && !m) return { key: "browser", api: "Maps JavaScript API", usedFor: "Autocomplete + interactive Street View", ok: true, detail: "Script served with no key error", note: "Final authorization is checked in the visitor's browser; see the console for gm_authFailure if the page still fails." } as Check;
      const name = m ? m[1] : `HTTP ${r.status}`;
      const kind: GoogleFailureKind = /Referer/.test(name) ? "referrer_blocked" : /ApiNotActivated/.test(name) ? "api_not_enabled" : /Billing/.test(name) ? "billing" : /Quota/.test(name) ? "quota" : "key_rejected";
      return { key: "browser", api: "Maps JavaScript API", usedFor: "Autocomplete + interactive Street View", ok: false, kind, detail: name } as Check;
    }, "browser", "Maps JavaScript API", "Autocomplete + interactive Street View"));
  }

  const failed = checks.filter((c) => !c.ok);
  const summary = failed.length === 0 ? "All Google checks passed." : `${failed.length} of ${checks.length} checks failed.`;
  return NextResponse.json({ summary, address, env, checks }, { headers: { "Cache-Control": "no-store" } });
}
