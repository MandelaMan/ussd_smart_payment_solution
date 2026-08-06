import { api, type Building, type PackageCategory, type Pop } from "./api";
import {
  LOOKUP_CACHE_TTL_MS,
  cachedFetch,
  cacheInvalidate,
} from "./moduleDataCache";

const BUILDINGS_KEY = "lookups:buildings";
const CATALOG_KEY = "lookups:catalog";
const POPS_KEY = "lookups:pops";

export type BuildingsLookup = {
  buildings: Building[];
};

export type CatalogLookup = {
  categories: PackageCategory[];
};

export type PopsLookup = {
  pops: Pop[];
};

export function getCachedBuildings(options?: { force?: boolean }) {
  return cachedFetch(
    BUILDINGS_KEY,
    async () => {
      const res = await api.listBuildings({ limit: "100" });
      return { buildings: res.buildings || [] } satisfies BuildingsLookup;
    },
    { ttlMs: LOOKUP_CACHE_TTL_MS, force: options?.force }
  );
}

export function getCachedPackageCatalog(options?: { force?: boolean }) {
  return cachedFetch(
    CATALOG_KEY,
    async () => {
      const res = await api.getPackageCatalog();
      return { categories: res.categories || [] } satisfies CatalogLookup;
    },
    { ttlMs: LOOKUP_CACHE_TTL_MS, force: options?.force }
  );
}

export function getCachedPops(options?: { force?: boolean }) {
  return cachedFetch(
    POPS_KEY,
    async () => {
      const res = await api.listPops();
      return { pops: res.pops || res.data || [] } satisfies PopsLookup;
    },
    { ttlMs: LOOKUP_CACHE_TTL_MS, force: options?.force }
  );
}

/** Warm shared lookups after login so the first module switch is already hot. */
export function warmSharedLookups() {
  void getCachedBuildings().catch(() => {});
  void getCachedPackageCatalog().catch(() => {});
  void getCachedPops().catch(() => {});
}

export function invalidateSharedLookups() {
  cacheInvalidate("lookups:");
}
