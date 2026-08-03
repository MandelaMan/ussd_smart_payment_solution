import { Box } from "@chakra-ui/react";
import { useAuth } from "../lib/authContext";
import {
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
 */
export function RoleHomePage() {
  const { user } = useAuth();
  const partner = usePartnerDashboard(user);
  const support = useSupportDashboard(user);
  const ceo = useCeoDashboard(user);

  return (
    <Box
      flex={{ lg: 1 }}
      minH={{ lg: 0 }}
      minW={0}
      w="full"
      display={{ lg: "flex" }}
      flexDirection="column"
    >
      {partner ? (
        <PartnerDashboardPage />
      ) : support ? (
        <SupportDashboardPage />
      ) : ceo ? (
        <CeoDashboardPage />
      ) : (
        <DashboardPage />
      )}
    </Box>
  );
}
