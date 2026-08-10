import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  isUnauthorizedError,
  markAuthSessionExpiredNotified,
  registerAuthSessionExpiredHandler,
  resetAuthSessionExpiredFlag,
  type User,
} from "./api";
import { AuthContext } from "./authContext";
import {
  getSessionCache,
  setSessionCache,
  SESSION_CACHE_KEY,
} from "./authSessionCache";
import { warmSharedLookups } from "./sharedLookups";
import { canAccessConfig } from "./rbac";
import { cacheInvalidate } from "./moduleDataCache";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Nodemon / proxy restarts briefly refuse connections — retry before clearing session. */
async function fetchMeWithRetry(attempts = 4) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await Promise.race([
        api.me(),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("Session check timed out")),
            8000
          );
        }),
      ]);
    } catch (err) {
      lastErr = err;
      if (isUnauthorizedError(err)) throw err;
      if (i < attempts - 1) await sleep(250 * (i + 1));
    }
  }
  throw lastErr;
}

function userFromCache(): User | null {
  const cached = getSessionCache()?.user;
  if (!cached) return null;
  return cached as User;
}

/**
 * Component-only module so Vite Fast Refresh stays valid.
 * useAuth lives in authContext.ts — do not re-export hooks from here.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(() => userFromCache());
  const [loading, setLoading] = useState(() => !getSessionCache()?.user);
  const sessionTimerRef = useRef<number | null>(null);
  const sessionExpiredRef = useRef(false);
  const confirmingExpiryRef = useRef(false);
  const applySessionRef = useRef<
    ((nextUser: User, expiresAt: number | null | undefined) => void) | null
  >(null);

  const clearSessionTimer = useCallback(() => {
    if (sessionTimerRef.current != null) {
      window.clearTimeout(sessionTimerRef.current);
    }
    sessionTimerRef.current = null;
  }, []);

  const resetSessionState = useCallback(() => {
    sessionExpiredRef.current = false;
    resetAuthSessionExpiredFlag();
  }, []);

  const forceLocalLogout = useCallback(() => {
    sessionExpiredRef.current = true;
    markAuthSessionExpiredNotified();
    setSessionCache(null);
    clearSessionTimer();
    setUser(null);
    setLoading(false);
    void api.logout().catch(() => {});
    navigate("/login", {
      replace: true,
      state: { reason: "session_expired" },
    });
  }, [clearSessionTimer, navigate]);

  /**
   * Never destroy a session on a single 401 / timer tick alone.
   * Re-check /auth/me first — stale tab timers, nodemon blips, and mistaken
   * 401s were logging users out while the cookie was still valid.
   */
  const handleSessionExpired = useCallback(() => {
    if (sessionExpiredRef.current || confirmingExpiryRef.current) return;
    confirmingExpiryRef.current = true;

    void (async () => {
      try {
        const session = await fetchMeWithRetry(2);
        applySessionRef.current?.(session.user, session.expiresAt);
      } catch (err) {
        if (isUnauthorizedError(err)) {
          forceLocalLogout();
        } else {
          // Network / 503 — keep the cached session painted.
          resetAuthSessionExpiredFlag();
        }
      } finally {
        confirmingExpiryRef.current = false;
      }
    })();
  }, [forceLocalLogout]);

  const scheduleSessionExpiry = useCallback(
    (expiresAt: number | null | undefined) => {
      clearSessionTimer();
      if (!expiresAt) return;
      const ms = expiresAt - Date.now();
      if (ms <= 0) {
        handleSessionExpired();
        return;
      }
      sessionTimerRef.current = window.setTimeout(handleSessionExpired, ms);
    },
    [clearSessionTimer, handleSessionExpired]
  );

  const applySession = useCallback(
    (nextUser: User, expiresAt: number | null | undefined) => {
      resetSessionState();
      // Drop pre-RBAC cache shapes so capability checks do not run on stale users.
      const normalized: User = {
        ...nextUser,
        role: nextUser.role === "admin" ? "admin" : nextUser.role === "user" ? "user" : nextUser.role,
        permissions: Array.isArray(nextUser.permissions)
          ? nextUser.permissions
          : undefined,
        mustChangePassword: Boolean(nextUser.mustChangePassword),
      };
      setSessionCache({ user: normalized, expiresAt: expiresAt ?? null });
      setUser(normalized);
      setLoading(false);
      scheduleSessionExpiry(expiresAt);
    },
    [resetSessionState, scheduleSessionExpiry]
  );

  applySessionRef.current = applySession;

  const refresh = useCallback(async () => {
    const hadCachedUser = Boolean(getSessionCache()?.user);
    // Only show the boot/auth skeleton when we have nothing to paint.
    if (!hadCachedUser) setLoading(true);
    try {
      const session = await fetchMeWithRetry();
      applySession(session.user, session.expiresAt);
    } catch (err) {
      // Only clear the session on a real auth failure. Network blips, aborts,
      // rate limits, and proxy restarts must not force a login redirect.
      if (isUnauthorizedError(err)) {
        setSessionCache(null);
        clearSessionTimer();
        setUser(null);
      } else {
        // Restore cached user after HMR / nodemon so the shell does not blank.
        const cached = getSessionCache();
        if (cached?.user) {
          setUser(cached.user as User);
          scheduleSessionExpiry(cached.expiresAt);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [applySession, clearSessionTimer, scheduleSessionExpiry]);

  useEffect(() => {
    registerAuthSessionExpiredHandler(handleSessionExpired);
    return () => {
      registerAuthSessionExpiredHandler(null);
      clearSessionTimer();
    };
  }, [handleSessionExpired, clearSessionTimer]);

  useEffect(() => {
    // Restore expiry timer after remount before /me round-trip completes.
    const cached = getSessionCache();
    if (cached?.expiresAt) {
      scheduleSessionExpiry(cached.expiresAt);
    }
    void refresh();
    // Mount-only: depending on `refresh` re-fired /me in a loop and starved page data.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, []);

  useEffect(() => {
    if (!user) return;

    // Window focus fires constantly in local multi-monitor / Cursor workflows and
    // remounts race with Vite HMR. Validate only on tab visibility restore.
    const validateSession = () => {
      if (sessionExpiredRef.current) return;
      if (document.visibilityState !== "visible") return;
      void fetchMeWithRetry(2)
        .then((session) => {
          applySession(session.user, session.expiresAt);
        })
        .catch((err) => {
          if (isUnauthorizedError(err)) {
            handleSessionExpired();
          }
        });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        validateSession();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user, applySession, handleSessionExpired]);

  // Other tabs login/logout via localStorage — keep this tab in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_CACHE_KEY) return;
      if (event.newValue == null) {
        if (!sessionExpiredRef.current) {
          sessionExpiredRef.current = true;
          clearSessionTimer();
          setUser(null);
          setLoading(false);
          navigate("/login", {
            replace: true,
            state: { reason: "session_expired" },
          });
        }
        return;
      }
      void refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [clearSessionTimer, navigate, refresh]);

  useEffect(() => {
    if (!user) return;
    // Only warm config lookups when the user can access them — otherwise these
    // fire 403s and compete with table list requests for DB/Redis.
    if (canAccessConfig(user)) {
      warmSharedLookups(user);
    }
  }, [user]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.login(email, password);
      applySession(session.user, session.expiresAt);
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    clearSessionTimer();
    resetSessionState();
    setSessionCache(null);
    cacheInvalidate();
    await api.logout();
    setUser(null);
  }, [clearSessionTimer, resetSessionState]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
