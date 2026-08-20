import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiArrowLeft, FiEye } from "react-icons/fi";
import { useAuth } from "../lib/authContext";
import { toaster } from "./ui/toaster";
import { BRAND } from "../theme";

export function ImpersonationBanner() {
  const { user, stopImpersonation } = useAuth();
  const navigate = useNavigate();
  const [stopping, setStopping] = useState(false);

  if (!user?.impersonating) return null;

  async function handleBackToAdmin() {
    if (stopping) return;
    setStopping(true);
    try {
      await stopImpersonation();
      toaster.create({
        title: "Returned to your admin session",
        type: "success",
      });
      navigate("/", { replace: true });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Could not return to admin",
        type: "error",
      });
    } finally {
      setStopping(false);
    }
  }

  return (
    <Box
      flexShrink={0}
      bg={BRAND.sandyBrown}
      color="gray.900"
      px={{ base: 3, md: 4 }}
      py={2.5}
      borderBottomWidth="2px"
      borderBottomColor="orange.500"
    >
      <Flex
        align="center"
        justify="space-between"
        gap={3}
        wrap="wrap"
        maxW="100%"
      >
        <Flex align="center" gap={2.5} minW={0}>
          <FiEye size={18} />
          <Box minW={0}>
            <Text fontSize="sm" fontWeight="bold" lineHeight="short">
              Session is impersonated
            </Text>
            <Text fontSize="xs" truncate>
              Viewing as {user.name}
              {user.email ? ` · ${user.email}` : ""}
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
          loading={stopping}
          onClick={() => void handleBackToAdmin()}
        >
          <FiArrowLeft />
          Back to admin
        </Button>
      </Flex>
    </Box>
  );
}
