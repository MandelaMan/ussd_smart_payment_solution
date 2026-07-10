import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { SkeletonBlock } from "./ui/SkeletonBlock";
import {
  FiAlertCircle,
  FiCheckCircle,
  FiCreditCard,
  FiFileText,
  FiWifi,
} from "react-icons/fi";
import type { ActivityItem } from "../lib/api";
import { formatCurrency, timeAgo } from "../lib/api";

const EVENT_ICONS: Record<string, typeof FiCreditCard> = {
  payment_received: FiCreditCard,
  payment_failed: FiAlertCircle,
  zoho_invoice_created: FiFileText,
  zoho_invoice_updated: FiFileText,
  zoho_invoice_failed: FiAlertCircle,
  tisp_reconnected: FiWifi,
  tisp_reconnect_failed: FiAlertCircle,
};

const SOURCE_COLORS: Record<string, string> = {
  mpesa: "brand.600",
  zoho: "blue.500",
  tisp: "teal.500",
};

type Props = {
  items: ActivityItem[];
  loading?: boolean;
};

export function ActivityPanel({ items, loading }: Props) {
  return (
    <Box
      w={{ base: "full", xl: "280px" }}
      flexShrink={0}
      bg="white"
      borderRadius={{ base: "lg", xl: 0 }}
      border={{ base: "1px solid", xl: "none" }}
      borderLeft={{ xl: "1px solid" }}
      borderColor={{ base: "gray.100", xl: "brand.100" }}
      overflow="hidden"
      h={{ xl: "100%" }}
      minH={{ xl: 0 }}
      flex={{ xl: 1 }}
      display="flex"
      flexDirection="column"
    >
      <Box px={3} py={3} borderBottom="1px solid" borderColor="gray.100">
        <Text fontSize="md" fontWeight="semibold" color="gray.800">
          Activity
        </Text>
        <Text fontSize="xs" color="gray.500">
          Payments and integrations
        </Text>
      </Box>

      <Stack
        gap={0}
        flex={1}
        minH={0}
        overflowY="auto"
        css={{ "&::-webkit-scrollbar": { width: "4px" } }}
      >
        {loading &&
          Array.from({ length: 5 }).map((_, i) => (
            <Flex
              key={i}
              gap={3}
              px={3}
              py={3}
              borderBottom="1px solid"
              borderColor="gray.50"
              align="flex-start"
            >
              <SkeletonBlock boxSize="32px" borderRadius="full" />
              <Box flex={1}>
                <SkeletonBlock height="14px" width="85%" mb={2} />
                <SkeletonBlock height="12px" width="55%" />
              </Box>
            </Flex>
          ))}

        {!loading && items.length === 0 && (
          <Text fontSize="xs" color="gray.400" p={3}>
            No activity yet.
          </Text>
        )}

        {items.map((item) => {
          const Icon = EVENT_ICONS[item.eventType] || FiCheckCircle;
          const iconColor = SOURCE_COLORS[item.source] || "gray.500";
          const failed = item.status === "failed";

          return (
            <Flex
              key={item.id}
              gap={3}
              px={3}
              py={3}
              borderBottom="1px solid"
              borderColor="gray.50"
              _hover={{ bg: "gray.50" }}
              align="flex-start"
            >
              <Flex
                boxSize="32px"
                borderRadius="full"
                bg={failed ? "red.50" : "brand.50"}
                color={failed ? "red.500" : iconColor}
                align="center"
                justify="center"
                flexShrink={0}
              >
                <Icon size={15} />
              </Flex>
              <Box flex={1} minW={0}>
                <Text fontSize="sm" fontWeight="semibold" color="gray.800" lineClamp={2}>
                  {item.title}
                </Text>
                {item.message && (
                  <Text fontSize="xs" color="gray.500" mt={0.5} lineClamp={2}>
                    {item.message}
                  </Text>
                )}
                <Flex gap={2} mt={1} flexWrap="wrap" align="center">
                  {item.amount != null && (
                    <Text fontSize="xs" fontWeight="medium" color="brand.700">
                      {formatCurrency(item.amount)}
                    </Text>
                  )}
                  {item.customerRef && (
                    <Text fontSize="xs" color="gray.400">
                      {item.customerRef}
                    </Text>
                  )}
                  <Text fontSize="xs" color="gray.400" ml="auto">
                    {timeAgo(item.createdAt)}
                  </Text>
                </Flex>
              </Box>
            </Flex>
          );
        })}
      </Stack>
    </Box>
  );
}
