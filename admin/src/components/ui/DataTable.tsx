import { Box, Flex, Stack, Table, Text, type TableColumnHeaderProps } from "@chakra-ui/react";
import { useEffect, useRef, type ReactNode } from "react";
import { FiChevronDown, FiChevronUp } from "react-icons/fi";
import { formatDataTableColumnLabel } from "../../lib/formatText";
import { useMobileViewport } from "../../hooks/useMobileViewport";
import { useMobileSearchOptional } from "../../lib/mobileSearch";
import { PaginationSkeleton, TABLE_VIEWPORT_MIN_H } from "../PageSkeletons";
import { InfiniteScrollSentinel } from "./InfiniteScrollSentinel";
import { PaginationBar } from "./PaginationBar";
import { SkeletonBlock } from "./SkeletonBlock";
import type { ListPagination } from "../../lib/api";
import type { SortDirection, SortSpec } from "../../lib/tableSort";

export const dataTableColumnHeaderProps: TableColumnHeaderProps = {
  fontSize: "xs",
  fontWeight: "semibold",
  color: "brand.700",
  textTransform: "none",
  letterSpacing: "normal",
  py: 2,
  px: 3,
  borderBottom: "2px solid",
  borderColor: "brand.200",
  bg: "brand.50",
  whiteSpace: "nowrap",
};

/** @deprecated Use dataTableColumnHeaderProps — headers now use sentence case everywhere. */
export const dataTableTitleColumnHeaderProps: TableColumnHeaderProps = dataTableColumnHeaderProps;

export const dataTableCellProps = {
  py: { base: 2, md: 2.5 },
  px: { base: 2, md: 3 },
  fontSize: "sm",
  borderBottom: "1px solid",
  borderColor: "border.muted",
  verticalAlign: "middle" as const,
  overflow: "hidden",
  whiteSpace: "nowrap" as const,
  textOverflow: "ellipsis",
};

/** Minimum table width when using fixedLayout so mobile can scroll horizontally. */
export const DATA_TABLE_SCROLL_MIN_W = "720px";

/** Narrow leading column (expand chevron / checkbox). */
export const DATA_TABLE_LEADING_COL_WIDTH = "40px";

/** Compact enum column (e.g. C2B / B2B). */
export const DATA_TABLE_TYPE_COL_WIDTH = "72px";

/** Primary label column — capped so trailing columns sit closer. */
export const DATA_TABLE_CUSTOMER_COL_WIDTH = "280px";

/** Shared width for secondary data columns so they stay even. */
export const DATA_TABLE_EQUAL_DATA_COL_WIDTH = "13%";

export const dataTableTypeColumnHeaderProps: TableColumnHeaderProps = {
  ...dataTableTitleColumnHeaderProps,
  w: DATA_TABLE_TYPE_COL_WIDTH,
};

export const dataTableCustomerColumnHeaderProps: TableColumnHeaderProps = {
  ...dataTableTitleColumnHeaderProps,
  w: DATA_TABLE_CUSTOMER_COL_WIDTH,
};

export const dataTableEqualDataColumnHeaderProps: TableColumnHeaderProps = {
  ...dataTableTitleColumnHeaderProps,
  w: DATA_TABLE_EQUAL_DATA_COL_WIDTH,
};

export const dataTableEqualDataCodeColumnHeaderProps: TableColumnHeaderProps = {
  ...dataTableTitleColumnHeaderProps,
  w: DATA_TABLE_EQUAL_DATA_COL_WIDTH,
};

export function DataTableColumnHeader({
  children,
  ...props
}: TableColumnHeaderProps & { children?: ReactNode }) {
  const content =
    typeof children === "string" || typeof children === "number"
      ? formatDataTableColumnLabel(String(children))
      : children;
  return (
    <Table.ColumnHeader {...dataTableColumnHeaderProps} {...props}>
      {content}
    </Table.ColumnHeader>
  );
}

export const dataTableTypeCellProps = {
  ...dataTableCellProps,
  w: DATA_TABLE_TYPE_COL_WIDTH,
  px: { base: 2, md: 2 },
};

/** Multi-line cell for primary labels that must remain fully visible. */
export const dataTableWrapCellProps = {
  ...dataTableCellProps,
  overflow: "visible",
  whiteSpace: "normal",
  textOverflow: "clip",
  wordBreak: "break-word",
};

export const dataTableCustomerWrapCellProps = {
  ...dataTableWrapCellProps,
  w: DATA_TABLE_CUSTOMER_COL_WIDTH,
};

export const dataTableEqualDataCellProps = {
  ...dataTableCellProps,
  w: DATA_TABLE_EQUAL_DATA_COL_WIDTH,
};

/** Apply to expandable detail rows so they are excluded from striping. */
export const dataTableExpandRowProps = {
  "data-expand-panel": true,
} as const;

type DataTableSortHeaderProps<T extends string = string> = {
  label: string;
  column: T;
  sorts: SortSpec<T>[];
  onSort: (column: T, defaultDir?: SortDirection, additive?: boolean) => void;
  defaultDir?: SortDirection;
  headerProps?: TableColumnHeaderProps;
};

export function DataTableSortHeader<T extends string = string>({
  label,
  column,
  sorts,
  onSort,
  defaultDir = "asc",
  headerProps = dataTableTitleColumnHeaderProps,
}: DataTableSortHeaderProps<T>) {
  const activeIndex = sorts.findIndex((sort) => sort.sortBy === column);
  const active = activeIndex >= 0;
  const activeSort = active ? sorts[activeIndex] : null;

  return (
    <Table.ColumnHeader
      {...headerProps}
      cursor="pointer"
      userSelect="none"
      onClick={(event) => onSort(column, defaultDir, event.shiftKey)}
      _hover={{ bg: "brand.100" }}
      aria-sort={
        activeSort
          ? activeSort.sortDir === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      title={sorts.length > 1 ? "Shift+click to add another sort level" : undefined}
    >
      <Flex align="center" gap={1}>
        <Box as="span">{formatDataTableColumnLabel(label)}</Box>
        <Flex align="center" gap={0.5} minW="18px" justify="flex-end">
          {activeSort ? (
            activeSort.sortDir === "asc" ? (
              <FiChevronUp size={14} aria-hidden />
            ) : (
              <FiChevronDown size={14} aria-hidden />
            )
          ) : (
            <Flex direction="column" gap={0} opacity={0.35} aria-hidden>
              <FiChevronUp size={10} style={{ marginBottom: -4 }} />
              <FiChevronDown size={10} />
            </Flex>
          )}
        </Flex>
      </Flex>
    </Table.ColumnHeader>
  );
}

const tableRootCss = {
  "& tbody tr:nth-of-type(odd):not([data-expand-panel])": {
    bg: "bg.subtle",
  },
  "& tbody tr:not([data-expand-panel]):hover": {
    bg: "bg.muted",
  },
  "& tbody tr:last-child td": {
    borderBottom: "none",
  },
} as const;

export const dataTableRootCss = tableRootCss;

type DataTableCardProps = {
  children: ReactNode;
  pagination?: ListPagination;
  onPageChange?: (page: number) => void;
  itemLabel?: string;
  loading?: boolean;
  /** Mobile infinite-scroll: next page is loading while current rows stay visible. */
  loadingMore?: boolean;
  /** Rows currently rendered (for mobile “loaded of total” footer). */
  loadedCount?: number;
};

export function DataTableCard({
  children,
  pagination,
  onPageChange,
  itemLabel = "items",
  loading = false,
  loadingMore = false,
  loadedCount,
}: DataTableCardProps) {
  const isMobile = useMobileViewport();
  const mobileSearch = useMobileSearchOptional();
  const searchIdle =
    isMobile && Boolean(mobileSearch?.searchOpen) && !mobileSearch?.searchValue.trim();
  const showPager = Boolean(!loading && !searchIdle && pagination && onPageChange);
  const hasMore = Boolean(pagination && pagination.page < pagination.pages);
  const loadLockRef = useRef(false);

  useEffect(() => {
    if (!loadingMore) loadLockRef.current = false;
  }, [loadingMore]);

  if (searchIdle) {
    return (
      <Box mx={{ base: -4, lg: 0 }} minW={0} py={16} px={6} textAlign="center">
        <Text fontSize="md" color="fg.subtle">
          Type to search {itemLabel}
        </Text>
      </Box>
    );
  }

  return (
    <Box mx={{ base: -4, lg: 0 }} minW={0}>
      <Box
        bg="bg.panel"
        borderRadius={{ base: 0, lg: "sm" }}
        borderWidth={{ base: 0, lg: "1px" }}
        borderStyle="solid"
        borderColor="border"
        overflow="hidden"
        minH={loading ? TABLE_VIEWPORT_MIN_H : undefined}
        display="flex"
        flexDirection="column"
        minW={0}
        maxW="100%"
      >
      <Box
        flex={loading ? 1 : undefined}
        minH={loading ? 0 : undefined}
        display={loading ? "flex" : "block"}
        flexDirection="column"
      >
        {children}
      </Box>
      {showPager && isMobile ? (
        <InfiniteScrollSentinel
          hasMore={hasMore}
          loading={loadingMore}
          onLoadMore={() => {
            if (!pagination || !onPageChange || loadingMore || !hasMore) return;
            if (loadLockRef.current) return;
            loadLockRef.current = true;
            onPageChange(pagination.page + 1);
          }}
          itemLabel={itemLabel}
          total={pagination?.total}
          loadedCount={loadedCount}
        />
      ) : showPager ? (
        <PaginationBar
          pagination={pagination!}
          onPageChange={onPageChange!}
          itemLabel={itemLabel}
        />
      ) : loading && !isMobile ? (
        <PaginationSkeleton />
      ) : null}
      </Box>
    </Box>
  );
}

export function DataTable({
  children,
  fill = false,
  fixedLayout = false,
  scrollMinW,
}: {
  children: ReactNode;
  fill?: boolean;
  fixedLayout?: boolean;
  /** When fixedLayout is set, table min-width before horizontal scroll (default 720px). */
  scrollMinW?: string;
}) {
  const tableMinW = fixedLayout ? (scrollMinW ?? DATA_TABLE_SCROLL_MIN_W) : undefined;

  return (
    <Box
      overflowX="auto"
      flex={fill ? 1 : undefined}
      minH={fill ? 0 : undefined}
      h={fill ? "full" : undefined}
      w="full"
      display={fill ? "flex" : undefined}
      flexDirection={fill ? "column" : undefined}
      css={{ WebkitOverflowScrolling: "touch" }}
    >
      <Table.Root
        size="sm"
        css={tableRootCss}
        tableLayout={fixedLayout ? "fixed" : undefined}
        w={fixedLayout ? "full" : undefined}
        minW={tableMinW}
      >
        {children}
      </Table.Root>
    </Box>
  );
}

export type DataTableSkeletonColumnKind = "leading" | "type" | "customer" | "code" | "data";

function skeletonHeaderProps(
  kind: DataTableSkeletonColumnKind,
): TableColumnHeaderProps {
  switch (kind) {
    case "leading":
      return { ...dataTableTitleColumnHeaderProps, w: DATA_TABLE_LEADING_COL_WIDTH };
    case "type":
      return dataTableTypeColumnHeaderProps;
    case "customer":
      return dataTableCustomerColumnHeaderProps;
    case "code":
      return dataTableEqualDataCodeColumnHeaderProps;
    case "data":
    default:
      return dataTableEqualDataColumnHeaderProps;
  }
}

function skeletonCellProps(kind: DataTableSkeletonColumnKind) {
  switch (kind) {
    case "leading":
      return { ...dataTableCellProps, w: DATA_TABLE_LEADING_COL_WIDTH };
    case "type":
      return dataTableTypeCellProps;
    case "customer":
      return dataTableCustomerWrapCellProps;
    case "code":
    case "data":
    default:
      return dataTableEqualDataCellProps;
  }
}

function resolveColumnKinds(
  columns: number,
  narrowLeading: number,
  columnKinds?: DataTableSkeletonColumnKind[],
): DataTableSkeletonColumnKind[] {
  if (columnKinds?.length === columns) return columnKinds;
  return Array.from({ length: columns }, (_, i) =>
    i < narrowLeading ? "leading" : "data",
  );
}

function skeletonBarWidth(kind: DataTableSkeletonColumnKind, index: number) {
  if (kind === "leading") return "16px";
  if (kind === "type") return "48px";
  if (kind === "customer") return "78%";
  if (kind === "code") return "65%";
  const widths = ["72%", "58%", "64%", "50%", "56%"];
  return widths[(index - 1) % widths.length];
}

export function DataTableHeaderSkeleton({
  columns,
  narrowLeading = 1,
  columnKinds,
}: {
  columns: number;
  narrowLeading?: number;
  columnKinds?: DataTableSkeletonColumnKind[];
}) {
  const kinds = resolveColumnKinds(columns, narrowLeading, columnKinds);

  return (
    <Table.Header>
      <Table.Row>
        {kinds.map((kind, i) => (
          <Table.ColumnHeader key={i} {...skeletonHeaderProps(kind)}>
            {kind === "leading" ? null : (
              <SkeletonBlock height="10px" width={skeletonBarWidth(kind, i)} bg="brand.200" />
            )}
          </Table.ColumnHeader>
        ))}
      </Table.Row>
    </Table.Header>
  );
}

type DataTableBodySkeletonProps = {
  rows?: number;
  columns: number;
  /** Narrow 40px columns at the start (e.g. checkbox / expand). */
  narrowLeading?: number;
  columnKinds?: DataTableSkeletonColumnKind[];
};

export function DataTableBodySkeleton({
  rows = 14,
  columns,
  narrowLeading = 1,
  columnKinds,
}: DataTableBodySkeletonProps) {
  const kinds = resolveColumnKinds(columns, narrowLeading, columnKinds);

  return (
    <Table.Body>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <Table.Row key={rowIdx}>
          {kinds.map((kind, colIdx) => (
            <Table.Cell key={colIdx} {...skeletonCellProps(kind)}>
              {kind === "leading" ? (
                <SkeletonBlock boxSize="16px" borderRadius="sm" />
              ) : kind === "customer" ? (
                <Stack gap={1.5}>
                  <SkeletonBlock height="14px" width="82%" />
                  <SkeletonBlock height="11px" width="58%" />
                </Stack>
              ) : (
                <SkeletonBlock height="14px" width={skeletonBarWidth(kind, colIdx)} />
              )}
            </Table.Cell>
          ))}
        </Table.Row>
      ))}
    </Table.Body>
  );
}

type DataTableFillSkeletonProps = {
  columns: number;
  narrowLeading?: number;
  rows?: number;
  columnKinds?: DataTableSkeletonColumnKind[];
  /** When provided, renders exact headers from the loaded table. */
  header?: ReactNode;
  showHeader?: boolean;
};

/** Desktop table placeholder that mirrors DataTable layout (header, columns, row striping). */
export function DataTableFillSkeleton({
  columns,
  narrowLeading = 1,
  rows = 14,
  columnKinds,
  header,
  showHeader = true,
}: DataTableFillSkeletonProps) {
  return (
    <Box flex={1} minH={0} display="flex" flexDirection="column" w="full">
      <DataTable fixedLayout fill>
        {showHeader
          ? header ?? (
              <DataTableHeaderSkeleton
                columns={columns}
                narrowLeading={narrowLeading}
                columnKinds={columnKinds}
              />
            )
          : null}
        <DataTableBodySkeleton
          rows={rows}
          columns={columns}
          narrowLeading={narrowLeading}
          columnKinds={columnKinds}
        />
      </DataTable>
    </Box>
  );
}

/** @deprecated Prefer DataTableFillSkeleton — legacy flex-row filler for inline panels. */
export function DataTableSkeletonRowsFill({ rows = 10 }: { rows?: number }) {
  return (
    <Box
      flex={1}
      minH={0}
      display="flex"
      flexDirection="column"
      justifyContent="space-evenly"
      borderTop="1px solid"
      borderColor="border.muted"
      aria-hidden
    >
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <Flex key={rowIdx} align="center" px={{ base: 2, md: 4 }} minH="14px">
          <SkeletonBlock boxSize="16px" borderRadius="sm" flexShrink={0} me={4} />
          <SkeletonBlock height="14px" flex={1} maxW="55%" />
          <SkeletonBlock height="14px" flex={1} mx={4} display={{ base: "none", md: "block" }} />
          <SkeletonBlock height="14px" flex={1} display={{ base: "none", lg: "block" }} />
        </Flex>
      ))}
    </Box>
  );
}
