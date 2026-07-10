import { useAuth } from "../lib/auth";
import { usePartnerDashboard, useSupportDashboard } from "../lib/rbac";
import { DashboardPage } from "./DashboardPage";
import { SupportDashboardPage } from "./SupportDashboardPage";
import { PartnerDashboardPage } from "./PartnerDashboardPage";

export function RoleHomePage() {
  const { user } = useAuth();
  if (usePartnerDashboard(user)) {
    return <PartnerDashboardPage />;
  }
  if (useSupportDashboard(user)) {
    return <SupportDashboardPage />;
  }
  return <DashboardPage />;
}
