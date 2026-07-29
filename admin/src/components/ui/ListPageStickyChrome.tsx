import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Desktop: title + filters stay put; only the table body region scrolls so
 * column headers never slide up into the filter row.
 * Mobile: normal document flow (MobileFixedHeader handles the top chrome).
 */
export function ListPageStickyChrome({
  children,
  gap = { base: 2, lg: 2.5 },
}: {
  children: ReactNode;
  /** Vertical space between title, tabs, and filters. */
  gap?: number | string | Record<string, number | string>;
}) {
  return (
    <Box
      data-list-page-sticky-chrome
      flexShrink={0}
      bg={{ lg: "bg.panel" }}
      pt={{ lg: 1 }}
      pb={{ lg: 4 }}
      px={{ lg: 0 }}
      display="flex"
      flexDirection="column"
      gap={gap}
      minW={0}
      mb={0}
    >
      {children}
    </Box>
  );
}

/** Table block with locked chrome + independently scrolling table region (desktop). */
export function ListPageTableSection({
  chrome,
  children,
}: {
  chrome: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={0}
      minW={0}
      flex={{ lg: 1 }}
      minH={{ lg: 0 }}
      h={{ lg: "100%" }}
      maxH={{ lg: "100%" }}
      position="relative"
      zIndex={1}
      // Inner scrollport: column headers sticky at top:0 of this box.
      css={{
        "@media (min-width: 62em)": {
          "--list-page-sticky-top": "0px",
        },
      }}
    >
      {chrome}
      <Box
        data-list-table-scroll
        flex={{ lg: 1 }}
        minH={{ lg: 0 }}
        overflow={{ base: "visible", lg: "auto" }}
        WebkitOverflowScrolling="touch"
        minW={0}
      >
        {children}
      </Box>
    </Box>
  );
}
