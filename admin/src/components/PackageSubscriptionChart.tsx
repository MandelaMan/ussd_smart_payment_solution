import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { formatProductNameForDisplay } from "../lib/formatText";
import { BRAND } from "../theme";

type PackageItem = {
  name: string;
  subscribers: number;
  speed?: string;
  detail?: string;
};

export function PackageSubscriptionChart({ data }: { data: PackageItem[] }) {
  const items = data.slice(0, 5);
  const max = Math.max(...items.map((d) => d.subscribers), 1);
  const showPremise =
    new Set(items.map((d) => d.detail).filter(Boolean)).size > 1;

  return (
    <Stack gap={3.5} pt={1}>
      {items.map((item, index) => {
        const share = item.subscribers / max;
        const label = formatProductNameForDisplay(item.name);
        const isLeader = index === 0;
        const meta = [item.speed, showPremise ? item.detail : null]
          .filter(Boolean)
          .join(" · ");

        return (
          <Stack key={`${label}-${meta}-${item.subscribers}-${index}`} gap={1.5}>
            <Flex align="start" gap={3} minW={0}>
              <Flex
                w="22px"
                h="22px"
                mt="1px"
                flexShrink={0}
                align="center"
                justify="center"
                borderRadius="full"
                bg={isLeader ? BRAND.cerulean : "brand.50"}
                color={isLeader ? "white" : "brand.700"}
                fontSize="2xs"
                fontWeight="bold"
              >
                {index + 1}
              </Flex>
              <Box flex="1" minW={0}>
                <Text
                  fontSize="sm"
                  fontWeight="medium"
                  color="fg"
                  lineHeight="1.35"
                  lineClamp={2}
                  title={label}
                >
                  {label}
                </Text>
                {meta ? (
                  <Text fontSize="2xs" color="fg.muted" mt={0.5} lineHeight="1.2">
                    {meta}
                  </Text>
                ) : null}
              </Box>
              <Text
                flexShrink={0}
                fontSize="sm"
                fontWeight="bold"
                color="fg"
                lineHeight="1.35"
                fontVariantNumeric="tabular-nums"
              >
                {item.subscribers.toLocaleString()}
              </Text>
            </Flex>
            <Box ml="34px" h="7px" bg="bg.muted" borderRadius="full" overflow="hidden">
              <Box
                h="100%"
                w={`${Math.max(share * 100, 3)}%`}
                minW={item.subscribers > 0 ? "8px" : 0}
                bg={BRAND.cerulean}
                borderRadius="full"
                opacity={0.5 + share * 0.5}
              />
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}
