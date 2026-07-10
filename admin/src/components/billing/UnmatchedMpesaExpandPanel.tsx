import { useCallback, useEffect, useState } from "react";
import { Box, Button, Flex, Stack, Table, Text } from "@chakra-ui/react";
import { FiCheckCircle, FiExternalLink } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";
import {
  api,
  formatCurrency,
  formatDate,
  type UnmatchedMpesaDetail,
} from "../../lib/api";
import { DataTable, dataTableCellProps, DataTableColumnHeader } from "../ui/DataTable";
import { SkeletonBlock } from "../ui/SkeletonBlock";
import { TextStatus } from "../ui/TextStatus";
import { toaster } from "../ui/toaster";

type Props = {
  paymentId: number;
  onComplete?: () => void;
};

export function UnmatchedMpesaExpandPanel({ paymentId, onComplete }: Props) {
  const [detail, setDetail] = useState<UnmatchedMpesaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [allocating, setAllocating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDetail(await api.getUnmatchedMpesaDetail(paymentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payment details");
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAllocate() {
    setAllocating(true);
    try {
      const result = await api.allocateUnmatchedMpesa(paymentId);
      toaster.success({
        title: "Payment allocated",
        description: result.message,
      });
      if (result.tispError) {
        toaster.warning({
          title: "TISP update incomplete",
          description: result.tispError,
        });
      }
      onComplete?.();
      await load();
    } catch (e) {
      toaster.error({
        title: "Allocation failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setAllocating(false);
    }
  }

  if (loading) {
    return (
      <Stack gap={2} p={2}>
        <SkeletonBlock h="16px" w="60%" />
        <SkeletonBlock h="12px" w="80%" />
        <SkeletonBlock h="80px" />
      </Stack>
    );
  }

  if (error) {
    return (
      <Text fontSize="sm" color="red.600" p={2}>
        {error}
      </Text>
    );
  }

  if (!detail) return null;

  return (
    <Stack gap={3} p={2} bg="gray.50" borderRadius="md">
      <Flex justify="space-between" align="flex-start" gap={3} wrap="wrap">
        <Box flex={1} minW={0}>
          <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={1}>
            Planned action
          </Text>
          <Text fontSize="sm" color="brand.800">
            {detail.plannedAction}
          </Text>
          {detail.customer && (
            <Flex align="center" gap={2} mt={2} wrap="wrap">
              <Text fontSize="xs" color="gray.600">
                {detail.customer.customerName} · {detail.customer.customerNumber}
              </Text>
              {detail.customer.subscriptionStatus && (
                <TextStatus status={detail.customer.subscriptionStatus} />
              )}
              <RouterLink
                to={`/customers?search=${encodeURIComponent(detail.customer.customerNumber)}`}
                style={{ fontSize: "12px", color: "var(--chakra-colors-brand-600)" }}
              >
                <Flex align="center" gap={1}>
                  View customer <FiExternalLink size={12} />
                </Flex>
              </RouterLink>
            </Flex>
          )}
        </Box>

        <Button
          size="sm"
          colorPalette="brand"
          loading={allocating}
          disabled={!detail.canAllocate || detail.alreadyAllocated}
          onClick={handleAllocate}
        >
          <FiCheckCircle />
          {detail.alreadyAllocated ? "Already allocated" : "Allocate in Zoho & update TISP"}
        </Button>
      </Flex>

      {detail.openInvoices.length > 0 && (
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={2}>
            Open Zoho invoices
          </Text>
          <DataTable>
            <Table.Header>
              <Table.Row>
                <DataTableColumnHeader>Invoice</DataTableColumnHeader>
                <DataTableColumnHeader>Due</DataTableColumnHeader>
                <DataTableColumnHeader textAlign="right">Balance</DataTableColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {detail.openInvoices.map((inv) => (
                <Table.Row key={inv.id}>
                  <Table.Cell {...dataTableCellProps}>{inv.invoiceNumber || inv.id}</Table.Cell>
                  <Table.Cell {...dataTableCellProps}>
                    {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                  </Table.Cell>
                  <Table.Cell {...dataTableCellProps} textAlign="right">
                    {formatCurrency(inv.balanceDue)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </DataTable>
        </Box>
      )}

      <Text fontSize="xs" color="gray.500">
        Checks Zoho for an unpaid invoice matching this payment, marks it paid, posts to TISP, and
        refreshes service status.
      </Text>
    </Stack>
  );
}
