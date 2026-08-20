import { createContext, useContext } from "react";
import type { User } from "./api";
import { getSessionCache } from "./authSessionCache";

export type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  impersonate: (userId: number) => Promise<void>;
  stopImpersonation: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Hook-only module (no component exports) so Vite Fast Refresh stays valid.
 * AuthProvider lives in AuthProvider.tsx.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  // During Vite HMR, AuthProvider can briefly disappear while consumers stay mounted.
  // Prefer the HMR-stable session cache over a blank shell.
  if (!ctx) {
    const cached = getSessionCache();
    return {
      user: (cached?.user as User | undefined) ?? null,
      loading: !cached?.user,
      login: async () => {
        throw new Error("Auth is still loading — refresh the page and try again");
      },
      logout: async () => {},
      refresh: async () => {},
      impersonate: async () => {
        throw new Error("Auth is still loading — refresh the page and try again");
      },
      stopImpersonation: async () => {
        throw new Error("Auth is still loading — refresh the page and try again");
      },
    };
  }
  return ctx;
}
