import { Box, Button, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { FiDownload, FiRefreshCw } from "react-icons/fi";
import type { ReactNode } from "react";
import type { ReconciliationSummary } from "../../lib/api";
import { BillingSyncProgressBanner } from "./BillingSyncProgressBanner";

type Props = {
  title: string;
  description: string;
  summary: ReconciliationSummary | null;
  syncing: boolean;
  exporting?: boolean;
  onSync: () => void;
  onExport?: () => void;
  count?: number;
  /** Hide when a child (e.g. customer table) renders its own sync banner. */
  hideSyncBanner?: boolean;
  children: ReactNode;
};

import { PAGE_STACK_GAP } from "../ui/pageLayout";

export function BillingModuleShell({
  title,
  description,
  summary,
  syncing,
  exporting,
  onSync,
  onExport,
  count,
  hideSyncBanner = false,
  children,
}: Props) {
  return (
    <Stack gap={PAGE_STACK_GAP} minW={0} maxW="100%">
      <Flex justify="space-between" align={{ base: "stretch", md: "center" }} gap={3} wrap="wrap" minW={0}>
        <Box minW={0} flex="1">
          <Heading size="lg">{title}</Heading>
          <Text fontSize="sm" color="gray.500" mt={0.5}>
            {description}
          </Text>
          {count != null && (
            <Text fontSize="xs" color="brand.700" fontWeight="medium" mt={1}>
              {count} record{count === 1 ? "" : "s"}
            </Text>
          )}
          {summary?.sync?.lastSyncAt && (
            <Text fontSize="xs" color="gray.500" mt={1}>
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
          <Button size="sm" colorPalette="brand" loading={syncing} onClick={onSync}>
            <FiRefreshCw />
            Sync
          </Button>
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
      {children}
    </Stack>
  );
}
