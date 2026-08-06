/**
 * In-memory TTL cache so module switches can paint last-known data instantly
 * while a soft refetch runs in the background.
 */

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export const MODULE_CACHE_TTL_MS = 60_000;
export const LOOKUP_CACHE_TTL_MS = 5 * 60_000;

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = MODULE_CACHE_TTL_MS): T {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function cacheInvalidate(prefixOrKey?: string) {
  if (!prefixOrKey) {
    store.clear();
    inflight.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key === prefixOrKey || key.startsWith(prefixOrKey)) {
      store.delete(key);
    }
  }
  for (const key of inflight.keys()) {
    if (key === prefixOrKey || key.startsWith(prefixOrKey)) {
      inflight.delete(key);
    }
  }
}

/** Stable cache key from a params object (sorted keys). */
export function cacheKeyFromParams(
  prefix: string,
  params: Record<string, string | number | boolean | undefined | null> = {}
): string {
  const parts = Object.keys(params)
    .sort()
    .map((k) => {
      const v = params[k];
      if (v == null || v === "") return null;
      return `${k}=${String(v)}`;
    })
    .filter(Boolean);
  return parts.length ? `${prefix}?${parts.join("&")}` : prefix;
}

/**
 * Deduped fetch with TTL. Concurrent callers with the same key share one promise.
 * When `force` is true, bypasses cache but still dedupes in-flight.
 */
export async function cachedFetch<T>(
  key: string,
  loader: () => Promise<T>,
  options?: { ttlMs?: number; force?: boolean }
): Promise<T> {
  const ttlMs = options?.ttlMs ?? MODULE_CACHE_TTL_MS;
  if (!options?.force) {
    const hit = cacheGet<T>(key);
    if (hit != null) return hit;
  }

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = loader()
    .then((value) => {
      cacheSet(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
