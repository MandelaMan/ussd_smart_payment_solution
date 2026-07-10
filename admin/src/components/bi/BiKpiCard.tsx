import { Box, Flex, Icon, Text } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import { FiMinus, FiTrendingDown, FiTrendingUp } from "react-icons/fi";

type Props = {
  title: string;
  value: string;
  trend?: number | null;
  trendLabel?: string;
  icon: IconType;
  accent?: string;
  unavailable?: boolean;
};

export function BiKpiCard({
  title,
  value,
  trend,
  trendLabel = "vs prev. period",
  icon: IconComp,
  accent = "#166a82",
  unavailable,
}: Props) {
  const trendVal = trend ?? 0;
  const isUp = trendVal > 0;
  const isDown = trendVal < 0;
  const trendColor = isUp ? "green.600" : isDown ? "red.500" : "gray.500";
  const TrendIcon = isUp ? FiTrendingUp : isDown ? FiTrendingDown : FiMinus;

  return (
    <Box
      bg="white"
      border="1px solid"
      borderColor="gray.100"
      borderRadius="lg"
      p={3}
      boxShadow="sm"
      minH="104px"
      display="flex"
      flexDirection="column"
      gap={1.5}
      position="relative"
      overflow="hidden"
      _before={{
        content: '""',
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        h: "3px",
        bg: accent,
      }}
    >
      <Flex align="center" justify="space-between" gap={2}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.600" lineHeight="1.35">
          {title}
        </Text>
        <Flex
          align="center"
          justify="center"
          w={8}
          h={8}
          borderRadius="lg"
          bg={`${accent}18`}
          color={accent}
          flexShrink={0}
        >
          <Icon as={IconComp} boxSize={4} />
        </Flex>
      </Flex>

      <Text
        fontSize={{ base: "xl", md: "2xl" }}
        fontWeight="bold"
        color={unavailable ? "gray.400" : "gray.900"}
        lineHeight="1.2"
      >
        {value}
      </Text>

      {unavailable ? (
        <Text fontSize="xs" color="gray.400">
          Data not tracked yet
        </Text>
      ) : trend != null ? (
        <Flex align="center" gap={1} fontSize="xs" color={trendColor}>
          <Icon as={TrendIcon} boxSize={3.5} />
          <Text fontWeight="semibold">{Math.abs(trendVal)}%</Text>
          <Text color="gray.500">{trendLabel}</Text>
        </Flex>
      ) : (
        <Text fontSize="xs" color="gray.400">
          —
        </Text>
      )}
    </Box>
  );
}
