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
      bg="bg.panel"
      borderRadius="lg"
      border="1px solid"
      borderColor="border"
      overflow="hidden"
      boxShadow="sm"
    >
      <Flex
        direction={{ base: "column", sm: "row" }}
        align={{ base: "stretch", sm: "center" }}
        justify="space-between"
        gap={{ base: 2, sm: 3 }}
        px={{ base: 2.5, md: 3 }}
        py={{ base: 2, md: 3 }}
        bg="bg.subtle"
        borderBottom="1px solid"
        borderColor="border.muted"
        borderLeft="4px solid"
        borderLeftColor={accent}
        minW={0}
      >
        <Flex align="center" gap={{ base: 2, md: 3 }} minW={0} flex="1">
          <Flex
            boxSize={{ base: "32px", md: "36px" }}
            borderRadius="lg"
            bg="bg.panel"
            border="1px solid"
            borderColor="border"
            align="center"
            justify="center"
            color={accent}
            flexShrink={0}
          >
            <Icon size={18} />
          </Flex>
          <Box minW={0} overflow="hidden">
            <Text fontWeight="semibold" fontSize="sm" color="fg" lineClamp={2} overflowWrap="anywhere">
              {title}
            </Text>
            {subtitle && (
              <Text fontSize="xs" color="fg.muted" truncate>
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
      <Box p={{ base: 2, md: 3 }}>{children}</Box>
    </Box>
  );
}

export function DetailGrid({
  children,
  columns,
}: {
  children: ReactNode;
  /** Override responsive column template when a section needs a denser or stacked layout. */
  columns?: Record<string, string> | string;
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={
        columns ?? { base: "1fr 1fr", md: "repeat(3, 1fr)", lg: "repeat(4, 1fr)" }
      }
      gap={{ base: 2, md: 3 }}
      w="full"
      minW={0}
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
  span,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  highlight?: boolean;
  /** Span full grid width on selected breakpoints (e.g. long IPs / emails on mobile). */
  span?: Record<string, string> | string;
}) {
  return (
    <Box
      bg={highlight ? "brand.50" : { base: "bg.subtle", md: "bg.panel" }}
      border="1px solid"
      borderColor={highlight ? "brand.100" : "border.muted"}
      borderRadius="md"
      px={{ base: 2.5, md: 3 }}
      py={{ base: 2.5, md: 3 }}
      minH={{ base: "52px", md: "56px" }}
      minW={0}
      w="full"
      gridColumn={span}
    >
      <Text
        fontSize="2xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="0.04em"
        mb={{ base: 0.5, md: 1 }}
        lineClamp={{ base: 2, md: 1 }}
      >
        {label}
      </Text>
      <Box
        fontSize={{ base: "sm", md: "sm" }}
        fontWeight="medium"
        color="fg"
        fontFamily={mono ? "mono" : undefined}
        wordBreak={mono ? "break-all" : "break-word"}
        overflowWrap="anywhere"
        lineHeight="1.35"
        minW={0}
      >
        {value || <Text as="span" color="fg.subtle">—</Text>}
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
