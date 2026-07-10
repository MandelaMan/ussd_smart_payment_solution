import { Box, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

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
  return (
    <Box
      flex={flex}
      minW={minW}
      maxW="100%"
      w={{ base: hideOnMobile ? undefined : "full", lg: "auto" }}
      display={hideOnMobile ? { base: "none", lg: "block" } : undefined}
    >
      <Text
        fontSize={{ base: "sm", lg: "xs" }}
        fontWeight="medium"
        color="gray.600"
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
