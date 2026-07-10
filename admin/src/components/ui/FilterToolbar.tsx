import { Box, Flex } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Responsive flex sizes for filter fields inside FilterToolbar. */
export const FILTER_FLEX = {
  /** Full-width search on mobile, wider on desktop. */
  search: { base: "1 1 100%", lg: "2" },
  /** Standard filter — stacks on mobile, half-width on sm, inline on lg. */
  standard: { base: "1 1 100%", sm: "1 1 calc(50% - 4px)", lg: "1" },
  /** Wider filter (e.g. building select). */
  wide: { base: "1 1 100%", sm: "1 1 calc(50% - 4px)", lg: "1.4" },
  /** Compact filter — half width from mobile up. */
  compact: { base: "1 1 calc(50% - 4px)", lg: "1" },
} as const;

export function FilterToolbar({
  children,
  zIndex = 2,
}: {
  children: ReactNode;
  zIndex?: number;
}) {
  return (
    <Box
      display={{ base: "none", lg: "block" }}
      bg="white"
      borderRadius="lg"
      px={3}
      py={2.5}
      border="1px solid"
      borderColor="gray.100"
      position="relative"
      zIndex={zIndex}
    >
      <Flex gap={2} align="flex-end" flexWrap={{ base: "wrap", lg: "nowrap" }} w="full">
        {children}
      </Flex>
    </Box>
  );
}
