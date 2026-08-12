import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AppShellSkeleton } from "./PageSkeletons";
import { useAuth } from "../lib/authContext";
import { getSessionCache } from "../lib/authSessionCache";
import {
  canAccessSettings,
  hasAnyPermission,
  hasPermission,
  isAdministrator,
} from "../lib/rbac";
import type { User } from "../lib/api";

function useStableAuth() {
  const { user, loading } = useAuth();
  const cached = getSessionCache()?.user as User | undefined;
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

  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}

export function PermissionRoute({
  permissions,
  requireAll = false,
  redirectTo = "/",
}: {
  permissions: string[];
  requireAll?: boolean;
  redirectTo?: string;
}) {
  const { user, loading } = useStableAuth();
  if (loading) return <AppShellSkeleton />;
  const ok = requireAll
    ? permissions.every((p) => hasPermission(user, p))
    : hasAnyPermission(user, permissions);
  if (!user || !ok) {
    return <Navigate to={redirectTo} replace />;
  }
  return <Outlet />;
}

export function AdminRoute() {
  const { user, loading } = useStableAuth();
  if (loading) return <AppShellSkeleton />;
  if (!user || !isAdministrator(user)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

/** Settings hub: users, logs, sync — any settings-related permission. */
export function SettingsRoute() {
  const { user, loading } = useStableAuth();
  if (loading) return <AppShellSkeleton />;
  if (!user || !canAccessSettings(user)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

export function FinanceRoute() {
  return (
    <PermissionRoute
      permissions={[
        "dashboard.finance",
        "transactions.view",
        "billing.view",
        "analytics.view",
      ]}
    />
  );
}

export function ReportsRoute() {
  return <PermissionRoute permissions={["reports.view"]} />;
}

export function ActivityRoute() {
  return <PermissionRoute permissions={["dashboard.activity"]} />;
}

export function CustomerReadRoute() {
  return <PermissionRoute permissions={["customers.view"]} />;
}

export function ConfigRoute() {
  return (
    <PermissionRoute
      permissions={[
        "packages.view",
        "buildings.view",
        "pops.view",
        "apartments.view",
        "agencies.view",
        "campaigns.view",
      ]}
    />
  );
}

export function CustomerWriteRoute() {
  return (
    <PermissionRoute
      permissions={["customers.create", "customers.edit"]}
      redirectTo="/customers"
    />
  );
}
