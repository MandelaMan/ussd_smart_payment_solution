import { Suspense, lazy } from "react";
import { Flex, Spinner } from "@chakra-ui/react";
import { useAuth } from "../lib/auth";
import { usePartnerDashboard, useSupportDashboard } from "../lib/rbac";
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

  return (
    <Suspense fallback={<DashFallback />}>
      {partner ? (
        <PartnerDashboardPage />
      ) : support ? (
        <SupportDashboardPage />
      ) : (
        <DashboardPage />
      )}
    </Suspense>
  );
}
