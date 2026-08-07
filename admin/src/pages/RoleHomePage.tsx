import { Box } from "@chakra-ui/react";
import { useAuth } from "../lib/authContext";
import {
  isAdministrator,
  useCeoDashboard,
  usePartnerDashboard,
  useSupportDashboard,
} from "../lib/rbac";
import { DashboardPage } from "./DashboardPage";
import { SupportDashboardPage } from "./SupportDashboardPage";
import { PartnerDashboardPage } from "./PartnerDashboardPage";
import { CeoDashboardPage } from "./CeoDashboardPage";

/**
 * RoleHomePage is already lazy-loaded from App. Import dashboards statically so
 * we don't nest a second Suspense that can spin forever after broken Vite HMR.
 *
 * Home selection matches the pre-RBAC behavior:
 * - Administrator / finance ops → classic finance Home (DashboardPage)
 * - Partner / Support / Executive → specialty dashboards
 */
export function RoleHomePage() {
  const { user } = useAuth();
  const admin = isAdministrator(user);
  const partner = usePartnerDashboard(user);
  const support = useSupportDashboard(user);
  const ceo = useCeoDashboard(user);

  let home = <DashboardPage />;
  if (!admin) {
    if (partner) home = <PartnerDashboardPage />;
    else if (support) home = <SupportDashboardPage />;
    else if (ceo) home = <CeoDashboardPage />;
  }

  return (
    <Box
      flex={{ lg: 1 }}
      minH={{ lg: 0 }}
      minW={0}
      w="full"
      display={{ lg: "flex" }}
      flexDirection="column"
    >
      {home}
    </Box>
  );
}
