import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { SkeletonBlock } from "./ui/SkeletonBlock";
import {
  FiAlertCircle,
  FiBriefcase,
  FiCheckCircle,
  FiCreditCard,
  FiEdit3,
  FiFileText,
  FiHome,
  FiMail,
  FiMessageSquare,
  FiPackage,
  FiPlus,
  FiUser,
  FiUsers,
  FiWifi,
} from "react-icons/fi";
import type { ActivityItem } from "../lib/api";
import { formatCurrency, timeAgo } from "../lib/api";
import { filterActivityFeedItems } from "../lib/activityFeed";

const EVENT_ICONS: Record<string, typeof FiCreditCard> = {
  payment_received: FiCreditCard,
  payment_failed: FiAlertCircle,
  payment_allocated: FiCreditCard,
  zoho_invoice_created: FiFileText,
  zoho_invoice_updated: FiFileText,
  zoho_invoice_failed: FiAlertCircle,
  zoho_credit_note_created: FiFileText,
  zoho_customer_linked: FiFileText,
  zoho_trial_started: FiFileText,
  tisp_reconnected: FiWifi,
  tisp_reconnect_failed: FiAlertCircle,
  customer_created: FiPlus,
  customer_created_tisp_failed: FiAlertCircle,
  customer_created_zoho_failed: FiAlertCircle,
  customer_updated: FiEdit3,
  customer_upgraded: FiPackage,
  customer_downgraded: FiPackage,
  customer_cancelled: FiAlertCircle,
  customer_disconnected: FiWifi,
  customer_paused: FiUser,
  customer_deleted: FiAlertCircle,
  customer_apartment_switched: FiHome,
  customer_type_changed: FiUser,
  customer_imported: FiPlus,
  building_created: FiHome,
  building_updated: FiHome,
  product_created: FiPackage,
  product_updated: FiPackage,
  product_deleted: FiPackage,
  agency_created: FiBriefcase,
  agency_updated: FiBriefcase,
  lead_created: FiMessageSquare,
  lead_updated: FiMessageSquare,
  lead_email: FiMail,
  communication_email: FiMail,
  billing_email_sent: FiMail,
  user_created: FiUsers,
  user_updated: FiUsers,
};

const SOURCE_COLORS: Record<string, string> = {
  mpesa: "brand.600",
  zoho: "blue.500",
  tisp: "teal.500",
  admin: "purple.500",
  reconciliation: "orange.500",
};

/** Strip trailing " (REF)" when ref is shown separately. */
function subjectLabel(item: ActivityItem): string | null {
  const raw = item.message?.trim() || null;
  if (!raw) return null;
  if (!item.customerRef) return raw;
  const suffix = ` (${item.customerRef})`;
  if (raw.endsWith(suffix)) {
    const without = raw.slice(0, -suffix.length).trim();
    return without || raw;
  }
  return raw;
}

type Props = {
  items: ActivityItem[];
  loading?: boolean;
  /** `rail` = dashboard side panel; `page` = mobile full-page (borderless). */
  variant?: "rail" | "page";
  live?: boolean;
};

export function ActivityPanel({
  items,
  loading,
  variant = "rail",
}: Props) {
  const isPage = variant === "page";
  const list = filterActivityFeedItems(items);

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
            Recent Activity
          </Text>
        </Box>
      ) : null}

      <Stack
        gap={isPage ? 1 : 0}
        flex={1}
        minH={0}
        overflowY={isPage ? "visible" : "auto"}
        css={
          isPage
            ? undefined
            : {
                scrollbarWidth: "thin",
                scrollbarColor: "var(--chakra-colors-gray-300) transparent",
                "&::-webkit-scrollbar": { width: "4px" },
                "&::-webkit-scrollbar-track": { background: "transparent" },
                "&::-webkit-scrollbar-thumb": {
                  background: "var(--chakra-colors-gray-300)",
                  borderRadius: "999px",
                },
              }
        }
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

        {!loading && list.length === 0 && (
          <Text fontSize="xs" color="fg.subtle" p={isPage ? 0 : { base: 2.5, xl: 3 }}>
            No activity yet.
          </Text>
        )}

        {list.map((item) => {
          const Icon = EVENT_ICONS[item.eventType] || FiCheckCircle;
          const iconColor = SOURCE_COLORS[item.source] || "gray.500";
          const failed = item.status === "failed";
          const actor = item.actorName?.trim() || null;
          const subject = subjectLabel(item);
          const showRef =
            Boolean(item.customerRef) &&
            !(subject && item.customerRef && subject.includes(item.customerRef));

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
                {actor ? (
                  <>
                    <Text fontSize={{ base: "xs", xl: "sm" }} fontWeight="semibold" color="fg" lineClamp={1}>
                      {actor}
                    </Text>
                    <Text fontSize="2xs" color="fg.muted" mt={0.5} lineClamp={2}>
                      {item.title}
                      {subject ? ` · ${subject}` : ""}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text fontSize={{ base: "xs", xl: "sm" }} fontWeight="semibold" color="fg" lineClamp={2}>
                      {item.title}
                    </Text>
                    {subject ? (
                      <Text fontSize="2xs" color="fg.muted" mt={0.5} lineClamp={2}>
                        {subject}
                      </Text>
                    ) : null}
                  </>
                )}
                <Flex gap={2} mt={1} flexWrap="wrap" align="center">
                  {item.amount != null && (
                    <Text fontSize="2xs" fontWeight="medium" color="brand.700">
                      {formatCurrency(item.amount)}
                    </Text>
                  )}
                  {showRef ? (
                    <Text fontSize="2xs" color="fg.subtle">
                      {item.customerRef}
                    </Text>
                  ) : null}
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
