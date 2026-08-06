import { cacheGet, cacheSet, MODULE_CACHE_TTL_MS } from "./moduleDataCache";

/**
 * Decide whether a list reload should blank the UI.
 * Keep previous rows visible when we already have data (module revisit / filter soft refresh).
 */
export function beginListLoad(options: {
  hasRows: boolean;
  append?: boolean;
  silent?: boolean;
  setLoading: (v: boolean) => void;
  setLoadingMore?: (v: boolean) => void;
}): { blocking: boolean } {
  const { hasRows, append, silent, setLoading, setLoadingMore } = options;
  if (silent) {
    return { blocking: false };
  }
  if (append) {
    setLoadingMore?.(true);
    return { blocking: false };
  }
  if (hasRows) {
    // Soft refresh — leave existing rows painted.
    return { blocking: false };
  }
  setLoading(true);
  return { blocking: true };
}

export function endListLoad(options: {
  setLoading: (v: boolean) => void;
  setLoadingMore?: (v: boolean) => void;
}) {
  options.setLoading(false);
  options.setLoadingMore?.(false);
}

export function seedListState<T>(
  key: string
): { rows: T[]; pagination: unknown | null; hasCache: boolean } {
  const hit = cacheGet<{ rows: T[]; pagination: unknown }>(key);
  if (!hit?.rows) {
    return { rows: [], pagination: null, hasCache: false };
  }
  return { rows: hit.rows, pagination: hit.pagination ?? null, hasCache: true };
}

export function storeListState<T>(
  key: string,
  rows: T[],
  pagination: unknown,
  ttlMs = MODULE_CACHE_TTL_MS
) {
  cacheSet(key, { rows, pagination }, ttlMs);
}
