import { Box, Text } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { BRAND } from "../theme";

const ACCENTS = {
  cerulean: {
    bg: `linear-gradient(145deg, ${BRAND.cerulean} 0%, #0e4858 100%)`,
    color: "white",
  },
  azure: {
    bg: `linear-gradient(145deg, #2a9fc4 0%, ${BRAND.paleAzure} 100%)`,
    color: "fg",
  },
  sandy: {
    bg: `linear-gradient(145deg, ${BRAND.sandyBrown} 0%, #e8873a 100%)`,
    color: "fg",
  },
  mindaro: {
    bg: `linear-gradient(145deg, #d4d88a 0%, ${BRAND.mindaro} 100%)`,
    color: "fg",
  },
  teal: {
    bg: "linear-gradient(145deg, #0d9488 0%, #14b8a6 100%)",
    color: "white",
  },
} as const;

type Accent = keyof typeof ACCENTS;

type Props = {
  label: string;
  value: string | number;
  sub?: string;
  sub2?: string;
  accent?: Accent;
  to?: string;
};

export function MetricCard({
  label,
  value,
  sub,
  sub2,
  accent = "cerulean",
  to,
}: Props) {
  const style = ACCENTS[accent];

  const content = (
    <Box
      bg={style.bg}
      color={style.color}
      borderRadius={{ base: "lg", md: "xl" }}
      px={{ base: 2.5, md: 3.5 }}
      py={{ base: 2.5, md: 3 }}
      minH={{ base: "92px", md: "104px" }}
      display="flex"
      flexDirection="column"
      gap={{ base: 1, md: 1.5 }}
      boxShadow="sm"
      position="relative"
      overflow="hidden"
      w="full"
      _after={{
        content: '""',
        position: "absolute",
        top: "-20px",
        right: "-20px",
        w: { base: "56px", md: "72px" },
        h: { base: "56px", md: "72px" },
        borderRadius: "full",
        bg: "whiteAlpha.200",
      }}
    >
      <Text
        fontSize="xs"
        fontWeight="semibold"
        lineHeight="1.3"
        opacity={0.92}
        css={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {label}
      </Text>

      <Text
        fontSize={{ base: "lg", md: "xl" }}
        fontWeight="bold"
        lineHeight="1.15"
        letterSpacing="-0.02em"
        flex={1}
        display="flex"
        alignItems="center"
      >
        {value}
      </Text>

      {(sub || sub2) && (
        <Box opacity={0.9}>
          {sub && (
            <Text fontSize="2xs" lineHeight="1.35" lineClamp={1}>
              {sub}
            </Text>
          )}
          {sub2 && (
            <Text fontSize="2xs" lineHeight="1.35" mt={sub ? 0.5 : 0} lineClamp={1}>
              {sub2}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );

  if (!to) return content;

  return (
    <RouterLink to={to} style={{ textDecoration: "none", display: "block", width: "100%" }}>
      <Box
        transition="transform 0.15s, box-shadow 0.15s"
        _hover={{ transform: "translateY(-1px)", boxShadow: "md" }}
        w="full"
      >
        {content}
      </Box>
    </RouterLink>
  );
}
