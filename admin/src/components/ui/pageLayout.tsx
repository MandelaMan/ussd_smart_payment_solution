import { Box, Flex, Heading, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { NotificationBell } from "../notifications/NotificationBell";
import { MobileFixedHeader } from "./MobileFixedHeader";
import { useConnectivity } from "../../hooks/useConnectivity";
import { isConnectivityErrorMessage } from "../../lib/connectivity";

/** Standard vertical rhythm for admin list and detail pages. */
export const PAGE_STACK_GAP = { base: 3, lg: 3 } as const;

/**
 * Shared mobile page header chrome.
 * Pinned with `.mobile-page-header` (position:fixed) — sticky fails inside the
 * overflow:hidden app shell used for the PWA viewport lock.
 */
export const mobileStickyHeaderProps = {
  bg: { base: "bg.panel", lg: "transparent" },
  px: { base: 4, lg: 0 },
  pt: {
    base: "max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.35rem))",
    lg: 0,
  },
  pb: { base: 3, lg: 0 },
  borderBottomWidth: { base: "1px", lg: "0px" },
  borderBottomColor: "border.muted",
  boxShadow: { base: "0 1px 0 rgba(15, 23, 42, 0.04)", lg: "none" },
};

/** List page stack — fills the main pane on desktop so table regions can scroll internally. */
export function ListPageStack({ children }: { children: ReactNode }) {
  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={PAGE_STACK_GAP}
      minW={0}
      maxW="100%"
      flex={{ lg: 1 }}
      minH={{ lg: 0 }}
      h={{ lg: "100%" }}
    >
      {children}
    </Box>
  );
}

/** Inline create/edit form card on list pages. */
export const inlineFormCardProps = {
  bg: "bg.panel",
  borderRadius: "lg",
  p: 4,
  border: "1px solid",
  borderColor: "border.muted",
  boxShadow: "sm",
} as const;

function shouldHideConnectivityError(children: ReactNode, connected: boolean) {
  if (isConnectivityErrorMessage(children)) return true;
  if (
    !connected &&
    typeof children === "string" &&
    /took too long|timed out/i.test(children)
  ) {
    return true;
  }
  return false;
}

export function PageErrorBanner({ children }: { children: ReactNode }) {
  const { status } = useConnectivity();
  if (shouldHideConnectivityError(children, status === "ok")) return null;
  return (
    <Box bg="red.50" color="red.700" px={3} py={2.5} borderRadius="md" fontSize="sm">
      {children}
    </Box>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Text textAlign="center" py={8} color="fg.subtle" fontSize="sm">
      {children}
    </Text>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  headingSize = "lg",
  sticky = true,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  headingSize?: "sm" | "md" | "lg";
  /** Fixed on mobile (default). Set false for embedded headers. */
  sticky?: boolean;
}) {
  const content = (
    <>
      <Box minW={0}>
        <Heading size={headingSize}>{title}</Heading>
        {description ? (
          <Text fontSize="sm" color="fg.muted" mt={0.5} lineHeight="1.4">
            {description}
          </Text>
        ) : null}
      </Box>
      {actions ? <Box flexShrink={0} w={{ base: "full", md: "auto" }}>{actions}</Box> : null}
    </>
  );

  if (!sticky) {
    return (
      <Flex
        justify="space-between"
        align={{ base: "start", md: "center" }}
        direction={{ base: "column", md: "row" }}
        gap={2}
        minW={0}
      >
        {content}
      </Flex>
    );
  }

  return (
    <>
      <MobileFixedHeader headerProps={mobileStickyHeaderProps}>
        <Flex justify="space-between" align="start" direction="column" gap={2} minW={0}>
          <Flex justify="space-between" align="start" gap={3} w="full" minW={0}>
            <Box minW={0} flex="1">
              <Heading size={headingSize}>{title}</Heading>
              {description ? (
                <Text fontSize="sm" color="fg.muted" mt={0.5} lineHeight="1.4">
                  {description}
                </Text>
              ) : null}
            </Box>
            <Box flexShrink={0} pt="2px">
              <NotificationBell compact />
            </Box>
          </Flex>
          {actions ? <Box flexShrink={0} w="full">{actions}</Box> : null}
        </Flex>
      </MobileFixedHeader>
      <Flex
        display={{ base: "none", lg: "flex" }}
        justify="space-between"
        align={{ base: "start", md: "center" }}
        direction={{ base: "column", md: "row" }}
        gap={{ base: 2, md: 6 }}
        minW={0}
        w="full"
        py={1}
      >
        {content}
      </Flex>
    </>
  );
}

/** Consistent dialog section header with bottom border. */
export const dialogHeaderProps = {
  px: 4,
  pt: 4,
  pb: 3,
  borderBottomWidth: "1px",
  borderColor: "border.muted",
} as const;
