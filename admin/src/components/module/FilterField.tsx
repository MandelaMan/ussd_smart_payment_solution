import { Box, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Toolbar flex values (FILTER_FLEX) include half-width `sm` bases for wrapping
 * toolbars. Those must not apply in the mobile filter sheet — only honor flex at `lg+`.
 */
function desktopOnlyFlex(
  flex?: string | number | Record<string, string | number>
): Record<string, string | number> | undefined {
  if (flex == null) return undefined;
  if (typeof flex === "object") {
    const lg = flex.lg ?? flex.base ?? 1;
    return { lg };
  }
  return { lg: flex };
}

export function FilterField({
  label,
  children,
  flex,
  minW = 0,
  /** Hide this field below the `lg` breakpoint (e.g. search already in MobilePageChrome). */
  hideOnMobile = false,
}: {
  label: string;
  children: ReactNode;
  flex?: string | number | Record<string, string | number>;
  minW?: string | number | Record<string, string | number>;
  hideOnMobile?: boolean;
}) {
  const resolvedMinW =
    typeof minW === "object" ? { base: 0, ...minW } : { base: 0, lg: minW };

  return (
    <Box
      flex={desktopOnlyFlex(flex)}
      minW={resolvedMinW}
      maxW="100%"
      w={{ base: "full", lg: "auto" }}
      alignSelf={{ base: "stretch", lg: "auto" }}
      display={hideOnMobile ? { base: "none", lg: "block" } : undefined}
    >
      <Text
        fontSize={{ base: "sm", lg: "xs" }}
        fontWeight="medium"
        color="fg.muted"
        mb={{ base: 1.5, lg: 1 }}
      >
        {label}
      </Text>
      <Box w="full" minW={0}>
        {children}
      </Box>
    </Box>
  );
}
