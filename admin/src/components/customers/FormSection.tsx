import { Box, Grid, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

export function FormSection({
  title,
  description,
  children,
  sideBySide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  sideBySide?: boolean;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      p={4}
      bg="bg.subtle"
    >
      <Text fontWeight="semibold" fontSize="sm" color="fg">
        {title}
      </Text>
      {description && (
        <Text fontSize="xs" color="fg.muted" mt={0.5} mb={3}>
          {description}
        </Text>
      )}
      {!description && <Box mb={3} />}
      <Grid
        templateColumns={
          sideBySide
            ? "repeat(2, minmax(0, 1fr))"
            : { base: "1fr", md: "repeat(2, minmax(0, 1fr))" }
        }
        gap={4}
        css={{ "& > *": { minWidth: 0, width: "100%" } }}
      >
        {children}
      </Grid>
    </Box>
  );
}
