import {
  FiActivity,
  FiBarChart2,
  FiCheckCircle,
  FiCreditCard,
  FiGitMerge,
  FiGrid,
  FiHome,
  FiMenu,
  FiPackage,
  FiUser,
} from "react-icons/fi";
import type { User } from "./api";
import {
  canAccessConfig,
  canAccessFinance,
  canAccessReports,
  hasPermission,
  isPartner,
  useCeoDashboard,
  useSupportDashboard,
} from "./rbac";
import { BILLING_BASE_PATH } from "./billingReconciliationNav";

export type MobileNavTab = {
  key: string;
  to?: string;
  label: string;
  icon: typeof FiGrid;
  end?: boolean;
  action?: "menu";
};

export const MOBILE_BOTTOM_NAV_H = "56px";

/**
 * Float the pill this far above the visible bottom edge.
 * Do not add safe-area here — that is the dead strip under the pill.
 * The app shell is locked to the visual viewport, so 8px is enough.
 */
export const MOBILE_BOTTOM_NAV_GAP = "8px";

/**
 * Space to reserve above the fixed floating bottom nav so content can scroll clear.
 * Nav height + 8px float gap + shadow clearance. No safe-area (viewport lock).
 */
export const MOBILE_BOTTOM_NAV_OFFSET = `calc(${MOBILE_BOTTOM_NAV_H} + ${MOBILE_BOTTOM_NAV_GAP} + 16px)`;

/** Build exactly four navigation destinations before the More tab. */
export function buildMobileNavTabs(user: User | null): MobileNavTab[] {
  const tabs: MobileNavTab[] = [
    { key: "home", to: "/", label: "Home", icon: FiGrid, end: true },
    { key: "customers", to: "/customers", label: "Customers", icon: FiUser },
  ];

  if (isPartner(user)) {
    tabs.push(
      { key: "reports", to: "/reports", label: "Reports", icon: FiBarChart2 },
      {
        key: "active-customers",
        to: "/customers?status=Active",
        label: "Active",
        icon: FiCheckCircle,
      }
    );
  } else if (useCeoDashboard(user)) {
    tabs.push(
      { key: "payments", to: "/transactions", label: "Payments", icon: FiCreditCard },
      { key: "reports", to: "/reports", label: "Reports", icon: FiBarChart2 }
    );
  } else if (canAccessFinance(user)) {
    tabs.push(
      { key: "payments", to: "/transactions", label: "Payments", icon: FiCreditCard },
      { key: "billing", to: BILLING_BASE_PATH, label: "Billing", icon: FiGitMerge }
    );
  } else if (useSupportDashboard(user) || hasPermission(user, "dashboard.support")) {
    tabs.push(
      { key: "activity", to: "/activity", label: "Activity", icon: FiActivity },
      { key: "packages", to: "/products", label: "Packages", icon: FiPackage }
    );
  } else if (canAccessConfig(user)) {
    tabs.push(
      { key: "packages", to: "/products", label: "Packages", icon: FiPackage },
      { key: "buildings", to: "/buildings", label: "Buildings", icon: FiHome }
    );
  } else if (canAccessReports(user)) {
    tabs.push({ key: "reports", to: "/reports", label: "Reports", icon: FiBarChart2 });
  }

  while (tabs.length < 4) {
    const fallback = configFallbackTab(tabs);
    if (!fallback) break;
    tabs.push(fallback);
  }

  tabs.push({ key: "more", label: "More", icon: FiMenu, action: "menu" });

  return tabs.slice(0, 5);
}

function configFallbackTab(existing: MobileNavTab[]): MobileNavTab | null {
  const used = new Set(existing.map((t) => t.to));
  const options: MobileNavTab[] = [
    { key: "activity", to: "/activity", label: "Activity", icon: FiActivity },
    { key: "packages", to: "/products", label: "Packages", icon: FiPackage },
    { key: "buildings", to: "/buildings", label: "Buildings", icon: FiHome },
    { key: "reports", to: "/reports", label: "Reports", icon: FiBarChart2 },
  ];
  return options.find((o) => o.to && !used.has(o.to)) ?? null;
}

export function isMobileNavTabActive(
  tab: MobileNavTab,
  pathname: string,
  search: string
) {
  if (!tab.to) return false;
  if (tab.end) return pathname === "/" || pathname === "";

  const [tabPath, tabQuery] = tab.to.split("?");
  if (pathname !== tabPath && !pathname.startsWith(`${tabPath}/`)) return false;
  if (!tabQuery) {
    return tab.key !== "customers" || !search.includes("status=");
  }
  return search.includes(tabQuery) || `?${tabQuery}` === search;
}
