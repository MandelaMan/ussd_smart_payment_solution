import { Box, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

export function FilterField({
  label,
  children,
  flex,
  minW,
}: {
  label: string;
  children: ReactNode;
  flex?: string | number | Record<string, string | number>;
  minW?: string | number;
}) {
  return (
    <Box flex={flex} minW={minW}>
      <Text fontSize="xs" fontWeight="medium" color="gray.500" mb={1}>
        {label}
      </Text>
      {children}
    </Box>
  );
}
