/**
 * Survives Vite HMR of auth / api modules. Keep this file free of runtime
 * imports from `api.ts` so editing API helpers does not reset the session.
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
};

export type SessionCache = {
  user: CachedUser;
  expiresAt: number | null;
};

const STORAGE_KEY = "sul-admin-session-cache";

let sessionCache: SessionCache | null = null;

function readStorage(): SessionCache | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCache;
    if (!parsed?.user?.id || !parsed.user.email) return null;
    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(next: SessionCache | null) {
  try {
    if (!next) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
