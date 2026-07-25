/**
 * Shared types for GTFS-based bus-stop discovery. Server-only (this whole
 * lib/transit/gtfs/ directory is never imported from a "use client"
 * component) -- see lib/transit/googleMaps.ts for the equivalent warning
 * on the Google Maps side.
 *
 * Architecture: each transit agency ("market") is described by a
 * TransitStopProvider. lib/transit/gtfs/providers.ts holds the registry
 * of providers for the initial target markets and the location-matching
 * logic that picks which provider(s) apply to a given property.
 * lib/transit/gtfs/ingest.ts downloads and parses a provider's GTFS
 * static feed into a ParsedGtfsFeed. lib/transit/gtfs/cache.ts caches
 * parsed feeds for 24 hours so a feed is never re-downloaded/re-parsed on
 * every underwriting request.
 */

/** A single official transit-agency GTFS static feed, and the rule for
 * deciding whether it applies to a given property. */
export interface TransitStopProvider {
  /** Stable internal id, also used as the GTFS_FEED_URL_<ID> env var
   * override key (e.g. id "cats" -> GTFS_FEED_URL_CATS). */
  id: string;
  /** Display name used in "Final Provider Used" / "Transit Agency"
   * diagnostics and result fields, e.g. "CATS". */
  agencyName: string;
  /** Human-readable metro area, e.g. "Charlotte, NC". */
  market: string;
  /** Two-letter state abbreviation this provider's service area is in. */
  state: string;
  /** County names (as returned by Google's Geocoding API
   * administrative_area_level_2, e.g. "Mecklenburg County") this
   * provider serves. */
  counties: string[];
  /** City/locality names (lowercase) this provider serves, used as a
   * secondary match when the county alone is ambiguous or when Google's
   * county field doesn't line up with the agency's actual service
   * boundary. */
  cities: string[];
  /**
   * Default static GTFS feed URL (a zipped agency.txt/stops.txt/
   * routes.txt/trips.txt/stop_times.txt bundle). Null when no
   * confidently-current official URL is bundled for this market -- the
   * provider still participates in location matching (so diagnostics
   * correctly report "GTFS provider selected: <agency>, feed not
   * configured") but getNearbyStops returns no candidates until a feed
   * URL is supplied via the GTFS_FEED_URL_<ID> environment variable.
   * See README.md "GTFS Feed Configuration" for the full list and how to
   * override any entry without a code change.
   */
  feedUrl: string | null;
  /** Whether feedUrl (or its env override) has been confirmed to point
   * at a live, current, agency-maintained feed vs. a best-effort/mirror
   * URL found via research. Surfaced in diagnostics so a stale mirror is
   * visibly flagged rather than silently trusted. */
  verified: boolean;
}

/** A candidate bus stop discovered via GTFS static data, before a
 * dedicated walking route has been computed for it. */
export interface GtfsStopCandidate {
  stopId: string;
  name: string;
  latitude: number;
  longitude: number;
  agency: string | null;
  routeNumbers: string[];
  /** Which provider (agencyName) produced this candidate -- carried
   * through to the merged/final candidate for the "Transit Agency
   * Selected" diagnostic and the result's Transit Agency field. */
  source: string;
  straightLineMiles: number;
}

/** A fully parsed, indexed GTFS feed, cached for CACHE_TTL_MS.gtfsFeed. */
export interface ParsedGtfsFeed {
  agencyName: string;
  stops: Array<{
    stopId: string;
    name: string;
    latitude: number;
    longitude: number;
  }>;
  /** stop_id -> route short names serving that stop (bus routes only --
   * route_type filtered to GTFS bus/trolleybus/BRT types, see
   * ingest.ts's BUS_ROUTE_TYPES). Built once per feed parse by joining
   * stop_times.txt -> trips.txt -> routes.txt, not per-request. */
  routesByStopId: Map<string, string[]>;
  stopCount: number;
  routeCount: number;
  parsedAt: string; // ISO timestamp
}
