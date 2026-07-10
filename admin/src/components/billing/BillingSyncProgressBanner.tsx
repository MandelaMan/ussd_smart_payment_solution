import { Box, Flex, Progress, Text } from "@chakra-ui/react";
import { FiRefreshCw } from "react-icons/fi";
import type { ReconciliationSyncProgress } from "../../lib/api";

type Props = {
  status: string;
  progress?: ReconciliationSyncProgress | null;
  rowCount?: number;
  compact?: boolean;
};

function phaseLabel(phase?: string) {
  switch (phase) {
    case "zoho":
      return "Zoho Books & TISP";
    case "quick":
      return "Customer records";
    case "complete":
      return "Complete";
    default:
      return "Billing data";
  }
}

export function BillingSyncProgressBanner({
  status,
  progress,
  rowCount = 0,
  compact = false,
}: Props) {
  const running = status === "running";
  const processed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;
  const issuesFound = progress?.issuesFound ?? 0;
  const partialReady = progress?.partialReady ?? false;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  if (!running && !partialReady) return null;

  const title = !partialReady
    ? `Checking the first ${Math.min(20, total || 20)} customers…`
    : running
      ? "Loading remaining customers in the background"
      : "Sync complete";

  const detail =
    total > 0
      ? `Scanned ${processed} of ${total} customers · ${issuesFound} issue${issuesFound === 1 ? "" : "s"} found`
      : "Connecting to billing systems…";

  const rowNote =
    rowCount > 0
      ? `${rowCount} matching record${rowCount === 1 ? "" : "s"} shown — more may appear as the scan continues`
      : partialReady && running
        ? "No matches in the first batch yet — keep this page open while the scan continues"
        : "Results will appear here as customers are checked";

  return (
    <Box
      px={compact ? 3 : 4}
      py={compact ? 3 : 4}
      bg="brand.50"
      border="1px solid"
      borderColor="brand.100"
      borderRadius="lg"
    >
      <Flex align="flex-start" gap={3}>
        {running && (
          <Box color="brand.600" mt={0.5} flexShrink={0}>
            <FiRefreshCw size={18} />
          </Box>
        )}
        <Box flex={1} minW={0}>
          <Text fontSize="sm" fontWeight="semibold" color="brand.800">
            {title}
          </Text>
          <Text fontSize="xs" color="gray.600" mt={1}>
            {phaseLabel(progress?.phase)} · {detail}
          </Text>
          {running && total > 0 && (
            <Box mt={3}>
              <Progress.Root value={pct} size="sm" colorPalette="brand">
                <Progress.Track borderRadius="full" bg="brand.100">
                  <Progress.Range borderRadius="full" />
                </Progress.Track>
              </Progress.Root>
              <Text fontSize="2xs" color="gray.500" mt={1}>
                {pct}% complete
              </Text>
            </Box>
          )}
          <Text fontSize="xs" color="brand.700" mt={2}>
            {rowNote}
          </Text>
        </Box>
      </Flex>
    </Box>
  );
}
