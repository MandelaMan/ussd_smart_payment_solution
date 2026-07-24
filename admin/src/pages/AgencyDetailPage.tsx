import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiArrowLeft, FiFileText, FiRefreshCw } from "react-icons/fi";
import { AgencyInvoiceDialog } from "../components/agencies/AgencyInvoiceDialog";
import { DisplayText } from "../components/ui/DisplayText";
import { formatTitleCase } from "../lib/formatText";
import { dataTableRootCss, DataTableColumnHeader, DataTableSortHeader } from "../components/ui/DataTable";
import { useTableSort } from "../hooks/useTableSort";
import { sortRows } from "../lib/tableSort";
import { ModuleListPageSkeleton } from "../components/PageSkeletons";
import { PAGE_STACK_GAP, mobileStickyHeaderProps } from "../components/ui/pageLayout";
import { MobileFixedHeader } from "../components/ui/MobileFixedHeader";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MetricCard } from "../components/MetricCard";
import { TextStatus } from "../components/ui/TextStatus";
import {
  api,
  formatCurrency,
  formatDate,
  type Agency,
  type AgencyBilling,
  type AgencyInvoicePayload,
  type AgencyZohoStatus,
  type Customer,
  type ZohoInvoice,
} from "../lib/api";
import { canMutateAgencies } from "../lib/rbac";
import { useAuth } from "../lib/auth";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import { customerListExportColumns } from "../lib/dataTableExportColumns";
import { exportTableData, type ExportFormat, type ExportScope } from "../lib/tableExport";
import { toaster } from "../components/ui/toaster";

type AgencyCustomerSortKey =
  | "fullName"
  | "customerNumber"
  | "productName"
  | "buildingName"
  | "packagePrice"
  | "status";

type InvoiceDialogState =
  | { open: false }
  | { open: true; mode: "consolidated" }
  | { open: true; mode: "customer"; customer: Customer };

export function AgencyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canInvoice = canMutateAgencies(user);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [billing, setBilling] = useState<AgencyBilling | null>(null);
  const [zoho, setZoho] = useState<AgencyZohoStatus | null>(null);
  const [invoices, setInvoices] = useState<ZohoInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoiceDialog, setInvoiceDialog] = useState<InvoiceDialogState>({ open: false });
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { sorts, toggleSort } = useTableSort<AgencyCustomerSortKey>({
    sortBy: "fullName",
    sortDir: "asc",
  });

  const sortedCustomers = useMemo(
    () =>
      sortRows(customers, sorts, {
        fullName: (customer) => customer.fullName,
        customerNumber: (customer) => customer.customerNumber,
        productName: (customer) => customer.productName,
        buildingName: (customer) => customer.buildingName,
        packagePrice: (customer) => customer.packagePrice,
        status: (customer) => customer.subscriptionStatus || customer.status,
      }),
    [customers, sorts]
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getAgency(Number(id));
      setAgency(res.agency);
      setCustomers(res.customers);
      setBilling(res.billing);
      setZoho(res.zoho);
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Failed to load agency",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      await exportTableData({
        scope,
        format,
        filenameBase: `agency-${agency?.name || id}-customers`,
        columns: customerListExportColumns(false),
        viewRows: sortedCustomers,
        fetchAllRows: async () => customers,
      });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Export failed",
        type: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  const loadInvoices = useCallback(async () => {
    if (!id) return;
    setInvoicesLoading(true);
    try {
      const res = await api.getAgencyInvoices(Number(id));
      setInvoices(res.invoices);
      setZoho({
        linked: res.linked,
        zohoContactId: res.zohoContactId,
        invoiceCount: res.invoiceCount,
        unpaidCount: res.unpaidCount,
        totalBalanceDue: res.totalBalanceDue,
      });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Failed to load invoices",
        type: "error",
      });
    } finally {
      setInvoicesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (zoho?.linked) {
      loadInvoices();
    }
  }, [zoho?.linked, loadInvoices]);

  async function handleCreateInvoice(request: AgencyInvoicePayload) {
    if (!id) return;
    setCreatingInvoice(true);
    try {
      const res = await api.createAgencyInvoice(Number(id), request);
      const discountNote =
        res.invoice.discountAmount > 0
          ? ` (${formatCurrency(res.invoice.discountAmount)} discount)`
          : "";
      toaster.create({
        title: "Zoho invoice created",
        description: res.invoice.invoiceNumber
          ? `${res.invoice.invoiceNumber} · ${formatCurrency(res.invoice.total)}${discountNote}`
          : `${formatCurrency(res.invoice.total)}${discountNote}`,
        type: "success",
      });
      setInvoiceDialog({ open: false });
      await load();
      await loadInvoices();
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Invoice creation failed",
        type: "error",
        duration: 10000,
      });
    } finally {
      setCreatingInvoice(false);
    }
  }

  if (loading) {
    return <ModuleListPageSkeleton columns={6} showFilters={false} />;
  }

  if (!agency) {
    return <Text color="red.500">Agency not found</Text>;
  }

  const activeBillable = customers.filter(
    (c) => c.status === "active" && Number(c.packagePrice || 0) > 0
  );

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <Flex align="center" gap={3}>
        <Button asChild variant="ghost" size="sm">
          <Link to="/agencies"><FiArrowLeft /> Agencies</Link>
        </Button>
      </Flex>

      <MobileFixedHeader headerProps={mobileStickyHeaderProps}>
        <Flex justify="space-between" align="start" gap={3} wrap="wrap" minW={0}>
          <Box minW={0}>
            <Heading size="lg">{formatTitleCase(agency.name)}</Heading>
            <Text fontSize="sm" color="fg.muted" mt={1}>
              {agency.contactPerson && `${formatTitleCase(agency.contactPerson)} · `}
              {agency.email} · {agency.phone}
            </Text>
          </Box>
          {canInvoice && activeBillable.length > 0 ? (
            <Button
              colorPalette="brand"
              size="sm"
              onClick={() => setInvoiceDialog({ open: true, mode: "consolidated" })}
            >
              <FiFileText style={{ marginRight: 6 }} />
              Create consolidated Zoho invoice
            </Button>
          ) : null}
        </Flex>
      </MobileFixedHeader>
      <Flex
        display={{ base: "none", lg: "flex" }}
        justify="space-between"
        align={{ base: "start", md: "center" }}
        gap={3}
        wrap="wrap"
        minW={0}
      >
        <Box minW={0}>
          <Heading size="lg">{formatTitleCase(agency.name)}</Heading>
          <Text fontSize="sm" color="fg.muted" mt={1}>
            {agency.contactPerson && `${formatTitleCase(agency.contactPerson)} · `}
            {agency.email} · {agency.phone}
          </Text>
        </Box>
        {canInvoice && activeBillable.length > 0 ? (
          <Button
            colorPalette="brand"
            size="sm"
            onClick={() => setInvoiceDialog({ open: true, mode: "consolidated" })}
          >
            <FiFileText style={{ marginRight: 6 }} />
            Create consolidated Zoho invoice
          </Button>
        ) : null}
      </Flex>

      {billing ? (
        <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={4}>
          <MetricCard
            label="Active customers"
            value={billing.activeCustomers}
            sub={`${billing.totalCustomers} total linked`}
            accent="cerulean"
          />
          <MetricCard
            label="Invoice amount"
            value={formatCurrency(billing.totalInvoiceAmount ?? billing.totalActiveAmount)}
            sub={
              billing.discountPercent
                ? `${billing.discountPercent}% discount · list ${formatCurrency(billing.totalActiveAmount)}`
                : "Sum of active package prices"
            }
            accent="teal"
          />
          <MetricCard
            label="Zoho billing"
            value={zoho?.linked ? "Linked" : "Not linked"}
            sub={
              zoho?.linked
                ? `${zoho.invoiceCount} invoice${zoho.invoiceCount === 1 ? "" : "s"}${
                    zoho.unpaidCount > 0
                      ? ` · ${zoho.unpaidCount} unpaid (${formatCurrency(zoho.totalBalanceDue)})`
                      : ""
                  }`
                : zoho?.zohoError || "Contact created on first invoice"
            }
            accent={zoho?.linked ? "mindaro" : "sandy"}
          />
        </Grid>
      ) : null}

      <Box bg="bg.panel" borderRadius="sm" border="1px solid" borderColor="border.muted" overflow="hidden">
        <Box px={4} py={3} borderBottom="1px solid" borderColor="border.muted">
          <Flex justify="space-between" align="start" gap={3}>
            <Box>
              <Text fontWeight="medium">Managed customers ({customers.length})</Text>
              <Text fontSize="xs" color="fg.muted">
                B2B subscriptions billed to this agency — invoice individually or as one consolidated Zoho invoice
              </Text>
            </Box>
            <DataTableExportButton
              entityLabel="customers"
              viewCount={sortedCustomers.length}
              totalCount={customers.length}
              loading={exporting}
              onExport={handleExport}
            />
          </Flex>
        </Box>
        <ResponsiveListViews
          mobile={
            customers.length === 0 ? (
              <Text py={8} textAlign="center" color="fg.muted" fontSize="sm">
                No customers linked to this agency
              </Text>
            ) : (
              <MobileDataList
                items={sortedCustomers}
                getKey={(c) => c.id}
                renderCard={(c) => (
                  <MobileDataCard
                    title={c.fullName}
                    subtitle={c.customerNumber}
                    trailing={
                      <Badge colorPalette={c.status === "active" ? "green" : "gray"} variant="subtle">
                        {c.subscriptionStatus || c.status}
                      </Badge>
                    }
                    showChevron={false}
                    fields={[
                      { label: "Package", value: c.productName },
                      { label: "Building", value: c.buildingName },
                      { label: "Price", value: formatCurrency(c.packagePrice) },
                    ]}
                    footer={
                      canInvoice && c.status === "active" && Number(c.packagePrice || 0) > 0 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setInvoiceDialog({ open: true, mode: "customer", customer: c })
                          }
                        >
                          Invoice
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              />
            )
          }
          desktop={
        <Box overflowX="auto">
        <Table.Root size="sm" css={dataTableRootCss} tableLayout="fixed" w="full" minW="720px">
          <Table.Header>
            <Table.Row>
              <DataTableSortHeader label="Customer" column="fullName" sorts={sorts} onSort={toggleSort} />
              <DataTableSortHeader label="Number" column="customerNumber" sorts={sorts} onSort={toggleSort} />
              <DataTableSortHeader label="Package" column="productName" sorts={sorts} onSort={toggleSort} />
              <DataTableSortHeader label="Building" column="buildingName" sorts={sorts} onSort={toggleSort} />
              <DataTableSortHeader label="Price" column="packagePrice" sorts={sorts} onSort={toggleSort} defaultDir="desc" />
              <DataTableSortHeader label="Status" column="status" sorts={sorts} onSort={toggleSort} />
              {canInvoice ? <DataTableColumnHeader>Invoice</DataTableColumnHeader> : null}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {customers.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={canInvoice ? 7 : 6} py={8} textAlign="center" color="fg.muted">
                  No customers linked to this agency
                </Table.Cell>
              </Table.Row>
            ) : (
              sortedCustomers.map((c) => (
                <Table.Row key={c.id}>
                  <Table.Cell fontWeight="medium">
                    <DisplayText value={c.fullName} />
                  </Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="xs" textTransform="uppercase">{c.customerNumber}</Table.Cell>
                  <Table.Cell>
                    <DisplayText value={c.productName} />
                  </Table.Cell>
                  <Table.Cell>
                    <DisplayText value={c.buildingName} />
                  </Table.Cell>
                  <Table.Cell>{formatCurrency(c.packagePrice)}</Table.Cell>
                  <Table.Cell>
                    <Badge colorPalette={c.status === "active" ? "green" : "gray"} variant="subtle">
                      {c.subscriptionStatus || c.status}
                    </Badge>
                  </Table.Cell>
                  {canInvoice ? (
                    <Table.Cell>
                      {c.status === "active" && Number(c.packagePrice || 0) > 0 ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            setInvoiceDialog({ open: true, mode: "customer", customer: c })
                          }
                        >
                          Invoice
                        </Button>
                      ) : (
                        <Text fontSize="xs" color="fg.subtle">—</Text>
                      )}
                    </Table.Cell>
                  ) : null}
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Root>
        </Box>
          }
        />
        {customers.length > 0 && billing ? (
          <Flex
            justify="flex-end"
            px={4}
            py={3}
            borderTop="1px solid"
            borderColor="border.muted"
            bg="bg.subtle"
            gap={4}
          >
            <Text fontSize="sm" color="fg.muted">
              Active total: <strong>{formatCurrency(billing.totalActiveAmount)}</strong>
            </Text>
          </Flex>
        ) : null}
      </Box>

      {zoho?.linked ? (
        <Box bg="bg.panel" borderRadius="sm" border="1px solid" borderColor="border.muted" overflow="hidden">
          <Flex
            justify="space-between"
            align="center"
            px={4}
            py={3}
            borderBottom="1px solid"
            borderColor="border.muted"
          >
            <Box>
              <Text fontWeight="medium">Zoho invoices</Text>
              <Text fontSize="xs" color="fg.muted">
                Recent invoices for this agency in Zoho Books
              </Text>
            </Box>
            <Button
              size="xs"
              variant="outline"
              onClick={() => loadInvoices()}
              loading={invoicesLoading}
            >
              <FiRefreshCw style={{ marginRight: 4 }} />
              Refresh
            </Button>
          </Flex>
          <ResponsiveListViews
            mobile={
              invoices.length === 0 ? (
                <Text py={6} textAlign="center" color="fg.muted" fontSize="sm">
                  {invoicesLoading ? "Loading invoices…" : "No Zoho invoices yet"}
                </Text>
              ) : (
                <MobileDataList
                  items={invoices.slice(0, 10)}
                  getKey={(inv) => inv.id}
                  renderCard={(inv) => (
                    <MobileDataCard
                      title={inv.invoiceNumber || inv.id}
                      trailing={<TextStatus status={inv.status} />}
                      showChevron={false}
                      fields={[
                        { label: "Date", value: inv.date ? formatDate(inv.date) : "—" },
                        { label: "Total", value: formatCurrency(inv.total) },
                        {
                          label: "Balance",
                          value: (inv.balanceDue || 0) > 0 ? formatCurrency(inv.balanceDue) : "—",
                        },
                      ]}
                    />
                  )}
                />
              )
            }
            desktop={
          <Table.Root size="sm" css={dataTableRootCss} minW="640px">
            <Table.Header>
              <Table.Row>
                <DataTableColumnHeader>Invoice</DataTableColumnHeader>
                <DataTableColumnHeader>Date</DataTableColumnHeader>
                <DataTableColumnHeader>Status</DataTableColumnHeader>
                <DataTableColumnHeader>Total</DataTableColumnHeader>
                <DataTableColumnHeader>Balance</DataTableColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {invoices.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={5} py={6} textAlign="center" color="fg.muted">
                    {invoicesLoading ? "Loading invoices…" : "No Zoho invoices yet"}
                  </Table.Cell>
                </Table.Row>
              ) : (
                invoices.slice(0, 10).map((inv) => (
                  <Table.Row key={inv.id}>
                    <Table.Cell fontWeight="medium">
                      {inv.invoiceNumber || inv.id}
                    </Table.Cell>
                    <Table.Cell color="fg.muted">
                      {inv.date ? formatDate(inv.date) : "—"}
                    </Table.Cell>
                    <Table.Cell>
                      <TextStatus status={inv.status} />
                    </Table.Cell>
                    <Table.Cell>{formatCurrency(inv.total)}</Table.Cell>
                    <Table.Cell>
                      {(inv.balanceDue || 0) > 0
                        ? formatCurrency(inv.balanceDue)
                        : "—"}
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table.Root>
            }
          />
        </Box>
      ) : null}

      {invoiceDialog.open ? (
        <AgencyInvoiceDialog
          open
          mode={invoiceDialog.mode}
          customer={invoiceDialog.mode === "customer" ? invoiceDialog.customer : null}
          customers={customers}
          defaultDiscountPercent={agency?.discountPercent}
          submitting={creatingInvoice}
          onClose={() => setInvoiceDialog({ open: false })}
          onSubmit={handleCreateInvoice}
        />
      ) : null}
    </Stack>
  );
}
