import { useEffect, useRef } from "react";
import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { FiCloudOff, FiWifiOff } from "react-icons/fi";
import { confirmOnline } from "../lib/connectivity";
import { useConnectivity } from "../hooks/useConnectivity";
import { toaster } from "./ui/toaster";
import { BRAND } from "../theme";

export function ConnectivityBanner() {
  const { status, checking } = useConnectivity();
  const previousStatusRef = useRef(status);

  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previous === "ok" || status !== "ok") return;

    if (previous === "offline") {
      toaster.create({
        id: "connectivity-restored",
        title: "You're back online",
        description: "Connection restored.",
        type: "success",
      });
      return;
    }

    toaster.create({
      id: "connectivity-restored",
      title: "SUL Bix is back",
      description: "The server is responding again.",
      type: "success",
    });
  }, [status]);

  if (status === "ok") return null;

  const offline = status === "offline";

  return (
    <Box
      role="status"
      aria-live="polite"
      position="fixed"
      top={0}
      left={0}
      right={0}
      zIndex={9999}
      bg={BRAND.sandyBrown}
      color="gray.900"
      px={4}
      py={2.5}
      pt="max(0.65rem, env(safe-area-inset-top, 0px))"
      boxShadow="md"
      borderBottomWidth="2px"
      borderBottomColor="orange.500"
    >
      <Flex
        maxW="960px"
        mx="auto"
        align="center"
        justify="space-between"
        gap={3}
        wrap="wrap"
      >
        <Flex align="center" gap={2.5} minW={0}>
          <Box flexShrink={0} aria-hidden>
            {offline ? <FiWifiOff size={18} /> : <FiCloudOff size={18} />}
          </Box>
          <Box minW={0}>
            <Text fontSize="sm" fontWeight="bold" lineHeight="short">
              {offline ? "No internet connection" : "Can't reach SUL Bix"}
            </Text>
            <Text fontSize="xs" lineHeight="short">
              {offline
                ? "SUL Bix can't reach the network. Check your Wi‑Fi or mobile data — we'll notify you when it's back."
                : "Your internet is connected, but the server isn't responding. We'll keep trying."}
            </Text>
          </Box>
        </Flex>
        <Button
          size="sm"
          bg="gray.900"
          color="white"
          flexShrink={0}
          _hover={{ bg: "gray.800" }}
          _active={{ bg: "black" }}
          loading={checking}
          onClick={() => void confirmOnline({ userInitiated: true })}
        >
          Try again
        </Button>
      </Flex>
    </Box>
  );
}
