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
  /** `rail` = dashboard side panel; `page` = mobile full-page (borderless). */
  variant?: "rail" | "page";
};

export function ActivityPanel({ items, loading, variant = "rail" }: Props) {
  const isPage = variant === "page";

  return (
    <Box
      w={isPage ? "full" : { base: "full", xl: "280px" }}
      flexShrink={0}
      bg={isPage ? "transparent" : "white"}
      borderRadius={isPage ? 0 : { base: "xl", xl: 0 }}
      border={isPage ? "none" : { base: "1px solid", xl: "none" }}
      borderLeft={isPage ? "none" : { xl: "1px solid" }}
      borderColor={isPage ? undefined : { base: "gray.100", xl: "brand.100" }}
      overflow="hidden"
      h={isPage ? "auto" : { base: "100%", xl: "100%" }}
      minH={isPage ? 0 : { base: "420px", xl: 0 }}
      flex={1}
      display="flex"
      flexDirection="column"
      boxShadow={isPage ? "none" : { base: "sm", xl: "none" }}
    >
      {!isPage ? (
        <Box px={{ base: 2.5, xl: 3 }} py={{ base: 2, xl: 3 }} borderBottom="1px solid" borderColor="border.muted">
          <Text fontSize="sm" fontWeight="semibold" color="fg">
            Activity
          </Text>
          <Text fontSize="2xs" color="fg.muted">
            Payments and integrations
          </Text>
        </Box>
      ) : null}

      <Stack
        gap={isPage ? 1 : 0}
        flex={1}
        minH={0}
        overflowY={isPage ? "visible" : "auto"}
        css={isPage ? undefined : { "&::-webkit-scrollbar": { width: "4px" } }}
      >
        {loading &&
          Array.from({ length: 5 }).map((_, i) => (
            <Flex
              key={i}
              gap={2}
              px={isPage ? 0 : { base: 2.5, xl: 3 }}
              py={{ base: 2, xl: 3 }}
              borderBottom={isPage ? "none" : "1px solid"}
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
          <Text fontSize="xs" color="fg.subtle" p={isPage ? 0 : { base: 2.5, xl: 3 }}>
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
              gap={{ base: 2, xl: 3 }}
              px={isPage ? 0 : { base: 2.5, xl: 3 }}
              py={{ base: 2, xl: 3 }}
              borderBottom={isPage ? "none" : "1px solid"}
              borderColor="gray.50"
              borderRadius={isPage ? "lg" : 0}
              _hover={{ bg: isPage ? "gray.50" : "gray.50" }}
              align="flex-start"
            >
              <Flex
                boxSize={{ base: "28px", xl: "32px" }}
                borderRadius="full"
                bg={failed ? "red.50" : "brand.50"}
                color={failed ? "red.500" : iconColor}
                align="center"
                justify="center"
                flexShrink={0}
              >
                <Icon size={14} />
              </Flex>
              <Box flex={1} minW={0}>
                <Text fontSize={{ base: "xs", xl: "sm" }} fontWeight="semibold" color="fg" lineClamp={2}>
                  {item.title}
                </Text>
                {item.message && (
                  <Text fontSize="2xs" color="fg.muted" mt={0.5} lineClamp={2}>
                    {item.message}
                  </Text>
                )}
                <Flex gap={2} mt={1} flexWrap="wrap" align="center">
                  {item.amount != null && (
                    <Text fontSize="2xs" fontWeight="medium" color="brand.700">
                      {formatCurrency(item.amount)}
                    </Text>
                  )}
                  {item.customerRef && (
                    <Text fontSize="2xs" color="fg.subtle">
                      {item.customerRef}
                    </Text>
                  )}
                  <Text fontSize="2xs" color="fg.subtle" ml="auto">
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
