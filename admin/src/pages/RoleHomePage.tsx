import { Box, Text } from "@chakra-ui/react";
import { useAuth } from "../lib/authContext";
import {
  hasPermission,
  isAdministrator,
  useCeoDashboard,
  usePartnerDashboard,
  useSupportDashboard,
} from "../lib/rbac";
import { DashboardPage } from "./DashboardPage";
import { SupportDashboardPage } from "./SupportDashboardPage";
import { PartnerDashboardPage } from "./PartnerDashboardPage";
import { CeoDashboardPage } from "./CeoDashboardPage";

function LimitedHomePage() {
  return (
    <Box p={6}>
      <Text fontSize="lg" fontWeight="semibold">
        Home
      </Text>
      <Text mt={2} color="fg.muted" fontSize="sm">
        Your account can sign in, but no module access has been assigned yet.
        Ask an administrator to add you to a user group.
      </Text>
    </Box>
  );
}

/**
 * RoleHomePage is already lazy-loaded from App. Import dashboards statically so
 * we don't nest a second Suspense that can spin forever after broken Vite HMR.
 *
 * Home selection:
 * - Administrator / finance home → classic finance DashboardPage
 * - Partner / Support / Executive → specialty dashboards
 * - Authenticated with no module dashboard → limited home
 */
export function RoleHomePage() {
  const { user } = useAuth();
  const admin = isAdministrator(user);
  const partner = usePartnerDashboard(user);
  const support = useSupportDashboard(user);
  const ceo = useCeoDashboard(user);
  const financeHome = hasPermission(user, "dashboard.finance");

  let home = <LimitedHomePage />;
  if (admin || (financeHome && !partner && !support && !ceo)) {
    home = <DashboardPage />;
  }
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
