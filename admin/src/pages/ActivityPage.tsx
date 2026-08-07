import { useCallback, useEffect, useState } from "react";
import { Box, useBreakpointValue } from "@chakra-ui/react";
import { Navigate } from "react-router-dom";
import { ActivityPanel } from "../components/ActivityPanel";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { PageErrorBanner } from "../components/ui/pageLayout";
import { api, type ActivityItem } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { canAccessFinance, isPartner } from "../lib/rbac";
import { useActivitySocket } from "../hooks/useActivitySocket";
import {
  SUPPORT_ACTIVITY_EVENT_TYPES,
  prependActivityItem,
} from "../lib/activityFeed";

const ACTIVITY_LIMIT = 80;

export function ActivityPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Activity is a mobile module only — desktop keeps it on the homepage rail.
  const isDesktop = useBreakpointValue({ base: false, lg: true }, { ssr: false });
  const finance = canAccessFinance(user);
  const partner = isPartner(user);
  const liveEnabled = !isDesktop && !partner;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const load = finance
      ? api.getActivity(ACTIVITY_LIMIT).then((res) => res.data)
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
  }, [user, finance]);

  const onLiveActivity = useCallback(
    (item: ActivityItem) => {
      if (!finance && !SUPPORT_ACTIVITY_EVENT_TYPES.has(item.eventType)) return;
      setItems((prev) => prependActivityItem(prev, item, ACTIVITY_LIMIT));
    },
    [finance]
  );

  useActivitySocket(onLiveActivity, liveEnabled);

  if (isDesktop) {
    return <Navigate to="/" replace />;
  }

  if (partner) {
    return (
      <Box>
        <MobilePageChrome title="Activity" />
        <PageErrorBanner>Activity is not available for partner accounts.</PageErrorBanner>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={2} minW={0}>
      <MobilePageChrome title="Activity" />
      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}
      <ActivityPanel items={items} loading={loading} variant="page" live />
    </Box>
  );
}
