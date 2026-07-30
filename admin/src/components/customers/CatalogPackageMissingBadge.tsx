import { Badge, Stack, Text } from "@chakra-ui/react";

export function CatalogPackageMissingBadge({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <Stack gap={compact ? 0 : 1}>
      <Badge colorPalette="orange" variant="subtle" w="fit-content">
        Package not on catalog
      </Badge>
      {!compact && (
        <Text fontSize="xs" color="orange.700">
          Relink this customer to a current plan (Basic / Basic Plus / Premium /
          Premium Plus) under Packages before syncing to TISP.
        </Text>
      )}
    </Stack>
  );
}
