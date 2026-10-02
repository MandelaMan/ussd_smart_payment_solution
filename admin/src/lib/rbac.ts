import type { User } from "./api";

/** System roles — baseline privilege only. Access is permission-driven. */
export type UserRole = "admin" | "user";

/** @deprecated Legacy roles retained for migrated accounts / stale sessions. */
export type LegacyUserRole = "support" | "cfo" | "partner" | "ceo" | "viewer";

export function normalizeRole(role: string | undefined): UserRole {
  if (role === "admin") return "admin";
  return "user";
}

/** Raw role string including legacy values still present in session cache. */
function rawRole(user: User | null | undefined): string {
  const role = user?.role;
  if (role === "viewer") return "support";
  return role || "user";
}

export function roleLabel(role: string | undefined): string {
  switch (role) {
    case "admin":
      return "Administrator";
    case "cfo":
      return "CFO";
    case "ceo":
      return "CEO";
    case "support":
    case "viewer":
      return "Customer Support";
    case "partner":
      return "Partner";
    case "user":
      return "User";
    default:
      return normalizeRole(role) === "admin" ? "Administrator" : "User";
  }
}

function permissionsHydrated(user: User | null | undefined): boolean {
  return Array.isArray(user?.permissions);
}

function permissionSet(user: User | null | undefined): Set<string> {
  return new Set(user?.permissions || []);
}

export function hasPermission(
  user: User | null | undefined,
  key: string
): boolean {
  if (!user) return false;
  // Administrators always have every module — ignore hydrated override lists.
  if (rawRole(user) === "admin" || normalizeRole(user.role) === "admin") {
    return true;
  }
  if (permissionsHydrated(user)) {
    return permissionSet(user).has(key);
  }
  // Stale session without permissions — fall back to legacy role matrix.
  return legacyHasPermission(rawRole(user), key);
}

export function hasAnyPermission(
  user: User | null | undefined,
  keys: string[]
): boolean {
  return keys.some((k) => hasPermission(user, k));
}

export function isAdministrator(user: User | null): boolean {
  return rawRole(user) === "admin" || normalizeRole(user?.role) === "admin";
}

/**
 * Legacy role → capability mapping used only when /me has not yet provided
 * a permissions array (stale HMR / pre-RBAC session cache).
 */
function legacyHasPermission(role: string, key: string): boolean {
  const adminAll = true;
  const financeRead = new Set([
    "dashboard.view",
    "dashboard.finance",
    "dashboard.activity",
    "dashboard.executive",
    "customers.view",
    "customers.financials",
    "customers.pricing",
    "customers.export",
    "transactions.view",
    "transactions.export",
    "billing.view",
    "billing.export",
    "analytics.view",
    "analytics.export",
    "reports.view",
    "reports.export",
    "reports.schedule",
    "settings.view",
    "settings.sync",
    "agencies.view",
    "leads.view",
    "campaigns.view",
    "installations.view",
    "action_items.view",
  ]);
  const financeWrite = new Set([
    ...financeRead,
    "billing.sync",
    "billing.allocate",
    "billing.actions",
    "billing.communicate",
    "billing.refund",
    "action_items.create",
    "action_items.edit",
  ]);
  const support = new Set([
    "dashboard.view",
    "dashboard.support",
    "dashboard.activity",
    "customers.view",
    "customers.create",
    "customers.edit",
    "customers.import",
    "customers.financials",
    "customers.disconnect",
    "customers.pause",
    "customers.cancel",
    "customers.olt",
    "leads.view",
    "leads.create",
    "leads.edit",
    "leads.message",
    "communication.view",
    "communication.send",
    "packages.view",
    "buildings.view",
    "pops.view",
    "apartments.view",
    "agencies.view",
    "agencies.create",
    "agencies.edit",
    "campaigns.view",
    "reports.view",
    "installations.view",
    "installations.assign",
    "installations.edit",
    "action_items.view",
    "action_items.create",
    "action_items.assign",
    "action_items.edit",
  ]);
  const partner = new Set([
    "dashboard.view",
    "dashboard.partner",
    "partner.internet",
    "customers.view",
    "reports.view",
    "reports.export",
  ]);
  const ceo = new Set([
    ...financeRead,
    "dashboard.executive",
  ]);

  if (role === "admin") return adminAll;
  if (role === "cfo") return financeWrite.has(key);
  if (role === "ceo") return ceo.has(key);
  if (role === "partner") return partner.has(key);
  if (role === "support" || role === "viewer") return support.has(key);
  // Generic "user" without hydration: fail closed (dashboard only).
  return key === "dashboard.view";
}

export type PartnerType = "investor" | "dstv" | "internet";

function groupSlugSet(user: User | null | undefined): Set<string> {
  return new Set((user?.groups || []).map((g) => g.slug).filter(Boolean));
}

export function getPartnerType(user: User | null): PartnerType | null {
  if (!user || isAdministrator(user)) return null;
  const slugs = groupSlugSet(user);
  const investor =
    hasPermission(user, "partner.investor") || slugs.has("partner-investor");
  const internet =
    hasPermission(user, "partner.internet") || slugs.has("customer-relations");
  const dstv =
    hasPermission(user, "partner.dstv") || slugs.has("partner-dstv");
  if (investor) return "investor";
  if (internet) return "internet";
  if (dstv) return "dstv";
  if (
    hasPermission(user, "dashboard.partner") &&
    !hasPermission(user, "customers.financials")
  ) {
    return "internet";
  }
  if (!permissionsHydrated(user) && rawRole(user) === "partner") {
    return "internet";
  }
  return null;
}

export function isPartner(user: User | null): boolean {
  return getPartnerType(user) != null;
}

export function isDstvPartner(user: User | null): boolean {
  return getPartnerType(user) === "dstv";
}

export function isInvestorPartner(user: User | null): boolean {
  return getPartnerType(user) === "investor";
}

export function partnerTypeLabel(type: PartnerType | null): string {
  switch (type) {
    case "investor":
      return "Investor";
    case "dstv":
      return "DSTV partner";
    case "internet":
      return "Internet partner";
    default:
      return "Partner";
  }
}

export function usePartnerDashboard(user: User | null): boolean {
  if (!isPartner(user)) return false;
  if (permissionsHydrated(user)) {
    return (
      hasPermission(user, "dashboard.partner") &&
      !hasPermission(user, "dashboard.finance")
    );
  }
  return rawRole(user) === "partner";
}

/** Finance dashboard, transactions, BI, billing overview (read). */
export function canAccessFinance(user: User | null): boolean {
  return hasAnyPermission(user, [
    "dashboard.finance",
    "transactions.view",
    "billing.view",
    "analytics.view",
  ]);
}

export function canAccessAnalytics(user: User | null): boolean {
  return hasPermission(user, "analytics.view");
}

export function canAccessTransactions(user: User | null): boolean {
  return hasPermission(user, "transactions.view");
}

export function canAccessBilling(user: User | null): boolean {
  return hasPermission(user, "billing.view");
}

/** Activity feed */
export function canAccessActivity(user: User | null): boolean {
  return hasPermission(user, "dashboard.activity");
}

/** Customer and user change audit module. */
export function canAccessActivityAudit(user: User | null): boolean {
  return hasPermission(user, "activity_audit.view");
}

/** Startlyx IPTV test console. */
export function canAccessIptvConsole(user: User | null): boolean {
  return hasPermission(user, "iptv.view");
}

export function canOperateIptv(user: User | null): boolean {
  return hasPermission(user, "iptv.operate");
}

export function canConfigureIptv(user: User | null): boolean {
  return hasPermission(user, "iptv.settings");
}

export function canAccessCustomerRead(user: User | null): boolean {
  return hasPermission(user, "customers.view");
}

/** Sync / allocate / send billing actions */
export function canOperateFinance(user: User | null): boolean {
  return hasAnyPermission(user, [
    "billing.sync",
    "billing.allocate",
    "billing.actions",
    "billing.communicate",
  ]);
}

export function canAccessReports(user: User | null): boolean {
  return hasPermission(user, "reports.view");
}

export function canAccessConfig(user: User | null): boolean {
  return hasAnyPermission(user, [
    "packages.view",
    "buildings.view",
    "pops.view",
    "apartments.view",
    "agencies.view",
    "campaigns.view",
  ]);
}

export function canMutateCustomers(user: User | null): boolean {
  return hasAnyPermission(user, ["customers.create", "customers.edit"]);
}

export function canSeeCustomerFinancials(user: User | null): boolean {
  return hasPermission(user, "customers.financials");
}

export function canMutateAgencies(user: User | null): boolean {
  return hasAnyPermission(user, ["agencies.create", "agencies.edit"]);
}

export function canViewCampaigns(user: User | null): boolean {
  return hasPermission(user, "campaigns.view");
}

export function canMutateCampaigns(user: User | null): boolean {
  return isAdministrator(user);
}

export function canMutateConfig(user: User | null): boolean {
  return hasAnyPermission(user, [
    "packages.create",
    "packages.edit",
    "buildings.create",
    "buildings.edit",
    "pops.create",
    "pops.edit",
  ]);
}

export function canAccessOps(user: User | null): boolean {
  return hasPermission(user, "system_logs.view");
}

export function canManageUsers(user: User | null): boolean {
  if (isAdministrator(user)) return true;
  return hasAnyPermission(user, ["users.view", "users.create", "users.edit"]);
}

export function canDeleteCustomer(user: User | null): boolean {
  return hasPermission(user, "customers.delete");
}

export function canEditCustomerPackage(user: User | null): boolean {
  return hasAnyPermission(user, ["customers.edit", "customers.package_edit"]);
}

/** Local package/frequency correction without creating a Zoho invoice. */
export function canCorrectCustomerPackageLocally(user: User | null): boolean {
  return hasPermission(user, "customers.package_edit");
}

export function hidePricing(user: User | null): boolean {
  return !hasPermission(user, "customers.pricing");
}

export function useSupportDashboard(user: User | null): boolean {
  if (permissionsHydrated(user)) {
    return (
      hasPermission(user, "dashboard.support") &&
      !hasPermission(user, "dashboard.finance") &&
      !hasPermission(user, "dashboard.partner") &&
      !hasPermission(user, "dashboard.executive")
    );
  }
  return rawRole(user) === "support";
}

export function useCeoDashboard(user: User | null): boolean {
  // Administrators and finance operators keep the classic finance Home dashboard.
  if (isAdministrator(user) || canOperateFinance(user)) return false;
  if (permissionsHydrated(user)) {
    return hasPermission(user, "dashboard.executive");
  }
  return rawRole(user) === "ceo";
}

export function canAccessSettings(user: User | null): boolean {
  if (isAdministrator(user)) return true;
  return hasAnyPermission(user, [
    "settings.view",
    "settings.sync",
    "users.view",
    "system_logs.view",
    "iptv.settings",
  ]);
}
