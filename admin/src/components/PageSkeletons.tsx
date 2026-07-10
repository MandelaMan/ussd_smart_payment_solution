import { Box, Flex, Grid, Stack } from "@chakra-ui/react";
import {
  DataTableFillSkeleton,
  type DataTableSkeletonColumnKind,
} from "./ui/DataTable";
import { SkeletonBlock } from "./ui/SkeletonBlock";
import { MOBILE_LIST_CARD, MOBILE_LIST_ROW } from "./ui/MobileDataList";
import { PAGE_STACK_GAP } from "./ui/pageLayout";

/** Main content area — accounts for layout padding and floating bottom nav. */
export const PAGE_CONTENT_MIN_H = {
  base: "calc(100dvh - 6rem)",
  lg: "calc(100dvh - 1.5rem)",
} as const;

/** Table card area below typical page title + filter toolbar. */
export const TABLE_VIEWPORT_MIN_H = {
  base: "calc(100dvh - 14rem)",
  lg: "calc(100dvh - 13rem)",
} as const;

export function PaginationSkeleton() {
  return (
    <Flex
      justify="space-between"
      align="center"
      wrap="wrap"
      gap={3}
      px={4}
      py={3}
      borderTop="1px solid"
      borderColor="gray.100"
      bg="gray.50"
    >
      <SkeletonBlock height="16px" width="120px" />
      <Flex gap={2} align="center">
        <SkeletonBlock height="32px" width="100px" borderRadius="md" />
        <SkeletonBlock height="16px" width="72px" />
        <SkeletonBlock height="32px" width="80px" borderRadius="md" />
      </Flex>
    </Flex>
  );
}

export function AppShellSkeleton() {
  return (
    <Flex minH="100dvh" bg="surface.50">
      <Box
        display={{ base: "none", lg: "block" }}
        w="220px"
        bg="brand.600"
        borderRight="3px solid"
        borderColor="azure.500"
        p={3}
        flexShrink={0}
      >
        <SkeletonBlock height="32px" width="140px" mb={6} bg="whiteAlpha.300" />
        <Stack gap={3}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} height="36px" bg="whiteAlpha.200" />
          ))}
        </Stack>
      </Box>

      <Flex direction="column" flex="1" minW={0}>
        <Box flex="1" p={3} pt={{ base: 12, lg: 3 }} minH={PAGE_CONTENT_MIN_H}>
          <DashboardSkeleton />
        </Box>
      </Flex>
    </Flex>
  );
}

export function DashboardMetricsSkeleton() {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        sm: "1fr 1fr",
        lg: "repeat(3, 1fr)",
        xl: "repeat(5, 1fr)",
      }}
      gap={4}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <SkeletonBlock key={i} height="124px" borderRadius="lg" />
      ))}
    </Grid>
  );
}

export function BillingMetricsSkeleton() {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        sm: "1fr 1fr",
        lg: "repeat(3, 1fr)",
        xl: "repeat(5, 1fr)",
      }}
      gap={4}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <SkeletonBlock key={i} height="124px" borderRadius="lg" />
      ))}
    </Grid>
  );
}

export function ChartSkeleton({ height = "220px" }: { height?: string }) {
  return <SkeletonBlock height={height} borderRadius="lg" width="100%" />;
}

export function DashboardSkeleton() {
  return (
    <Flex
      gap={{ base: 4, xl: 0 }}
      align={{ base: "flex-start", xl: "stretch" }}
      direction={{ base: "column", xl: "row" }}
      flex={{ xl: 1 }}
      minH={{ xl: 0 }}
      alignSelf={{ xl: "stretch" }}
      overflow={{ xl: "hidden" }}
      mx={{ xl: -4 }}
      mt={{ xl: -4 }}
      mb={{ xl: -4 }}
    >
      <Stack
        flex={1}
        minW={0}
        minH={0}
        gap={4}
        w="full"
        overflowY={{ xl: "auto" }}
        px={{ xl: 4 }}
        py={{ xl: 4 }}
        pr={{ xl: 5 }}
      >
        <Flex justify="space-between" align="center" gap={3}>
          <Box>
            <SkeletonBlock height="28px" width="120px" mb={2} />
            <SkeletonBlock height="16px" width="150px" />
          </Box>
          <SkeletonBlock height="36px" width="140px" />
        </Flex>

        <DashboardMetricsSkeleton />

        <Grid templateColumns={{ base: "1fr", lg: "1.6fr 1fr" }} gap={4}>
          <ChartSkeleton height="260px" />
          <ChartSkeleton height="260px" />
        </Grid>

        <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={4}>
          <ChartSkeleton height="200px" />
          <ChartSkeleton height="200px" />
          <ChartSkeleton height="200px" />
        </Grid>
      </Stack>

      <Box
        display={{ base: "none", xl: "flex" }}
        flexDirection="column"
        flexShrink={0}
        h="100%"
        minH={0}
      >
        <ActivityPanelSkeleton />
      </Box>
    </Flex>
  );
}

export function ActivityPanelSkeleton() {
  return (
    <Box
      w={{ base: "full", xl: "280px" }}
      bg="white"
      borderRadius={{ base: "lg", xl: 0 }}
      border={{ base: "1px solid", xl: "none" }}
      borderLeft={{ xl: "1px solid" }}
      borderColor={{ base: "gray.100", xl: "brand.100" }}
      overflow="hidden"
      h={{ xl: "100%" }}
      minH={{ xl: 0 }}
      flex={{ xl: 1 }}
      display="flex"
      flexDirection="column"
    >
      <Box px={3} py={3} borderBottom="1px solid" borderColor="gray.100">
        <SkeletonBlock height="18px" width="80px" mb={2} />
        <SkeletonBlock height="14px" width="180px" />
      </Box>
      <Stack gap={0} flex={1} minH={0} overflowY="auto">
        {Array.from({ length: 6 }).map((_, i) => (
          <Flex key={i} gap={3} px={3} py={3} borderBottom="1px solid" borderColor="gray.50">
            <SkeletonBlock boxSize="32px" borderRadius="full" />
            <Box flex={1}>
              <SkeletonBlock height="14px" width="85%" mb={2} />
              <SkeletonBlock height="12px" width="60%" />
            </Box>
          </Flex>
        ))}
      </Stack>
    </Box>
  );
}

export function TableSkeleton({
  rows = 14,
  columns = 6,
  fill: _fill = false,
  showHeader = true,
  narrowLeading = 1,
}: {
  rows?: number;
  columns?: number;
  fill?: boolean;
  showHeader?: boolean;
  narrowLeading?: number;
}) {
  return (
    <DataTableFillSkeleton
      columns={columns}
      rows={rows}
      narrowLeading={narrowLeading}
      showHeader={showHeader}
    />
  );
}

/** Full-height table placeholder for list pages inside DataTableCard. */
export function DataTableLoadingSkeleton({
  columns = 6,
  rows = 14,
  fill: _fill = true,
  showHeader = true,
  narrowLeading = 1,
  columnKinds,
}: {
  columns?: number;
  rows?: number;
  fill?: boolean;
  showHeader?: boolean;
  narrowLeading?: number;
  columnKinds?: DataTableSkeletonColumnKind[];
}) {
  return (
    <DataTableFillSkeleton
      columns={columns}
      rows={rows}
      narrowLeading={narrowLeading}
      columnKinds={columnKinds}
      showHeader={showHeader}
    />
  );
}

/** Card-list placeholder for mobile list views inside DataTableCard. */
export function MobileListRowSkeleton() {
  return (
    <Box px={MOBILE_LIST_ROW.px} py={MOBILE_LIST_ROW.py}>
      <Flex align="flex-start" justify="space-between" gap={3}>
        <Box flex={1} minW={0}>
          <SkeletonBlock
            height="18px"
            width="68%"
            mb={MOBILE_LIST_ROW.subtitle.mt}
            borderRadius="sm"
          />
          <SkeletonBlock height="14px" width="52%" mb={MOBILE_LIST_ROW.status.mt} borderRadius="sm" />
          <SkeletonBlock height="11px" width="32%" borderRadius="sm" />
        </Box>
        <Flex direction="column" align="flex-end" gap={2} flexShrink={0} pt={0.5}>
          <SkeletonBlock height="18px" width="76px" borderRadius="sm" />
          <SkeletonBlock boxSize="18px" borderRadius="sm" />
        </Flex>
      </Flex>
    </Box>
  );
}

function MobileListCardSkeletonRow({ fieldCount = 4 }: { fieldCount?: number }) {
  return (
    <Box px={MOBILE_LIST_CARD.px} py={MOBILE_LIST_CARD.py}>
      <Flex align="flex-start" gap={2.5}>
        <SkeletonBlock boxSize="16px" borderRadius="sm" flexShrink={0} mt={0.5} />
        <Box flex={1} minW={0}>
          <Flex align="flex-start" justify="space-between" gap={2} mb={2.5}>
            <Box flex={1}>
              <SkeletonBlock height="15px" width="62%" mb={1} borderRadius="sm" />
              <SkeletonBlock height="13px" width="44%" borderRadius="sm" />
            </Box>
            <SkeletonBlock height="22px" width="56px" borderRadius="sm" flexShrink={0} />
          </Flex>
          <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap={2}>
            {Array.from({ length: fieldCount }).map((_, i) => (
              <Box key={i}>
                <SkeletonBlock height="10px" width="50%" mb={1} borderRadius="sm" />
                <SkeletonBlock height="14px" width="80%" borderRadius="sm" />
              </Box>
            ))}
          </Grid>
        </Box>
      </Flex>
    </Box>
  );
}

export function MobileCardListSkeleton({
  rows = 8,
  fill = false,
  variant = "row",
  fieldCount = 4,
}: {
  rows?: number;
  fill?: boolean;
  /** Match invoice-style rows or expandable card rows. */
  variant?: "row" | "card";
  /** Number of label/value fields in card variant (default 4). */
  fieldCount?: number;
}) {
  const Row = variant === "card"
    ? () => <MobileListCardSkeletonRow fieldCount={fieldCount} />
    : MobileListRowSkeleton;
  const count = fill ? Math.max(rows, 10) : rows;

  return (
    <Stack
      gap={0}
      divideY="1px"
      divideColor="gray.100"
      flex={fill ? 1 : undefined}
      minH={fill ? 0 : undefined}
      h={fill ? "full" : undefined}
      justify={fill ? "space-evenly" : undefined}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Row key={i} />
      ))}
    </Stack>
  );
}

/** Mobile page header + chip row while list data loads. */
export function MobilePageChromeSkeleton({
  showChips = true,
  showActions = true,
}: {
  showChips?: boolean;
  showActions?: boolean;
}) {
  return (
    <Box display={{ base: "block", lg: "none" }} mb={3}>
      <Flex align="center" justify="space-between" gap={3} mb={showChips ? 3 : 0}>
        <SkeletonBlock height="32px" width="48%" borderRadius="md" />
        {showActions ? (
          <Flex gap={2}>
            <SkeletonBlock boxSize="40px" borderRadius="full" />
            <SkeletonBlock boxSize="40px" borderRadius="full" />
          </Flex>
        ) : null}
      </Flex>
      {showChips ? (
        <Flex gap={2} overflow="hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} height="32px" width="72px" borderRadius="full" flexShrink={0} />
          ))}
        </Flex>
      ) : null}
    </Box>
  );
}

export function SynchronizationPageSkeleton() {
  return (
    <Stack gap={PAGE_STACK_GAP}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={3}>
        <Box>
          <SkeletonBlock height="28px" width="200px" mb={2} />
          <SkeletonBlock height="16px" width="300px" />
        </Box>
        <Flex gap={2}>
          <SkeletonBlock height="32px" width="120px" borderRadius="md" />
          <SkeletonBlock height="32px" width="88px" borderRadius="md" />
        </Flex>
      </Flex>
      <Grid templateColumns={{ base: "1fr", md: "repeat(4, 1fr)" }} gap={3}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} height="104px" borderRadius="lg" />
        ))}
      </Grid>
      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={4}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} height="220px" borderRadius="lg" />
        ))}
      </Grid>
      <SkeletonBlock height="280px" borderRadius="lg" />
    </Stack>
  );
}

export function ReportsPageSkeleton() {
  return (
    <Stack gap={PAGE_STACK_GAP} minH={PAGE_CONTENT_MIN_H}>
      <Box>
        <SkeletonBlock height="28px" width="120px" mb={2} />
        <SkeletonBlock height="16px" width="280px" />
      </Box>
      <Grid
        templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
        gap={3}
        flex={1}
        alignContent="start"
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <SkeletonBlock key={i} height="160px" borderRadius="lg" />
        ))}
      </Grid>
    </Stack>
  );
}

export function ModuleListPageSkeleton({
  columns = 6,
  rows = 14,
  showFilters = true,
  mobileVariant = "row",
}: {
  columns?: number;
  rows?: number;
  showFilters?: boolean;
  mobileVariant?: "row" | "card";
}) {
  return (
    <Stack gap={{ base: 0, lg: 3 }} minH={PAGE_CONTENT_MIN_H}>
      <Box display={{ base: "block", lg: "none" }}>
        <MobilePageChromeSkeleton showChips={showFilters} />
      </Box>

      <Flex
        display={{ base: "none", lg: "flex" }}
        justify="space-between"
        align="center"
        wrap="wrap"
        gap={3}
        flexShrink={0}
      >
        <Box>
          <SkeletonBlock height="28px" width="180px" mb={2} />
          <SkeletonBlock height="16px" width="260px" />
        </Box>
        <Flex gap={2}>
          <SkeletonBlock height="40px" width="120px" borderRadius="lg" />
          <SkeletonBlock height="40px" width="140px" borderRadius="lg" />
        </Flex>
      </Flex>

      {showFilters ? (
        <Box display={{ base: "none", lg: "block" }}>
          <Flex gap={3} wrap="wrap" flexShrink={0}>
            <SkeletonBlock height="40px" width="200px" borderRadius="md" />
            <SkeletonBlock height="40px" width="160px" borderRadius="md" />
            <SkeletonBlock height="40px" width="100px" borderRadius="md" />
          </Flex>
        </Box>
      ) : null}

      <Box
        mx={{ base: -4, lg: 0 }}
        flex={1}
        minH={TABLE_VIEWPORT_MIN_H}
        display="flex"
        flexDirection="column"
      >
        <Box
          bg="white"
          borderRadius={{ base: 0, lg: "sm" }}
          borderWidth={{ base: 0, lg: "1px" }}
          borderStyle="solid"
          borderColor="gray.200"
          overflow="hidden"
          flex={1}
          display="flex"
          flexDirection="column"
        >
          <Box display={{ base: "block", lg: "none" }} flex={1}>
            <MobileCardListSkeleton rows={rows} fill variant={mobileVariant} />
          </Box>
          <Box display={{ base: "none", lg: "block" }} flex={1}>
            <DataTableFillSkeleton columns={columns} rows={rows} narrowLeading={1} />
          </Box>
          <PaginationSkeleton />
        </Box>
      </Box>
    </Stack>
  );
}

export function TransactionExpandSkeleton() {
  return (
    <Box
      bg="white"
      borderRadius="lg"
      border="1px solid"
      borderColor="gray.200"
      overflow="hidden"
    >
      <Flex align="center" justify="space-between" gap={3} px={3} py={3} bg="gray.50">
        <Flex align="center" gap={3}>
          <SkeletonBlock boxSize="36px" borderRadius="lg" />
          <Box>
            <SkeletonBlock height="14px" width="120px" mb={2} />
            <SkeletonBlock height="12px" width="90px" />
          </Box>
        </Flex>
        <Flex align="center" gap={3}>
          <SkeletonBlock height="22px" width="80px" />
          <SkeletonBlock height="24px" width="64px" borderRadius="sm" />
        </Flex>
      </Flex>
      <Box p={3}>
        <Grid templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }} gap={3}>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonBlock key={i} height="56px" />
          ))}
        </Grid>
      </Box>
    </Box>
  );
}
