import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AppShellSkeleton } from "./PageSkeletons";
import { useAuth } from "../lib/authContext";
import { getSessionCache } from "../lib/authSessionCache";
import { normalizeRole, type UserRole } from "../lib/rbac";
import type { User } from "../lib/api";

function useStableAuth() {
  const { user, loading } = useAuth();
  const cached = getSessionCache()?.user as User | undefined;
  // Prefer live context; fall back to HMR-stable cache so the shell never blanks.
  const stableUser = user ?? cached ?? null;
  const stableLoading = loading && !stableUser;
  return { user: stableUser, loading: stableLoading };
}

export function ProtectedRoute() {
  const { user, loading } = useStableAuth();
  const location = useLocation();

  if (loading) {
    return <AppShellSkeleton />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export function RoleRoute({
  roles,
  redirectTo = "/",
}: {
  roles: UserRole[];
  redirectTo?: string;
}) {
  const { user, loading } = useStableAuth();
  if (loading) return <AppShellSkeleton />;
  if (!user || !roles.includes(normalizeRole(user.role))) {
    return <Navigate to={redirectTo} replace />;
  }
  return <Outlet />;
}

export function AdminRoute() {
  return <RoleRoute roles={["admin"]} />;
}

/** Settings hub: users/webhooks/logs (admin) and synchronization (admin + CFO). */
export function SettingsRoute() {
  return <RoleRoute roles={["admin", "cfo"]} />;
}

export function FinanceRoute() {
  return <RoleRoute roles={["admin", "cfo", "ceo"]} />;
}

export function ReportsRoute() {
  return <RoleRoute roles={["admin", "cfo", "partner", "ceo"]} />;
}

/** Activity page — finance feed or support stats depending on role. */
export function ActivityRoute() {
  return <RoleRoute roles={["admin", "support", "cfo", "ceo"]} />;
}

/** Matches API requireCustomerRead — all authenticated roles. */
export function CustomerReadRoute() {
  return (
    <RoleRoute roles={["admin", "support", "cfo", "partner", "ceo"]} />
  );
}

export function ConfigRoute() {
  return <RoleRoute roles={["admin", "support"]} />;
}

export function CustomerWriteRoute() {
  return <RoleRoute roles={["admin", "support"]} redirectTo="/customers" />;
}
