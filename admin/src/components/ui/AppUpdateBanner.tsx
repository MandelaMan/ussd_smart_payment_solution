import { useEffect, useRef, useState } from "react";
import { Box, Button, Flex, Text } from "@chakra-ui/react";

/**
 * Detects a newly deployed admin build (via the PWA service worker) and offers
 * a one-click reload. Avoids silent mid-session auto-reload, which previously
 * reapplied a stale cached shell.
 */
export function AppUpdateBanner() {
  const [ready, setReady] = useState(false);
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(
    null
  );

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

  if (!ready) return null;

  return (
    <Box
      position="fixed"
      top={0}
      left={0}
      right={0}
      zIndex={10000}
      bg="brand.700"
      color="white"
      px={4}
      py={2.5}
      boxShadow="md"
    >
      <Flex
        maxW="960px"
        mx="auto"
        align="center"
        justify="space-between"
        gap={3}
        wrap="wrap"
      >
        <Text fontSize="sm" fontWeight="medium">
          A new version of SUL Bix is available.
        </Text>
        <Button
          size="sm"
          colorPalette="gray"
          variant="solid"
          onClick={() => {
            void updateSWRef.current?.(true);
          }}
        >
          Refresh to update
        </Button>
      </Flex>
    </Box>
  );
}
