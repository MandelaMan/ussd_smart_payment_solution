/**
 * Prefetch lazy route chunks on nav hover/focus so the next click
 * does not wait on the network for JS.
 */

type Prefetcher = () => Promise<unknown>;

const prefetchers: Record<string, Prefetcher> = {
  "/": () => import("../pages/RoleHomePage"),
  "/customers": () => import("../pages/CustomersListPage"),
  "/customers/new": () => import("../pages/NewCustomerPage"),
  "/leads": () => import("../pages/LeadsPage"),
  "/communication": () => import("../pages/CommunicationPage"),
  "/products": () => import("../pages/ProductsPage"),
  "/buildings": () => import("../pages/BuildingsPage"),
  "/agencies": () => import("../pages/AgenciesPage"),
  "/apartments": () => import("../pages/ApartmentsPage"),
  "/transactions": () => import("../pages/TransactionsPage"),
  "/analytics": () => import("../pages/BusinessIntelligencePage"),
  "/reports": () => import("../pages/ReportsPage"),
  "/settings": () => import("../pages/SettingsPage"),
  "/activity": () => import("../pages/ActivityPage"),
  "/activity-audit": () => import("../pages/ActivityAuditPage"),
  "/billing": () => import("../pages/billing/BillingReconciliationLayout"),
  "/billing/overview": () => import("../pages/billing/BillingOverviewPage"),
  "/billing/billing-gaps": () => import("../pages/billing/BillingModulePage"),
  "/billing/manual-review": () => import("../pages/billing/BillingModulePage"),
};

const warmed = new Set<string>();

function normalizePath(to: string): string {
  const path = String(to || "/").split("?")[0].split("#")[0] || "/";
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export function prefetchRoute(to: string) {
  const path = normalizePath(to);
  if (warmed.has(path)) return;

  const exact = prefetchers[path];
  if (exact) {
    warmed.add(path);
    void exact().catch(() => {
      warmed.delete(path);
    });
    return;
  }

  // Prefix match for nested routes (e.g. /agencies/12, /billing/gaps)
  const prefix = Object.keys(prefetchers)
    .filter((k) => k !== "/" && path.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) {
    warmed.add(path);
    void prefetchers[prefix]().catch(() => {
      warmed.delete(path);
    });
  }
}

export function routePrefetchHandlers(to: string) {
  const run = () => prefetchRoute(to);
  return {
    onMouseEnter: run,
    onFocus: run,
    onTouchStart: run,
  };
}
