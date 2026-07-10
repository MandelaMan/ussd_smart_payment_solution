import { Box, Flex, Grid, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { FiChevronDown, FiChevronRight, FiMoreHorizontal } from "react-icons/fi";

/** Shared mobile list row metrics — keep skeletons and rows in sync. */
export const MOBILE_LIST_ROW = {
  px: 4,
  py: 4,
  title: {
    fontSize: "md",
    fontWeight: "bold",
    lineHeight: "1.4",
    letterSpacing: "-0.01em",
  },
  subtitle: {
    fontSize: "sm",
    lineHeight: "1.45",
    mt: 1,
  },
  status: {
    mt: 2,
  },
} as const;

export const MOBILE_LIST_CARD = {
  px: 3,
  py: 3.5,
} as const;

export const DESKTOP_TABLE_DISPLAY = { base: "none", lg: "block" } as const;
export const MOBILE_LIST_DISPLAY = { base: "block", lg: "none" } as const;

export type MobileDataField = {
  label: string;
  value: ReactNode;
};

type MobileDataCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small status line below subtitle (e.g. PAID, DUE IN 6 DAYS). */
  statusLine?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Row menu trigger — renders ··· on the right below amount. */
  menu?: ReactNode;
  fields?: MobileDataField[];
  footer?: ReactNode;
  isOpen?: boolean;
  onClick?: () => void;
  dimmed?: boolean;
  opacity?: number;
  showChevron?: boolean;
  /** "row" = invoice-style compact row; "card" = legacy expandable card. */
  variant?: "row" | "card";
};

export function MobileDataCard({
  title,
  subtitle,
  statusLine,
  leading,
  trailing,
  menu,
  fields,
  footer,
  isOpen = false,
  onClick,
  dimmed = false,
  opacity,
  showChevron,
  variant = "row",
}: MobileDataCardProps) {
  const resolvedVariant =
    variant ?? (fields && fields.length > 0 && !statusLine ? "card" : "row");
  const useRow = resolvedVariant === "row";
  const showChevronIcon = showChevron ?? !useRow;

  if (useRow) {
    return (
      <Box
        px={MOBILE_LIST_ROW.px}
        py={MOBILE_LIST_ROW.py}
        cursor={onClick ? "pointer" : undefined}
        bg={isOpen ? "brand.50" : "white"}
        opacity={opacity ?? (dimmed ? 0.45 : 1)}
        transition="opacity 0.2s ease, background 0.2s ease"
        _active={onClick ? { bg: isOpen ? "brand.100" : "gray.50" } : undefined}
        onClick={onClick}
      >
        <Flex align="flex-start" gap={2.5}>
          {leading ? <Box flexShrink={0} pt={0.5}>{leading}</Box> : null}
          <Flex flex={1} minW={0} align="flex-start" justify="space-between" gap={3}>
            <Box flex={1} minW={0}>
              <Text
                fontWeight={MOBILE_LIST_ROW.title.fontWeight}
                fontSize={MOBILE_LIST_ROW.title.fontSize}
                lineHeight={MOBILE_LIST_ROW.title.lineHeight}
                letterSpacing={MOBILE_LIST_ROW.title.letterSpacing}
                lineClamp={2}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text
                  fontSize={MOBILE_LIST_ROW.subtitle.fontSize}
                  lineHeight={MOBILE_LIST_ROW.subtitle.lineHeight}
                  color="gray.500"
                  mt={MOBILE_LIST_ROW.subtitle.mt}
                  lineClamp={2}
                >
                  {subtitle}
                </Text>
              ) : null}
              {statusLine ? <Box mt={MOBILE_LIST_ROW.status.mt}>{statusLine}</Box> : null}
            </Box>
            <Flex direction="column" align="flex-end" gap={2} flexShrink={0} pt={0.5}>
              {trailing}
              {menu ? (
                <Box
                  color="gray.400"
                  onClick={(e) => e.stopPropagation()}
                  lineHeight={0}
                >
                  {menu}
                </Box>
              ) : onClick ? (
                <Box color="gray.400" lineHeight={0} aria-hidden>
                  <FiMoreHorizontal size={18} />
                </Box>
              ) : null}
            </Flex>
          </Flex>
        </Flex>
        {footer ? <Box mt={2}>{footer}</Box> : null}
      </Box>
    );
  }

  const visibleFields = fields?.filter(
    (field) => field.value != null && field.value !== "" && field.value !== "—"
  );

  return (
    <Box
      px={MOBILE_LIST_CARD.px}
      py={MOBILE_LIST_CARD.py}
      cursor={onClick ? "pointer" : undefined}
      bg={isOpen ? "brand.50" : undefined}
      opacity={opacity ?? (dimmed ? 0.45 : 1)}
      transition="opacity 0.2s ease, background 0.2s ease"
      _hover={onClick ? { bg: isOpen ? "brand.50" : "gray.50" } : undefined}
      onClick={onClick}
    >
      <Flex align="flex-start" gap={2}>
        {showChevronIcon ? (
          <Box flexShrink={0} color={isOpen ? "brand.600" : "gray.500"} mt={0.5}>
            {isOpen ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
          </Box>
        ) : null}
        {leading ? <Box flexShrink={0}>{leading}</Box> : null}
        <Box flex={1} minW={0}>
          <Flex align="flex-start" justify="space-between" gap={2}>
            <Box flex={1} minW={0}>
              <Text fontWeight="semibold" fontSize="sm" lineHeight="1.4" lineClamp={2}>
                {title}
              </Text>
              {subtitle ? (
                <Text fontSize="xs" color="gray.500" mt={1} lineHeight="1.45" lineClamp={2}>
                  {subtitle}
                </Text>
              ) : null}
            </Box>
            {trailing ? <Box flexShrink={0}>{trailing}</Box> : null}
          </Flex>
          {visibleFields && visibleFields.length > 0 ? (
            <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap={2} mt={2.5}>
              {visibleFields.map((field) => (
                <Box key={field.label} minW={0}>
                  <Text fontSize="2xs" color="gray.500" textTransform="uppercase" letterSpacing="0.04em">
                    {field.label}
                  </Text>
                  <Box fontSize="sm" mt={0.5} overflow="hidden" textOverflow="ellipsis">
                    {field.value}
                  </Box>
                </Box>
              ))}
            </Grid>
          ) : null}
          {footer ? <Box mt={2.5}>{footer}</Box> : null}
        </Box>
      </Flex>
    </Box>
  );
}

type MobileDataListProps<T> = {
  items: T[];
  getKey: (item: T) => string | number;
  expandedId?: string | number | null;
  renderCard: (item: T, isOpen: boolean) => ReactNode;
  renderExpanded?: (item: T) => ReactNode;
  emptyMessage?: ReactNode;
};

export function MobileDataList<T>({
  items,
  getKey,
  expandedId = null,
  renderCard,
  renderExpanded,
  emptyMessage,
}: MobileDataListProps<T>) {
  if (items.length === 0) {
    return emptyMessage ? (
      <Box py={8} px={4} textAlign="center">
        {emptyMessage}
      </Box>
    ) : null;
  }

  return (
    <Stack gap={0} divideY="1px" divideColor="gray.100">
      {items.map((item) => {
        const key = getKey(item);
        const isOpen = expandedId === key;

        return (
          <Box key={key}>
            {renderCard(item, isOpen)}
            {isOpen && renderExpanded ? (
              <Box
                px={4}
                py={3}
                bg="surface.50"
                borderTop="1px solid"
                borderColor="gray.100"
              >
                {renderExpanded(item)}
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Stack>
  );
}

export function ResponsiveListViews({
  mobile,
  desktop,
  fill = false,
}: {
  mobile: ReactNode;
  desktop: ReactNode;
  /** Stretch list/table skeletons to the height of a loading DataTableCard. */
  fill?: boolean;
}) {
  const shellProps = fill
    ? {
        flex: 1 as const,
        minH: 0,
        h: "full",
        display: "flex" as const,
        flexDirection: "column" as const,
      }
    : {};

  return (
    <>
      <Box display={MOBILE_LIST_DISPLAY} {...shellProps}>
        {mobile}
      </Box>
      <Box display={DESKTOP_TABLE_DISPLAY} {...shellProps}>
        {desktop}
      </Box>
    </>
  );
}
