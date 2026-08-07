import { api, type Building, type PackageCategory, type Pop, type User } from "./api";
import {
  LOOKUP_CACHE_TTL_MS,
  cachedFetch,
  cacheInvalidate,
} from "./moduleDataCache";
import { hasPermission } from "./rbac";

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

/**
 * Warm only lookups the user is allowed to fetch — avoids 403 toaster spam
 * when someone has buildings.view but not pops.view / packages.view.
 */
export function warmSharedLookups(user?: User | null) {
  if (!user) return;
  if (hasPermission(user, "buildings.view")) {
    void getCachedBuildings().catch(() => {});
  }
  if (hasPermission(user, "packages.view")) {
    void getCachedPackageCatalog().catch(() => {});
  }
  if (hasPermission(user, "pops.view")) {
    void getCachedPops().catch(() => {});
  }
}

export function invalidateSharedLookups() {
  cacheInvalidate("lookups:");
}
