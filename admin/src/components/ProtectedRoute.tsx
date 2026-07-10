import { Navigate, Outlet } from "react-router-dom";
import { AppShellSkeleton } from "./PageSkeletons";
import { useAuth } from "../lib/auth";
import {
  canAccessConfig,
  canAccessFinance,
  canManageUsers,
  normalizeRole,
  type UserRole,
} from "../lib/rbac";

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <AppShellSkeleton />;
  }

  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RoleRoute({
  roles,
  redirectTo = "/",
}: {
  roles: UserRole[];
  redirectTo?: string;
}) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || !roles.includes(normalizeRole(user.role))) {
    return <Navigate to={redirectTo} replace />;
  }
  return <Outlet />;
}

export function AdminRoute() {
  return <RoleRoute roles={["admin"]} />;
}

export function FinanceRoute() {
  return <RoleRoute roles={["admin", "cfo"]} />;
}

export function ReportsRoute() {
  return <RoleRoute roles={["admin", "cfo", "partner"]} />;
}

export function ConfigRoute() {
  return <RoleRoute roles={["admin", "support"]} />;
}

export function CustomerWriteRoute() {
  return <RoleRoute roles={["admin", "support"]} redirectTo="/customers" />;
}

export function useRouteAccess() {
  const { user } = useAuth();
  return {
    user,
    role: normalizeRole(user?.role),
    finance: canAccessFinance(user),
    config: canAccessConfig(user),
    manageUsers: canManageUsers(user),
  };
}
