// Spec 227: short-TTL per-org cache for the create-project catalog bundle
// (module catalog + profile defaults). Deriving the bundle runs a full
// substrate load plus an admission check; the bundle only changes when the
// org's factory origin re-syncs, so the read endpoint (the create-project page
// loader) should not pay that round-trip on every page view (ai-review flagged
// the per-request substrate load on #533; spec 227 Stage 2). The create path
// instead loads one OrgView and derives from it directly, threading the same
// substrate into adapter resolution.
//
// Pure module (no Encore imports) so the TTL semantics are unit-testable
// without infra; the clock is injectable for the same reason. Generic over the
// cached value, keyed by `(namespace, orgId)` so distinct value kinds never
// collide on the same org id. Mirrors the per-project cache idiom in
// `api/knowledge/extractionPolicy.ts`.

export const MODULE_CATALOG_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  loadedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Return the org's cached value for `namespace`, invoking `load` at most once
 * per TTL window per `(namespace, orgId)` (sequential calls; overlapping misses
 * are not coalesced, which is acceptable on this low-frequency create/read
 * path). The cached value is a shared reference, so callers must treat it as
 * read-only. `now` is injectable for tests (defaults to `Date.now`). The
 * namespace keys the entry so two callers caching different value kinds under
 * the same org id cannot collide.
 */
export async function getCachedForOrg<T>(
  namespace: string,
  orgId: string,
  load: () => Promise<T>,
  now: () => number = Date.now
): Promise<T> {
  const key = `${namespace} ${orgId}`;
  const t = now();
  const hit = cache.get(key);
  if (hit && t - hit.loadedAt < MODULE_CATALOG_CACHE_TTL_MS) {
    return hit.value as T;
  }
  const value = await load();
  cache.set(key, { value, loadedAt: t });
  return value;
}

/** Visible for tests. */
export function clearModuleCatalogCache(): void {
  cache.clear();
}
