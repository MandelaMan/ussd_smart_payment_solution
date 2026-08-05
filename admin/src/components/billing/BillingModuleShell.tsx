import { Box, Button, Flex, Heading, Text } from "@chakra-ui/react";
import { FiDownload, FiRefreshCw } from "react-icons/fi";
import type { ReactNode } from "react";
import type { ReconciliationSummary } from "../../lib/api";
import { BillingSyncProgressBanner } from "./BillingSyncProgressBanner";
import { ListPageStack } from "../ui/pageLayout";

type Props = {
  title: string;
  description?: string;
  summary: ReconciliationSummary | null;
  syncing: boolean;
  exporting?: boolean;
  onSync: () => void;
  onExport?: () => void;
  /** When false, Sync is hidden (CEO / read-only finance). Default true. */
  allowSync?: boolean;
  count?: number;
  /** Hide when a child (e.g. customer table) renders its own sync banner. */
  hideSyncBanner?: boolean;
  children: ReactNode;
};

export function BillingModuleShell({
  title,
  description,
  summary,
  syncing,
  exporting,
  onSync,
  onExport,
  allowSync = true,
  count,
  hideSyncBanner = false,
  children,
}: Props) {
  return (
    <ListPageStack>
      <Flex
        display={{ base: "none", lg: "flex" }}
        justify="space-between"
        align="center"
        gap={3}
        wrap="wrap"
        minW={0}
        flexShrink={0}
      >
        <Box minW={0} flex="1">
          <Heading size="lg">{title}</Heading>
          {description ? (
            <Text fontSize="sm" color="fg.muted" mt={0.5}>
              {description}
            </Text>
          ) : null}
          {count != null && (
            <Text fontSize="xs" color="brand.700" fontWeight="medium" mt={1}>
              {count} record{count === 1 ? "" : "s"}
            </Text>
          )}
          {summary?.sync?.lastSyncAt && (
            <Text fontSize="xs" color="fg.muted" mt={1}>
              Last sync: {new Date(summary.sync.lastSyncAt).toLocaleString("en-KE")}
            </Text>
          )}
        </Box>
        <Flex gap={2} flexShrink={0} flexWrap="wrap">
          {onExport && (
            <Button size="sm" variant="outline" loading={exporting} onClick={onExport}>
              <FiDownload />
              Export
            </Button>
          )}
          {allowSync && (
            <Button size="sm" colorPalette="brand" loading={syncing} onClick={onSync}>
              <FiRefreshCw />
              Sync
            </Button>
          )}
        </Flex>
      </Flex>

      {!hideSyncBanner && summary?.sync?.status === "running" && (
        <BillingSyncProgressBanner
          status={summary.sync.status}
          progress={summary.sync.progress}
          rowCount={count}
          compact
        />
      )}
      <Box flex={{ lg: 1 }} minH={{ lg: 0 }} minW={0} display="flex" flexDirection="column">
        {children}
      </Box>
    </ListPageStack>
  );
}
