/**
 * Minimal server-side in-memory TTL cache (spec section 18: "Add
 * server-side caching by normalized address").
 *
 * Important limitation, documented here rather than glossed over: Vercel
 * Functions are ephemeral and can run across multiple isolated instances,
 * so this in-memory cache is best-effort -- it avoids repeat API calls
 * within a single warm function instance (which is the common case for a
 * visitor editing the same address over a few minutes) but is not a
 * durable, cross-instance cache. If cross-instance durability becomes
 * important, swap the Map below for a shared store (Vercel KV, Redis,
 * etc.) without changing any caller -- every caller only ever uses
 * getCached/setCached.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

// Cap the number of entries so a long-running instance can't grow this
// map unboundedly under unusual traffic. Oldest entries are evicted
// first once the cap is hit.
const MAX_ENTRIES = 500;

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export const CACHE_TTL_MS = {
  /** Address coordinates: 30 days (spec section 18). */
  geocode: 30 * 24 * 60 * 60 * 1000,
  /** Bus-stop candidates: 7-30 days (spec section 18); 14 used as a middle ground. */
  stopCandidates: 14 * 24 * 60 * 60 * 1000,
  /** Walking-route result: 7-30 days (spec section 18); 14 used as a middle ground. */
  walkingRoute: 14 * 24 * 60 * 60 * 1000,
};

/** Normalizes a free-text address into a stable cache key. */
export function normalizeAddressKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}
