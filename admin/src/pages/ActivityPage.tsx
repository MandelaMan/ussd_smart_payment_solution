import { useEffect, useState } from "react";
import { Box, useBreakpointValue } from "@chakra-ui/react";
import { Navigate } from "react-router-dom";
import { ActivityPanel } from "../components/ActivityPanel";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { PageErrorBanner } from "../components/ui/pageLayout";
import { api, type ActivityItem } from "../lib/api";
import { useAuth } from "../lib/auth";
import { canAccessFinance, normalizeRole } from "../lib/rbac";

export function ActivityPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Activity is a mobile module only — desktop keeps it on the homepage rail.
  const isDesktop = useBreakpointValue({ base: false, lg: true }, { ssr: false });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const load = canAccessFinance(user)
      ? api.getActivity(80).then((res) => res.data)
      : api.getSupportStats("30d").then((res) => res.activity || []);

    load
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load activity");
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (isDesktop) {
    return <Navigate to="/" replace />;
  }

  const role = normalizeRole(user?.role);
  if (role === "partner") {
    return (
      <Box>
        <MobilePageChrome title="Activity" description="Recent payments and integrations" />
        <PageErrorBanner>Activity is not available for partner accounts.</PageErrorBanner>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={2} minW={0}>
      <MobilePageChrome
        title="Activity"
        description="Payments and integration events"
      />
      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}
      <ActivityPanel items={items} loading={loading} variant="page" />
    </Box>
  );
}
