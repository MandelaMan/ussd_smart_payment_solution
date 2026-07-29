import { Suspense, lazy } from "react";
import { Box, Flex, Spinner } from "@chakra-ui/react";
import { useAuth } from "../lib/auth";
import {
  useCeoDashboard,
  usePartnerDashboard,
  useSupportDashboard,
} from "../lib/rbac";
import { BRAND } from "../theme";

const DashboardPage = lazy(() =>
  import("./DashboardPage").then((m) => ({ default: m.DashboardPage }))
);
const SupportDashboardPage = lazy(() =>
  import("./SupportDashboardPage").then((m) => ({ default: m.SupportDashboardPage }))
);
const PartnerDashboardPage = lazy(() =>
  import("./PartnerDashboardPage").then((m) => ({ default: m.PartnerDashboardPage }))
);
const CeoDashboardPage = lazy(() =>
  import("./CeoDashboardPage").then((m) => ({ default: m.CeoDashboardPage }))
);

function DashFallback() {
  return (
    <Flex minH="40vh" align="center" justify="center">
      <Spinner color={BRAND.cerulean} size="lg" borderWidth="3px" />
    </Flex>
  );
}

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
      <Suspense fallback={<DashFallback />}>
        {partner ? (
          <PartnerDashboardPage />
        ) : support ? (
          <SupportDashboardPage />
        ) : ceo ? (
          <CeoDashboardPage />
        ) : (
          <DashboardPage />
        )}
      </Suspense>
    </Box>
  );
}
