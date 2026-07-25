/**
 * 24-hour in-memory cache of parsed GTFS feeds, keyed by feed URL, so a
 * multi-megabyte agency ZIP is downloaded and parsed at most once per
 * day per warm serverless instance rather than on every underwriting
 * request (spec section 4: "Cache the parsed data so the ZIP file is not
 * downloaded and parsed for every underwriting request").
 *
 * Selected approach and why: an in-memory Map with a TTL, matching the
 * pattern already used for address/geocode caching in
 * lib/transit/cache.ts. Documented trade-off (same caveat as that
 * module): Vercel Functions are ephemeral and can run across multiple
 * isolated instances, so this cache is best-effort per warm instance,
 * not a durable cross-instance cache -- a cold start re-downloads the
 * feed. This was chosen over the spec's alternative options because it
 * requires no additional paid infrastructure (Vercel KV, a database) and
 * meaningfully cuts request latency/cost for the common case (repeated
 * lookups against the same warm instance), while a GTFS feed is large
 * enough that re-parsing it per request would be genuinely slow. If
 * cross-instance durability becomes important, swap the Map below for a
 * shared store (Vercel KV, Redis, S3 + a build-time refresh job, etc.)
 * without changing any caller -- every caller only ever uses
 * getCachedFeed/setCachedFeed/getFeedMeta.
 */
import type { ParsedGtfsFeed } from "./types";

interface FeedCacheEntry {
  feed: ParsedGtfsFeed;
  expiresAt: number;
}

const store = new Map<string, FeedCacheEntry>();

// In-flight de-duplication: if two requests for the same uncached feed
// arrive close together, only download/parse it once.
const inFlight = new Map<string, Promise<ParsedGtfsFeed>>();

export const GTFS_FEED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (spec section 4)

export function getCachedFeed(feedUrl: string): ParsedGtfsFeed | null {
  const entry = store.get(feedUrl);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(feedUrl);
    return null;
  }
  return entry.feed;
}

export function setCachedFeed(feedUrl: string, feed: ParsedGtfsFeed): void {
  store.set(feedUrl, { feed, expiresAt: Date.now() + GTFS_FEED_TTL_MS });
}

/** Loads a feed via getCachedFeed, or ingestFn() on a cache miss,
 * de-duplicating concurrent misses for the same URL. */
export async function loadFeedCached(feedUrl: string, ingestFn: () => Promise<ParsedGtfsFeed>): Promise<ParsedGtfsFeed> {
  const cached = getCachedFeed(feedUrl);
  if (cached) return cached;

  const existing = inFlight.get(feedUrl);
  if (existing) return existing;

  const task = ingestFn()
    .then((feed) => {
      setCachedFeed(feedUrl, feed);
      return feed;
    })
    .finally(() => {
      inFlight.delete(feedUrl);
    });
  inFlight.set(feedUrl, task);
  return task;
}

/** Diagnostic-only accessor: feed metadata without triggering a load, so
 * "GTFS Last Updated" can be reported for a feed that either hasn't been
 * requested yet in this instance (returns null) or is already warm. */
export function getFeedMeta(feedUrl: string): { stopCount: number; parsedAt: string } | null {
  const entry = store.get(feedUrl);
  if (!entry) return null;
  return { stopCount: entry.feed.stopCount, parsedAt: entry.feed.parsedAt };
}
