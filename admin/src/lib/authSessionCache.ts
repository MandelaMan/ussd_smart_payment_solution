/**
 * Survives Vite HMR of auth / api modules. Keep this file free of runtime
 * imports from `api.ts` so editing API helpers does not reset the session.
 *
 * localStorage (not sessionStorage) so tabs share expiry metadata — a stale
 * per-tab timer must not revoke a cookie that another tab just refreshed.
 */
export type CachedUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  jobTitle?: string | null;
  mustChangePassword?: boolean;
  permissions?: string[];
  groups?: Array<{ id: number; slug: string; name: string }>;
  impersonating?: {
    impersonator: { id: number; name: string; email: string };
  } | null;
};

export type SessionCache = {
  user: CachedUser;
  expiresAt: number | null;
};

export const SESSION_CACHE_KEY = "sul-admin-session-cache";

let sessionCache: SessionCache | null = null;

function readStorage(): SessionCache | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) {
      // One-time migrate from the older per-tab sessionStorage key.
      const legacy = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!legacy) return null;
      sessionStorage.removeItem(SESSION_CACHE_KEY);
      localStorage.setItem(SESSION_CACHE_KEY, legacy);
      return readStorage();
    }
    const parsed = JSON.parse(raw) as SessionCache;
    if (!parsed?.user?.id || !parsed.user.email) return null;
    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(SESSION_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(next: SessionCache | null) {
  try {
    if (!next) localStorage.removeItem(SESSION_CACHE_KEY);
    else localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — in-memory cache still works */
  }
}

export function getSessionCache(): SessionCache | null {
  if (sessionCache) return sessionCache;
  sessionCache = readStorage();
  return sessionCache;
}

export function setSessionCache(next: SessionCache | null) {
  sessionCache = next;
  writeStorage(next);
}
