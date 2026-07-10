import { Badge, Stack, Text } from "@chakra-ui/react";

export function DstvSerialMissingBadge({ compact = false }: { compact?: boolean }) {
  return (
    <Stack gap={compact ? 0 : 1}>
      <Badge colorPalette="orange" variant="subtle" w="fit-content">
        DSTV serial missing
      </Badge>
      {!compact && (
        <Text fontSize="xs" color="orange.700">
          Add the decoder serial number in customer details.
        </Text>
      )}
    </Stack>
  );
}
