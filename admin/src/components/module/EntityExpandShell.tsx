import { Badge, Box, Flex, Text } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import type { ReactNode } from "react";

type Props = {
  icon: IconType;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  value?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  accent?: string;
  children: ReactNode;
};

export function EntityExpandShell({
  icon: Icon,
  title,
  subtitle,
  badge,
  value,
  status,
  actions,
  accent = "brand.600",
  children,
}: Props) {
  return (
    <Box
      bg="white"
      borderRadius="lg"
      border="1px solid"
      borderColor="gray.200"
      overflow="hidden"
      boxShadow="sm"
    >
      <Flex
        direction={{ base: "column", sm: "row" }}
        align={{ base: "stretch", sm: "center" }}
        justify="space-between"
        gap={3}
        px={3}
        py={3}
        bg="gray.50"
        borderBottom="1px solid"
        borderColor="gray.100"
        borderLeft="4px solid"
        borderLeftColor={accent}
        minW={0}
      >
        <Flex align="center" gap={3} minW={0} flex="1">
          <Flex
            boxSize="36px"
            borderRadius="lg"
            bg="white"
            border="1px solid"
            borderColor="gray.200"
            align="center"
            justify="center"
            color={accent}
            flexShrink={0}
          >
            <Icon size={18} />
          </Flex>
          <Box minW={0} overflow="hidden">
            <Text fontWeight="semibold" fontSize="sm" color="gray.800" lineClamp={2} overflowWrap="anywhere">
              {title}
            </Text>
            {subtitle && (
              <Text fontSize="xs" color="gray.500" truncate>
                {subtitle}
              </Text>
            )}
          </Box>
        </Flex>
        <Flex
          align="center"
          gap={2}
          flexShrink={0}
          flexWrap="wrap"
          justify={{ base: "flex-start", sm: "flex-end" }}
          minW={0}
        >
          {badge}
          {value}
          {status}
          {actions}
        </Flex>
      </Flex>
      <Box p={3}>{children}</Box>
    </Box>
  );
}

export function DetailGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={{ base: "1fr 1fr", md: "repeat(3, 1fr)", lg: "repeat(4, 1fr)" }}
      gap={3}
    >
      {children}
    </Box>
  );
}

export function DetailCard({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <Box
      bg={highlight ? "brand.50" : "gray.50"}
      border="1px solid"
      borderColor={highlight ? "brand.100" : "gray.100"}
      borderRadius="md"
      px={3}
      py={3}
      minH="56px"
    >
      <Text
        fontSize="2xs"
        fontWeight="semibold"
        color="gray.500"
        textTransform="uppercase"
        letterSpacing="0.04em"
        mb={1}
      >
        {label}
      </Text>
      <Box
        fontSize="sm"
        fontWeight="medium"
        color="gray.800"
        fontFamily={mono ? "mono" : undefined}
        wordBreak={mono ? "break-all" : "break-word"}
        overflowWrap="anywhere"
        lineHeight="1.35"
        minW={0}
      >
        {value || <Text as="span" color="gray.400">—</Text>}
      </Box>
    </Box>
  );
}

export function StatusPill({
  label,
  colorPalette,
}: {
  label: string;
  colorPalette: string;
}) {
  return (
    <Badge colorPalette={colorPalette} variant="subtle" px={2}>
      {label}
    </Badge>
  );
}
