import { Box, Flex } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Responsive flex sizes for filter fields inside FilterToolbar. */
export const FILTER_FLEX = {
  /** Full-width search on mobile, wider on desktop. */
  search: { base: "1 1 100%", lg: "2" },
  /** Standard filter — full width on mobile, half on sm+, inline on lg. */
  standard: { base: "1 1 100%", sm: "1 1 calc(50% - 6px)", lg: "1" },
  /** Wider filter (e.g. building select). */
  wide: { base: "1 1 100%", sm: "1 1 calc(50% - 6px)", lg: "1.4" },
  /** Compact filter — full width on mobile, half from sm up. */
  compact: { base: "1 1 100%", sm: "1 1 calc(50% - 6px)", lg: "1" },
} as const;

export function FilterToolbar({
  children,
  actions,
  zIndex = 2,
}: {
  children: ReactNode;
  /** Trailing actions (e.g. Export) — full-width on mobile, inline on desktop. */
  actions?: ReactNode;
  zIndex?: number;
}) {
  return (
    <Box
      display={{ base: "none", lg: "block" }}
      bg="bg.panel"
      borderRadius={{ base: "xl", lg: "lg" }}
      px={{ base: 3.5, lg: 3 }}
      py={{ base: 3.5, lg: 2.5 }}
      border="1px solid"
      borderColor="border.muted"
      position="relative"
      zIndex={zIndex}
      boxShadow={{ base: "sm", lg: "none" }}
      w="full"
      minW={0}
    >
      <Flex
        gap={{ base: 3, lg: 2 }}
        align={{ base: "stretch", lg: "flex-end" }}
        direction={{ base: "column", lg: "row" }}
        flexWrap={{ base: "wrap", lg: "nowrap" }}
        w="full"
        minW={0}
      >
        {children}
        {actions ? (
          <Box
            flexShrink={0}
            w={{ base: "full", lg: "auto" }}
            ml={{ base: 0, lg: "auto" }}
            pt={{ base: 1, lg: 0 }}
            display={{ base: "grid", lg: "flex" }}
            gridTemplateColumns="1fr"
            alignItems="flex-end"
            gap={2}
            css={{
              "& > *": { width: "100%" },
              "@media (min-width: 62em)": {
                "& > *": { width: "auto" },
              },
            }}
          >
            {actions}
          </Box>
        ) : null}
      </Flex>
    </Box>
  );
}
