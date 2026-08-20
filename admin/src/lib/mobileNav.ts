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
  FiTool,
  FiUser,
} from "react-icons/fi";
import type { User } from "./api";
import {
  canAccessFinance,
  canAccessReports,
  hasPermission,
  isPartner,
  useCeoDashboard,
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

function tabIf(
  allowed: boolean,
  tab: MobileNavTab
): MobileNavTab | null {
  return allowed ? tab : null;
}

/** Build exactly four navigation destinations before the More tab. */
export function buildMobileNavTabs(user: User | null): MobileNavTab[] {
  const tabs: MobileNavTab[] = [
    { key: "home", to: "/", label: "Home", icon: FiGrid, end: true },
  ];

  const customers = tabIf(hasPermission(user, "customers.view"), {
    key: "customers",
    to: "/customers",
    label: "Customers",
    icon: FiUser,
  });
  if (customers) tabs.push(customers);

  const extras: Array<MobileNavTab | null> = [];
  if (isPartner(user)) {
    extras.push(
      tabIf(canAccessReports(user), {
        key: "reports",
        to: "/reports",
        label: "Reports",
        icon: FiBarChart2,
      }),
      tabIf(hasPermission(user, "customers.view"), {
        key: "active-customers",
        to: "/customers?status=Active",
        label: "Active",
        icon: FiCheckCircle,
      })
    );
  } else if (useCeoDashboard(user)) {
    extras.push(
      tabIf(hasPermission(user, "transactions.view"), {
        key: "payments",
        to: "/transactions",
        label: "Payments",
        icon: FiCreditCard,
      }),
      tabIf(canAccessReports(user), {
        key: "reports",
        to: "/reports",
        label: "Reports",
        icon: FiBarChart2,
      })
    );
  } else if (canAccessFinance(user)) {
    extras.push(
      tabIf(hasPermission(user, "transactions.view"), {
        key: "payments",
        to: "/transactions",
        label: "Payments",
        icon: FiCreditCard,
      }),
      tabIf(hasPermission(user, "billing.view"), {
        key: "billing",
        to: BILLING_BASE_PATH,
        label: "Billing",
        icon: FiGitMerge,
      })
    );
  } else {
    extras.push(
      tabIf(hasPermission(user, "installations.view"), {
        key: "installations",
        to: "/installations",
        label: "Installs",
        icon: FiTool,
      }),
      tabIf(hasPermission(user, "dashboard.activity"), {
        key: "activity",
        to: "/activity",
        label: "Activity",
        icon: FiActivity,
      }),
      tabIf(hasPermission(user, "packages.view"), {
        key: "packages",
        to: "/products",
        label: "Packages",
        icon: FiPackage,
      }),
      tabIf(hasPermission(user, "buildings.view"), {
        key: "buildings",
        to: "/buildings",
        label: "Buildings",
        icon: FiHome,
      }),
      tabIf(canAccessReports(user), {
        key: "reports",
        to: "/reports",
        label: "Reports",
        icon: FiBarChart2,
      })
    );
  }

  for (const extra of extras) {
    if (!extra) continue;
    if (tabs.some((t) => t.to === extra.to)) continue;
    tabs.push(extra);
    if (tabs.length >= 4) break;
  }

  while (tabs.length < 4) {
    const fallback = configFallbackTab(user, tabs);
    if (!fallback) break;
    tabs.push(fallback);
  }

  tabs.push({ key: "more", label: "More", icon: FiMenu, action: "menu" });

  return tabs.slice(0, 5);
}

function configFallbackTab(
  user: User | null,
  existing: MobileNavTab[]
): MobileNavTab | null {
  const used = new Set(existing.map((t) => t.to));
  const options: Array<{ perm: string; tab: MobileNavTab }> = [
    {
      perm: "dashboard.activity",
      tab: { key: "activity", to: "/activity", label: "Activity", icon: FiActivity },
    },
    {
      perm: "packages.view",
      tab: { key: "packages", to: "/products", label: "Packages", icon: FiPackage },
    },
    {
      perm: "buildings.view",
      tab: { key: "buildings", to: "/buildings", label: "Buildings", icon: FiHome },
    },
    {
      perm: "reports.view",
      tab: { key: "reports", to: "/reports", label: "Reports", icon: FiBarChart2 },
    },
  ];
  const match = options.find(
    (o) => o.tab.to && !used.has(o.tab.to) && hasPermission(user, o.perm)
  );
  return match?.tab ?? null;
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
