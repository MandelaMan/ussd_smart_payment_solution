export function getPageTitle(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return "Dashboard";
  if (path === "/customers/new") return "New customer";
  if (path.startsWith("/customers")) return "Customers";
  if (path.startsWith("/transactions")) return "Transactions";
  if (path.startsWith("/synchronization")) return "Synchronization";
  if (path === "/billing/unallocated-mpesa") return "Unallocated M-Pesa";
  if (path === "/billing/billing-gaps") return "Billing Gaps";
  if (path === "/billing/manual-review") return "Manual Review";
  if (path === "/billing/communications") return "Customer Communications";
  if (path.startsWith("/billing")) return "Billing";
  if (path.startsWith("/analytics")) return "Business Intelligence";
  if (path.startsWith("/reports")) return "Reports";
  if (path.startsWith("/products")) return "Packages";
  if (path.startsWith("/buildings")) return "Buildings";
  if (path.startsWith("/agencies/")) return "Agency";
  if (path.startsWith("/agencies")) return "Agencies";
  if (path.startsWith("/apartments")) return "Apartment history";
  if (path.startsWith("/logs")) return "Logs";
  if (path.startsWith("/settings")) return "Settings";
  return "Starlynx";
}
