import { useEffect, useRef, useState } from "react";
import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { BRAND } from "../../theme";

/**
 * Detects a newly deployed admin build (via the PWA service worker) and offers
 * a one-click reload. Avoids silent mid-session auto-reload, which previously
 * reapplied a stale cached shell.
 *
 * Note: vite-plugin-pwa 1.x `updateSW(true)` only sends skipWaiting — it no
 * longer reloads from the boolean arg. Reload is handled explicitly here.
 */
export function AppUpdateBanner() {
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(
    null
  );
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    let pollId: number | undefined;

    void import("virtual:pwa-register").then(({ registerSW }) => {
      if (cancelled) return;

      updateSWRef.current = registerSW({
        immediate: true,
        onNeedRefresh() {
          if (!cancelled) setReady(true);
        },
        onRegisteredSW(_url, registration) {
          if (!registration || cancelled) return;
          registrationRef.current = registration;
          // Check for a new deploy while the tab stays open.
          pollId = window.setInterval(() => {
            void registration.update();
          }, 60_000);
        },
      });
    });

    return () => {
      cancelled = true;
      if (pollId != null) window.clearInterval(pollId);
    };
  }, []);

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);

    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    // Prefer controllerchange so the new SW is active before reload.
    navigator.serviceWorker?.addEventListener("controllerchange", reload, {
      once: true,
    });

    const waiting = registrationRef.current?.waiting;
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" });
    }

    void updateSWRef.current?.(true).catch(() => {
      /* fall through to timeout reload */
    });

    // Always reload — controlling/isUpdate can fail to fire in some browsers.
    window.setTimeout(reload, 400);
  };

  if (!ready) return null;

  return (
    <Box
      position="fixed"
      top={0}
      left={0}
      right={0}
      zIndex={10000}
      bg={BRAND.paleAzure}
      color={BRAND.cerulean}
      px={4}
      py={2.5}
      boxShadow="md"
      borderBottomWidth="1px"
      borderBottomColor="brand.400"
    >
      <Flex
        maxW="960px"
        mx="auto"
        align="center"
        justify="space-between"
        gap={3}
        wrap="wrap"
      >
        <Text fontSize="sm" fontWeight="semibold">
          A new version of SUL Bix is available.
        </Text>
        <Button
          size="sm"
          bg={BRAND.cerulean}
          color="white"
          _hover={{ bg: "brand.700" }}
          _active={{ bg: "brand.800" }}
          loading={refreshing}
          onClick={handleRefresh}
        >
          Refresh to update
        </Button>
      </Flex>
    </Box>
  );
}
