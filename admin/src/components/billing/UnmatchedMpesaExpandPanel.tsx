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
    <Stack gap={{ base: 2, md: 3 }} p={{ base: 1.5, md: 2 }} bg="bg.subtle" borderRadius="md" w="full">
      <Flex justify="space-between" align="flex-start" gap={2} wrap="wrap">
        <Box flex={1} minW={0}>
          <Text fontSize="2xs" fontWeight="semibold" color="fg.muted" mb={0.5}>
            Planned action
          </Text>
          <Text fontSize="sm" color="brand.800" lineHeight="1.35">
            {detail.plannedAction}
          </Text>
          {detail.customer && (
            <Flex align="center" gap={2} mt={1.5} wrap="wrap">
              <Text fontSize="xs" color="fg.muted">
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
          w={{ base: "full", sm: "auto" }}
        >
          <FiCheckCircle />
          {detail.alreadyAllocated ? "Already allocated" : "Allocate in Zoho & update TISP"}
        </Button>
      </Flex>

      {detail.openInvoices.length > 0 && (
        <Box w="full">
          <Text fontSize="2xs" fontWeight="semibold" color="fg.muted" mb={1.5}>
            Open Zoho invoices
          </Text>
          <Stack
            gap={0}
            divideY="1px"
            divideColor="gray.100"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="md"
            overflow="hidden"
            display={{ base: "flex", lg: "none" }}
          >
            {detail.openInvoices.map((inv) => (
              <Flex key={inv.id} px={2.5} py={2} justify="space-between" gap={2} minW={0}>
                <Box minW={0} flex={1}>
                  <Text fontSize="xs" fontWeight="semibold" lineClamp={1}>
                    {inv.invoiceNumber || inv.id}
                  </Text>
                  <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                    Due {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                  </Text>
                </Box>
                <Text fontSize="xs" fontWeight="semibold" color="brand.800" whiteSpace="nowrap">
                  {formatCurrency(inv.balanceDue)}
                </Text>
              </Flex>
            ))}
          </Stack>
          <Box display={{ base: "none", lg: "block" }}>
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
        </Box>
      )}

      <Text fontSize="2xs" color="fg.muted" lineHeight="1.4">
        Checks Zoho for an unpaid invoice matching this payment, marks it paid, posts to TISP, and
        refreshes service status.
      </Text>
    </Stack>
  );
}
