/**
 * Server-only GTFS static feed ingestion: download a transit agency's
 * published GTFS ZIP, parse the files needed to answer "which bus stops
 * are near this point, and what routes serve them," and produce a
 * ParsedGtfsFeed. Called through lib/transit/gtfs/cache.ts, which caches
 * the result for 24 hours so a feed is downloaded and parsed at most
 * once per day per agency, not on every underwriting request.
 *
 * Parses, at minimum, the five files required by the spec:
 *   - agency.txt    -> agency display name
 *   - stops.txt     -> stop id/name/coordinates (the physical bus stops)
 *   - routes.txt    -> route short/long name, route_type, agency_id
 *   - trips.txt     -> trip_id -> route_id
 *   - stop_times.txt -> trip_id -> stop_id (which trips call at which
 *                        stops -- this is the join that lets us attach
 *                        real route numbers to a stop)
 *
 * Performance note: stop_times.txt is by far the largest file in most
 * feeds (every stop visit on every trip, potentially hundreds of
 * thousands of rows for a large metro agency). This does one streaming
 * pass over it per feed parse, building a stopId -> set of bus route
 * names index -- that cost is paid once per 24h cache window per agency,
 * not per property lookup. If a market's feed proves too large to parse
 * within a serverless function's time/memory budget, the fix is to
 * increase CACHE_TTL_MS.gtfsFeed rather than to re-parse per request.
 */
import AdmZip from "adm-zip";
import { parseCsv } from "./csv";
import { haversineMiles } from "../geo";
import type { GtfsStopCandidate, ParsedGtfsFeed } from "./types";

const DOWNLOAD_TIMEOUT_MS = 25000;

export class GtfsIngestError extends Error {
  code: "download_failed" | "timeout" | "invalid_zip" | "missing_required_file";
  constructor(code: GtfsIngestError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "GtfsIngestError";
  }
}

// GTFS route_type values that represent bus service. 3 = Bus, 11 =
// Trolleybus (standard GTFS). Some feeds use the extended Google Transit
// route_type hierarchy (700-716 cover various bus subtypes -- regional
// bus, express bus, BRT, etc). Anything else (0 tram, 1 subway, 2 rail,
// 4 ferry, 5 cable car, 6 gondola, 7 funicular, 12 monorail, and other
// extended non-bus codes) is excluded -- a stop that is rail/subway-only
// per this join is correctly not treated as a qualifying bus stop unless
// a bus route is also confirmed serving it (spec: "Do not treat rail/
// subway/train as qualifying unless bus service is also confirmed").
function isBusRouteType(routeType: string): boolean {
  const n = parseInt(routeType, 10);
  if (n === 3 || n === 11) return true;
  if (n >= 700 && n <= 716) return true;
  return false;
}

function findEntry(zip: AdmZip, filename: string) {
  const entries = zip.getEntries();
  // Case-insensitive match on the base filename -- some published feeds
  // nest the GTFS files inside a subdirectory within the zip.
  return entries.find((e) => e.entryName.toLowerCase().endsWith("/" + filename) || e.entryName.toLowerCase() === filename);
}

function readCsvFile(zip: AdmZip, filename: string, required: boolean): Array<Record<string, string>> {
  const entry = findEntry(zip, filename);
  if (!entry) {
    if (required) {
      throw new GtfsIngestError("missing_required_file", `GTFS feed is missing required file: ${filename}`);
    }
    return [];
  }
  const text = entry.getData().toString("utf8");
  return parseCsv(text);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new GtfsIngestError("download_failed", `GTFS feed download returned HTTP ${response.status}.`);
    }
    return await response.arrayBuffer();
  } catch (err) {
    if (err instanceof GtfsIngestError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new GtfsIngestError("timeout", "GTFS feed download timed out.");
    }
    throw new GtfsIngestError("download_failed", "GTFS feed download failed.");
  } finally {
    clearTimeout(timer);
  }
}

export async function ingestGtfsFeed(feedUrl: string, agencyNameFallback: string): Promise<ParsedGtfsFeed> {
  const buffer = await fetchWithTimeout(feedUrl, DOWNLOAD_TIMEOUT_MS);

  let zip: AdmZip;
  try {
    zip = new AdmZip(Buffer.from(buffer));
  } catch {
    throw new GtfsIngestError("invalid_zip", "GTFS feed could not be read as a ZIP archive.");
  }

  const agencyRows = readCsvFile(zip, "agency.txt", false);
  const stopRows = readCsvFile(zip, "stops.txt", true);
  const routeRows = readCsvFile(zip, "routes.txt", true);
  const tripRows = readCsvFile(zip, "trips.txt", true);
  const stopTimeRows = readCsvFile(zip, "stop_times.txt", true);

  const agencyName = agencyRows[0]?.agency_name?.trim() || agencyNameFallback;

  // routes.txt -> route_id -> { shortName, isBus }
  const routesById = new Map<string, { shortName: string; isBus: boolean }>();
  for (const r of routeRows) {
    const routeId = r.route_id;
    if (!routeId) continue;
    const shortName = (r.route_short_name || r.route_long_name || "").trim();
    routesById.set(routeId, { shortName, isBus: isBusRouteType(r.route_type || "") });
  }

  // trips.txt -> trip_id -> route_id
  const tripToRouteId = new Map<string, string>();
  for (const t of tripRows) {
    if (!t.trip_id || !t.route_id) continue;
    tripToRouteId.set(t.trip_id, t.route_id);
  }

  // stop_times.txt (the big one) -> stop_id -> set of bus route short
  // names actually observed serving that stop. stopsWithBusService
  // tracks membership even when a matched route's short name is blank,
  // so a stop is never dropped merely because route-number text happens
  // to be missing in the feed (spec section 8/6).
  const routeNamesByStopId = new Map<string, Set<string>>();
  const stopsWithBusService = new Set<string>();
  for (const st of stopTimeRows) {
    const stopId = st.stop_id;
    const tripId = st.trip_id;
    if (!stopId || !tripId) continue;
    const routeId = tripToRouteId.get(tripId);
    if (!routeId) continue;
    const route = routesById.get(routeId);
    if (!route || !route.isBus) continue;
    stopsWithBusService.add(stopId);
    if (route.shortName) {
      let set = routeNamesByStopId.get(stopId);
      if (!set) {
        set = new Set();
        routeNamesByStopId.set(stopId, set);
      }
      set.add(route.shortName);
    }
  }

  // stops.txt -> only stops that stop_times/trips/routes confirmed have
  // at least one bus trip -- location_type "2" (station entrance/exit)
  // and "3" (generic pathway node) are excluded outright since they are
  // never boardable locations; "", "0" (stop/platform), "1" (station),
  // and "4" (boarding area) are all eligible.
  const stops: ParsedGtfsFeed["stops"] = [];
  const routesByStopId = new Map<string, string[]>();
  for (const s of stopRows) {
    const stopId = s.stop_id;
    if (!stopId || !stopsWithBusService.has(stopId)) continue;
    const locationType = (s.location_type || "").trim();
    if (locationType === "2" || locationType === "3") continue;
    const lat = parseFloat(s.stop_lat);
    const lon = parseFloat(s.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = (s.stop_name || "Bus Stop").trim();
    stops.push({ stopId, name, latitude: lat, longitude: lon });
    const names = Array.from(routeNamesByStopId.get(stopId) ?? []).sort();
    routesByStopId.set(stopId, names);
  }

  return {
    agencyName,
    stops,
    routesByStopId,
    stopCount: stops.length,
    routeCount: routesById.size,
    parsedAt: new Date().toISOString(),
  };
}

/** Straight-line-distance nearby query over an already-parsed feed. Only
 * used for candidate pre-filtering (spec section 6/7) -- the caller is
 * responsible for computing an actual walking route before treating any
 * result as a final distance. */
export function getNearbyGtfsStops(
  feed: ParsedGtfsFeed,
  latitude: number,
  longitude: number,
  radiusMiles: number
): GtfsStopCandidate[] {
  const results: GtfsStopCandidate[] = [];
  for (const stop of feed.stops) {
    const distance = haversineMiles(latitude, longitude, stop.latitude, stop.longitude);
    if (distance > radiusMiles) continue;
    results.push({
      stopId: stop.stopId,
      name: stop.name,
      latitude: stop.latitude,
      longitude: stop.longitude,
      agency: feed.agencyName,
      routeNumbers: feed.routesByStopId.get(stop.stopId) ?? [],
      source: feed.agencyName,
      straightLineMiles: distance,
    });
  }
  results.sort((a, b) => a.straightLineMiles - b.straightLineMiles);
  return results;
}
