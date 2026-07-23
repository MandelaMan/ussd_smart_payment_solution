import {
  createContext,
  useCallback,
  useContext,
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
  registerAuthSessionExpiredHandler,
  resetAuthSessionExpiredFlag,
  type User,
} from "./api";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionTimerRef = useRef<number | null>(null);
  const sessionExpiredRef = useRef(false);

  const clearSessionTimer = useCallback(() => {
    if (sessionTimerRef.current != null) {
      window.clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
  }, []);

  const resetSessionState = useCallback(() => {
    sessionExpiredRef.current = false;
    resetAuthSessionExpiredFlag();
  }, []);

  const handleSessionExpired = useCallback(() => {
    if (sessionExpiredRef.current) return;
    sessionExpiredRef.current = true;
    clearSessionTimer();
    setUser(null);
    setLoading(false);
    void api.logout().catch(() => {});
    navigate("/login", {
      replace: true,
      state: { reason: "session_expired" },
    });
  }, [clearSessionTimer, navigate]);

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
      setUser(nextUser);
      scheduleSessionExpiry(expiresAt);
    },
    [resetSessionState, scheduleSessionExpiry]
  );

  const refresh = useCallback(async () => {
    try {
      const session = await api.me();
      applySession(session.user, session.expiresAt);
    } catch (err) {
      // Only clear the session on a real auth failure. Network blips, aborts,
      // rate limits, and proxy restarts must not force a login redirect.
      if (isUnauthorizedError(err)) {
        clearSessionTimer();
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [applySession, clearSessionTimer]);

  useEffect(() => {
    registerAuthSessionExpiredHandler(handleSessionExpired);
    return () => {
      registerAuthSessionExpiredHandler(null);
      clearSessionTimer();
    };
  }, [handleSessionExpired, clearSessionTimer]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;

    const validateSession = () => {
      if (sessionExpiredRef.current) return;
      void api
        .me()
        .then((session) => {
          applySession(session.user, session.expiresAt);
        })
        .catch((err) => {
          // Focus/visibility checks fire often in local dev. Do not log the
          // user out (or bump token_version via logout) unless the cookie is gone.
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

    window.addEventListener("focus", validateSession);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", validateSession);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user, applySession, handleSessionExpired]);

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
    await api.logout();
    setUser(null);
  }, [clearSessionTimer, resetSessionState]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
