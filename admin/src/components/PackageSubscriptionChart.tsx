import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { formatDisplayText, getDisplayTextFull } from "../lib/formatText";
import { BRAND } from "../theme";

type PackageItem = {
  name: string;
  subscribers: number;
};

export function PackageSubscriptionChart({ data }: { data: PackageItem[] }) {
  const items = data.slice(0, 5);
  const max = Math.max(...items.map((d) => d.subscribers), 1);

  return (
    <Stack gap={0}>
      {items.map((item, index) => {
        const share = item.subscribers / max;
        const barWidth = Math.max(share * 100, 22);

        return (
          <Box
            key={item.name}
            py={3}
            borderBottom={index < items.length - 1 ? "1px solid" : undefined}
            borderColor="border"
          >
            <Flex h={{ base: "42px", md: "38px" }} borderRadius="md" overflow="hidden" bg="bg.muted">
              <Flex
                bg={BRAND.cerulean}
                w={`${barWidth}%`}
                minW={{ base: "96px", md: "120px" }}
                align="center"
                justify="space-between"
                px={3}
                gap={2}
              >
                <Text
                  fontSize="sm"
                  fontWeight="medium"
                  color="white"
                  truncate
                  title={getDisplayTextFull(item.name)}
                >
                  {formatDisplayText(item.name)}
                </Text>
                <Text fontSize="sm" fontWeight="bold" color="white" flexShrink={0}>
                  {item.subscribers.toLocaleString()}
                </Text>
              </Flex>
            </Flex>
          </Box>
        );
      })}
    </Stack>
  );
}
