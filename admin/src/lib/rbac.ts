import type { User } from "./api";

export type UserRole = "admin" | "support" | "cfo" | "partner";

export function normalizeRole(role: string | undefined): UserRole {
  if (role === "viewer") return "support";
  if (role === "admin" || role === "cfo" || role === "support" || role === "partner") {
    return role;
  }
  return "support";
}

export function roleLabel(role: string | undefined): string {
  switch (normalizeRole(role)) {
    case "admin":
      return "Administrator";
    case "cfo":
      return "CFO";
    case "support":
      return "Customer Support";
    case "partner":
      return "Partner";
    default:
      return "User";
  }
}

export function isPartner(user: User | null): boolean {
  return normalizeRole(user?.role) === "partner";
}

export function usePartnerDashboard(user: User | null): boolean {
  return isPartner(user);
}

export function canAccessFinance(user: User | null): boolean {
  const role = normalizeRole(user?.role);
  return role === "admin" || role === "cfo";
}

export function canAccessReports(user: User | null): boolean {
  const role = normalizeRole(user?.role);
  return role === "admin" || role === "cfo" || role === "partner";
}

export function canAccessConfig(user: User | null): boolean {
  const role = normalizeRole(user?.role);
  return role === "admin" || role === "support";
}

export function canAccessCustomers(user: User | null): boolean {
  return Boolean(user);
}

export function canMutateCustomers(user: User | null): boolean {
  const role = normalizeRole(user?.role);
  return role === "admin" || role === "support";
}

export function canSeeCustomerFinancials(user: User | null): boolean {
  return !isPartner(user);
}

export function canMutateAgencies(user: User | null): boolean {
  const role = normalizeRole(user?.role);
  return role === "admin" || role === "support";
}

export function canMutateConfig(user: User | null): boolean {
  return normalizeRole(user?.role) === "admin";
}

export function canAccessOps(user: User | null): boolean {
  return normalizeRole(user?.role) === "admin";
}

export function canManageUsers(user: User | null): boolean {
  return normalizeRole(user?.role) === "admin";
}

export function canDeleteCustomer(user: User | null): boolean {
  return normalizeRole(user?.role) === "admin";
}

export function hidePricing(user: User | null): boolean {
  const role = normalizeRole(user?.role);
  return role === "support" || role === "partner";
}

export function useSupportDashboard(user: User | null): boolean {
  return normalizeRole(user?.role) === "support";
}
