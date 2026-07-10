import { Box, Flex, Heading, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Standard vertical rhythm for admin list and detail pages. */
export const PAGE_STACK_GAP = { base: 3, lg: 3 } as const;

/** List page stack — tight on mobile for edge-to-edge lists. */
export function ListPageStack({ children }: { children: ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap={PAGE_STACK_GAP} minW={0} maxW="100%">
      {children}
    </Box>
  );
}

/** Inline create/edit form card on list pages. */
export const inlineFormCardProps = {
  bg: "white",
  borderRadius: "lg",
  p: 4,
  border: "1px solid",
  borderColor: "gray.100",
  boxShadow: "sm",
} as const;

export function PageErrorBanner({ children }: { children: ReactNode }) {
  return (
    <Box bg="red.50" color="red.700" px={3} py={2.5} borderRadius="md" fontSize="sm">
      {children}
    </Box>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Text textAlign="center" py={8} color="gray.400" fontSize="sm">
      {children}
    </Text>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  headingSize = "lg",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  headingSize?: "sm" | "md" | "lg";
}) {
  return (
    <Flex
      justify="space-between"
      align={{ base: "start", md: "center" }}
      direction={{ base: "column", md: "row" }}
      gap={2}
    >
      <Box>
        <Heading size={headingSize}>{title}</Heading>
        {description ? (
          <Text fontSize="sm" color="gray.500" mt={0.5} lineHeight="1.4">
            {description}
          </Text>
        ) : null}
      </Box>
      {actions}
    </Flex>
  );
}

/** Consistent dialog section header with bottom border. */
export const dialogHeaderProps = {
  px: 4,
  pt: 4,
  pb: 3,
  borderBottomWidth: "1px",
  borderColor: "gray.100",
} as const;
