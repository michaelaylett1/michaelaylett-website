/**
 * Registry of official transit-agency GTFS providers for the initial
 * target markets (spec section 5), and the location-matching logic that
 * decides which provider(s) apply to a given property so the app never
 * queries every national feed for every address.
 *
 * IMPORTANT -- feed URL confidence: this sandbox environment has no
 * general outbound internet access (only an allowlisted set of domains
 * used for research), so none of the feedUrl values below could be
 * downloaded and test-parsed from here before shipping. Each entry's
 * `verified` flag and the inline comment reflect how confident the URL
 * is:
 *   - verified: true  -> found directly on the agency's own domain (or a
 *     domain the agency's own developer page links to) via live web
 *     research, and matches the expected google_transit.zip / GTFS ZIP
 *     naming convention. Still worth a first-deploy smoke test.
 *   - verified: false -> best candidate found via research, but either
 *     the URL lives on a third-party mirror/archive (e.g. an old FOIA
 *     archive for CATS) or could not be confirmed against the agency's
 *     own site. Location matching and diagnostics still work correctly
 *     for these; a first-deploy smoke test against the specific
 *     regression address is required.
 *
 * Every entry can be overridden without a code change via the
 * GTFS_FEED_URL_<ID> environment variable (see README.md), so a stale or
 * wrong URL found here can be corrected in Vercel's environment
 * variables the moment a better one is confirmed.
 */
import type { TransitStopProvider } from "./types";

export const TRANSIT_STOP_PROVIDERS: TransitStopProvider[] = [
  {
    id: "cats",
    agencyName: "CATS",
    market: "Charlotte, NC",
    state: "NC",
    counties: ["Mecklenburg County"],
    cities: ["charlotte"],
    // Best candidate found via research: a Transitland-hosted mirror of
    // a CATS feed originally obtained via a public-records request.
    // Transitland's own page for this feed shows dozens of archived
    // versions, implying an ongoing source exists, but a stable direct
    // download URL on CATS's or Charlotte's own domain could not be
    // confirmed from this environment. STRONGLY RECOMMENDED: replace via
    // GTFS_FEED_URL_CATS with either (a) a current URL obtained directly
    // from CATS/charlottenc.gov, or (b) a Transitland "download latest
    // feed version" URL for onestop_id f-dnq-charlotteareatransitsystem
    // once a Transitland API key is configured (see README.md).
    feedUrl: "https://github.com/transitland/gtfs-archives-not-hosted-elsewhere/raw/master/charlotte-cats.zip",
    verified: false,
  },
  {
    id: "dart",
    agencyName: "DART",
    market: "Dallas / Plano, TX",
    state: "TX",
    counties: ["Dallas County", "Collin County", "Denton County", "Rockwall County"],
    cities: ["dallas", "plano", "garland", "irving", "richardson", "carrollton", "mesquite", "rowlett", "addison"],
    feedUrl: "https://www.dart.org/transitdata/latest/google_transit.zip",
    verified: true,
  },
  {
    id: "trinity-metro",
    agencyName: "Trinity Metro",
    market: "Fort Worth, TX",
    state: "TX",
    counties: ["Tarrant County"],
    cities: ["fort worth", "arlington", "grapevine"],
    feedUrl: "http://sched.ridetm.org/gtfs/fwtatransitdata.zip",
    verified: true,
  },
  {
    id: "marta",
    agencyName: "MARTA",
    market: "Atlanta / Decatur, GA",
    state: "GA",
    counties: ["Fulton County", "DeKalb County", "Clayton County"],
    cities: ["atlanta", "decatur", "east point", "college park"],
    feedUrl: "https://itsmarta.com/google_transit_feed/google_transit.zip",
    verified: true,
  },
  {
    id: "goraleigh",
    agencyName: "GoRaleigh",
    market: "Raleigh, NC",
    state: "NC",
    counties: ["Wake County"],
    cities: ["raleigh"],
    // No confidently-current direct feed URL confirmed from this
    // environment. Provider still participates in location matching
    // (diagnostics will correctly report "GoRaleigh selected, feed not
    // configured") -- set GTFS_FEED_URL_GORALEIGH once one is confirmed.
    feedUrl: null,
    verified: false,
  },
  {
    id: "gotriangle",
    agencyName: "GoTriangle",
    market: "Raleigh-Durham Triangle, NC",
    state: "NC",
    counties: ["Wake County", "Durham County", "Orange County"],
    cities: ["raleigh", "durham", "chapel hill", "cary", "morrisville"],
    feedUrl: null,
    verified: false,
  },
  {
    id: "jta",
    agencyName: "JTA",
    market: "Jacksonville, FL",
    state: "FL",
    counties: ["Duval County"],
    cities: ["jacksonville"],
    // JTA publishes GTFS via a download form (schedules.jtafla.com) and
    // a GTFS archive page (ride.jtafla.com/gtfs-archive/) rather than a
    // stable direct .zip URL that could be confirmed from here.
    feedUrl: null,
    verified: false,
  },
  {
    id: "lynx",
    agencyName: "LYNX",
    market: "Orlando, FL",
    state: "FL",
    counties: ["Orange County", "Seminole County", "Osceola County"],
    cities: ["orlando", "kissimmee", "sanford"],
    feedUrl: "https://www.golynx.com/lynxmap/GoLYNX_data/google_transit.zip",
    verified: true,
  },
  {
    id: "hart",
    agencyName: "HART",
    market: "Tampa, FL",
    state: "FL",
    counties: ["Hillsborough County"],
    cities: ["tampa"],
    feedUrl: null,
    verified: false,
  },
  {
    id: "psta",
    agencyName: "PSTA",
    market: "Tampa Bay / Pinellas County, FL",
    state: "FL",
    counties: ["Pinellas County"],
    cities: ["st. petersburg", "st petersburg", "clearwater", "largo"],
    feedUrl: "https://www.psta.net/Latest/google_transit.zip",
    verified: true,
  },
  {
    id: "pasco",
    agencyName: "Pasco County Public Transportation",
    market: "Tampa Bay / Pasco County, FL",
    state: "FL",
    counties: ["Pasco County"],
    cities: [],
    feedUrl: null,
    verified: false,
  },
  {
    id: "valley-metro",
    agencyName: "Valley Metro",
    market: "Phoenix, AZ",
    state: "AZ",
    counties: ["Maricopa County"],
    cities: ["phoenix", "tempe", "mesa", "scottsdale", "glendale", "chandler"],
    feedUrl:
      "https://www.phoenixopendata.com/dataset/3eae9a4a-98b9-40c8-8df7-8c00c1756235/resource/28ccc0a5-49c8-495c-b91f-193de5ce2cb7/download/googletransit.zip",
    verified: true,
  },
  {
    id: "rtc-southern-nevada",
    agencyName: "RTC Transit",
    market: "Las Vegas, NV",
    state: "NV",
    counties: ["Clark County"],
    cities: ["las vegas", "henderson", "north las vegas"],
    feedUrl: "http://rtcws.rtcsnv.com/g/google_transit.zip",
    verified: true,
  },
];

function envIdFor(provider: TransitStopProvider): string {
  return provider.id.toUpperCase().replace(/-/g, "_");
}

/** Resolves the feed URL actually used for a provider: an env var
 * override (GTFS_FEED_URL_<ID>) always wins over the bundled default, so
 * any entry above can be corrected in Vercel's environment variables
 * without a code change or redeploy of application logic. */
export function resolveFeedUrl(provider: TransitStopProvider): string | null {
  const override = process.env[`GTFS_FEED_URL_${envIdFor(provider)}`];
  if (override && override.trim().length > 0) return override.trim();
  return provider.feedUrl;
}

function normalizeCounty(county: string | null): string {
  return (county ?? "").trim().toLowerCase();
}

function normalizeCity(city: string | null): string {
  return (city ?? "").trim().toLowerCase();
}

/**
 * Selects every provider whose service area plausibly covers the given
 * location (state + county + city), allowing multiple overlapping
 * agencies (spec section 5: "Allow multiple nearby agencies when service
 * areas overlap") -- e.g. a Raleigh address matches both GoRaleigh and
 * GoTriangle. Returns an empty array for a property outside every
 * configured market's service area (a legitimate, expected outcome, not
 * an error -- spec section 13's "property outside the transit agency's
 * service area" test case).
 */
export function selectProvidersForLocation(
  state: string | null,
  county: string | null,
  city: string | null
): TransitStopProvider[] {
  if (!state) return [];
  const normalizedState = state.trim().toUpperCase();
  const normalizedCounty = normalizeCounty(county);
  const normalizedCity = normalizeCity(city);

  return TRANSIT_STOP_PROVIDERS.filter((provider) => {
    if (provider.state !== normalizedState) return false;
    const countyMatch = normalizedCounty
      ? provider.counties.some((c) => normalizeCounty(c) === normalizedCounty)
      : false;
    const cityMatch = normalizedCity ? provider.cities.some((c) => normalizeCity(c) === normalizedCity) : false;
    return countyMatch || cityMatch;
  });
}
