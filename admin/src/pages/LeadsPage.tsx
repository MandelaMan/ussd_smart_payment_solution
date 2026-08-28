import { Fragment, useCallback, useEffect, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useVisibilityRefresh } from "../hooks/useVisibilityRefresh";
import { mergeInfinitePage, useMobileViewport } from "../hooks/useMobileViewport";
import { useTableSort } from "../hooks/useTableSort";
import { useSearchParams, Link } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Input,
  Stack,
  Table,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { FiChevronDown, FiChevronRight, FiCopy } from "react-icons/fi";
import {
  api,
  type Lead,
  type LeadMessage,
  type LeadStats,
  type ListPagination,
} from "../lib/api";
import { useAuth } from "../lib/authContext";
import { canMutateCustomers, hasPermission } from "../lib/rbac";
import {
  LEAD_SOURCE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  leadSourceLabel,
  leadStatusLabel,
  parseLeadSignup,
  publicSignupUrl,
} from "../lib/leadSignup";
import { toaster } from "../components/ui/toaster";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { EmptyState, ListPageStack } from "../components/ui/pageLayout";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { DisplayText } from "../components/ui/DisplayText";
import { SelectField } from "../components/ui/SelectField";
import { TabStrip } from "../components/ui/TabStrip";
import { ProspectWhatsAppInbox } from "../components/leads/ProspectWhatsAppInbox";
import { ProspectEmailInbox } from "../components/leads/ProspectEmailInbox";
import {
  DataTable,
  DataTableCard,
  DataTableSortHeader,
  DATA_TABLE_LEADING_COL_WIDTH,
  dataTableCellProps,
  dataTableExpandRowProps,
  dataTableTitleColumnHeaderProps,
} from "../components/ui/DataTable";
import { BRAND } from "../theme";

const PAGE_SIZE = 30;
const LEAD_SECTIONS = [
  { id: "all", label: "All leads" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
] as const;
type LeadSection = (typeof LEAD_SECTIONS)[number]["id"];

type LeadSortKey = "createdAt" | "name" | "status" | "source";

function statusColor(status: string): string {
  switch (status) {
    case "new":
      return "orange";
    case "interested":
      return "teal";
    case "contacted":
      return "blue";
    case "qualified":
      return "purple";
    case "converted":
      return "green";
    default:
      return "gray";
  }
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LeadsPage() {
  const { user } = useAuth();
  const canMutate = canMutateCustomers(user);
  const canConvert = hasPermission(user, "customers.create");
  const isMobile = useMobileViewport();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const section: LeadSection =
    sectionParam === "whatsapp"
      ? "whatsapp"
      : sectionParam === "email"
        ? "email"
        : "all";
  const initialChannelLeadId = (() => {
    const raw = searchParams.get("lead");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  function setSection(next: string) {
    const id =
      next === "whatsapp" ? "whatsapp" : next === "email" ? "email" : "all";
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id === "all") p.delete("section");
        else p.set("section", id);
        if (id !== "whatsapp" && id !== "email") p.delete("lead");
        return p;
      },
      { replace: true }
    );
  }

  function openLeadRow(lead: Lead) {
    if (lead.source === "whatsapp") {
      setSearchParams(
        { section: "whatsapp", lead: String(lead.id) },
        { replace: false }
      );
      return;
    }
    if (lead.source === "email") {
      setSearchParams(
        { section: "email", lead: String(lead.id) },
        { replace: false }
      );
      return;
    }
    void openLead(lead.id);
  }

  async function copySignupLink() {
    try {
      await navigator.clipboard.writeText(publicSignupUrl());
      toaster.create({ type: "success", title: "Signup link copied" });
    } catch {
      toaster.create({ type: "error", title: "Could not copy signup link" });
    }
  }

  const [leads, setLeads] = useState<Lead[]>([]);
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { sorts, toggleSort, sortQuery } = useTableSort<LeadSortKey>({
    sortBy: "createdAt",
    sortDir: "desc",
  });

  useEffect(() => {
    setSearch(debouncedSearchInput);
    setPage(1);
  }, [debouncedSearchInput]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const append = isMobile && page > 1;
    if (!opts?.silent) {
      if (append) setLoadingMore(true);
      else setLoading(true);
    }
    setError("");
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(PAGE_SIZE),
        sortBy: sortQuery.sortBy,
        sortDir: sortQuery.sortDir,
      };
      if (search.trim()) params.search = search.trim();
      if (status) params.status = status;
      if (source) params.source = source;
      const [listRes, statsRes] = await Promise.all([
        api.listLeads(params),
        page === 1 && !append ? api.getLeadStats() : Promise.resolve(null),
      ]);
      setLeads((prev) =>
        mergeInfinitePage(prev, listRes.leads, page, isMobile && !opts?.silent, (a) => a.id)
      );
      setPagination(listRes.pagination);
      if (statsRes) setStats(statsRes);
    } catch (e) {
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : "Failed to load leads");
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, page, status, source, sortQuery.sortBy, sortQuery.sortDir, isMobile]);

  useEffect(() => {
    if (section !== "all") return;
    void load();
  }, [load, section]);

  useVisibilityRefresh(() => {
    if (section !== "all") return;
    void load({ silent: true });
  });

  async function openLead(id: number) {
    if (expanded === id) {
      setExpanded(null);
      setMessages([]);
      setNote("");
      return;
    }
    setExpanded(id);
    setDetailLoading(true);
    setNote("");
    try {
      const res = await api.getLead(id);
      setMessages(res.messages);
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, ...res.lead } : l))
      );
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to load lead",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeStatus(lead: Lead, next: Lead["status"]) {
    if (!canMutate) return;
    setSaving(true);
    try {
      const res = await api.updateLead(lead.id, { status: next });
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, ...res.lead } : l))
      );
      toaster.create({ type: "success", title: "Lead updated" });
      setStats(await api.getLeadStats());
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Update failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function submitNote(leadId: number) {
    if (!canMutate || !note.trim()) return;
    setSaving(true);
    try {
      const res = await api.addLeadNote(leadId, note.trim());
      setMessages(res.messages);
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, ...res.lead } : l))
      );
      setNote("");
      toaster.create({ type: "success", title: "Note added" });
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to add note",
      });
    } finally {
      setSaving(false);
    }
  }

  function handleSort(
    column: LeadSortKey,
    defaultDir: "asc" | "desc" = "desc",
    additive = false
  ) {
    toggleSort(column, defaultDir, additive);
    setPage(1);
    setExpanded(null);
  }

  const expandPanel = (lead: Lead) => {
    const signup = parseLeadSignup(lead);
    const canVerify =
      canConvert &&
      lead.status !== "converted" &&
      lead.status !== "closed" &&
      (lead.status === "interested" || lead.source === "signup");
    return (
    <Box px={4} py={4} bg="bg.muted" borderTopWidth="1px" borderColor="border">
      {detailLoading ? (
        <Text fontSize="sm" color="fg.muted">
          Loading conversation…
        </Text>
      ) : (
        <Stack gap={4}>
          <Flex gap={3} flexWrap="wrap" align="end">
            <Field.Root maxW="280px">
              <Field.Label>Status</Field.Label>
              <SelectField
                size="sm"
                disabled={!canMutate || saving}
                fieldProps={{
                  value: lead.status,
                  onChange: (e) =>
                    void changeStatus(lead, e.target.value as Lead["status"]),
                }}
              >
                {LEAD_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
            </Field.Root>
            <Box flex="1" minW="180px">
              <Text fontSize="sm" color="fg.muted">
                {lead.interest || "No interest set"}
                {lead.buildingInterest ? ` · ${lead.buildingInterest}` : ""}
                {lead.apartmentNumber ? ` · apt ${lead.apartmentNumber}` : ""}
                {lead.block ? ` · ${lead.block}` : ""}
              </Text>
              {lead.message ? (
                <Text fontSize="sm" mt={1}>
                  {lead.message}
                </Text>
              ) : null}
            </Box>
            {canVerify ? (
              <Button asChild size="sm" colorPalette="brand">
                <Link to={`/customers/new?leadId=${lead.id}`}>
                  Verify & convert to customer
                </Link>
              </Button>
            ) : lead.convertedCustomerId ? (
              <Text fontSize="sm" color="fg.muted">
                Converted to customer #{lead.convertedCustomerId}
              </Text>
            ) : null}
          </Flex>

          {lead.status === "interested" || lead.source === "signup" ? (
            <Box
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
              bg="bg.panel"
              p={3}
            >
              <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={2}>
                Signup details to verify
              </Text>
              <Stack gap={1} fontSize="sm">
                <Text>
                  {signup.firstName} {signup.lastName}
                </Text>
                <Text color="fg.muted">
                  {signup.phone || "—"} · {signup.email || "—"}
                </Text>
                <Text>
                  {signup.buildingName || "Building not set"}
                  {signup.apartmentNumber ? ` · apt ${signup.apartmentNumber}` : ""}
                  {lead.block ? ` · ${lead.block}` : ""}
                </Text>
                <Text>
                  {signup.productName || "Package not set"}
                  {signup.paymentFrequency ? ` · ${signup.paymentFrequency}` : ""}
                </Text>
                {signup.dstvDecoderSerial ? (
                  <Text fontFamily="mono" fontSize="xs">
                    DSTV {signup.dstvDecoderSerial}
                  </Text>
                ) : null}
              </Stack>
            </Box>
          ) : null}

          <Box
            maxH="240px"
            overflowY="auto"
            borderWidth="1px"
            borderColor="border"
            borderRadius="md"
            bg="bg.panel"
            p={3}
          >
            {messages.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                No messages yet.
              </Text>
            ) : (
              <Stack gap={2}>
                {messages.map((m) => (
                  <Box
                    key={m.id}
                    alignSelf={
                      m.direction === "inbound" ? "flex-start" : "flex-end"
                    }
                    maxW="90%"
                    px={3}
                    py={2}
                    borderRadius="md"
                    bg={
                      m.direction === "inbound"
                        ? "blackAlpha.50"
                        : m.channel === "system"
                          ? "mindaro.500/40"
                          : `${BRAND.paleAzure}33`
                    }
                  >
                    <Text fontSize="xs" color="fg.muted" mb={0.5}>
                      {m.direction} · {m.channel} · {formatWhen(m.createdAt)}
                    </Text>
                    <Text fontSize="sm" whiteSpace="pre-wrap">
                      {m.body}
                    </Text>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          {canMutate ? (
            <Stack gap={2}>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add an internal note…"
                rows={2}
              />
              <Button
                alignSelf="flex-start"
                size="sm"
                colorPalette="brand"
                loading={saving}
                onClick={() => void submitNote(lead.id)}
                disabled={!note.trim()}
              >
                Add note
              </Button>
            </Stack>
          ) : null}
        </Stack>
      )}
    </Box>
    );
  };

  const leadStatsActions = stats ? (
    <Flex
      gap={2}
      flexWrap="wrap"
      justify="flex-end"
      align="stretch"
      maxW={{ lg: "min(640px, 58vw)" }}
    >
      {[
        { label: "Total", value: stats.total },
        { label: "Interested", value: stats.byStatus.interested ?? 0 },
        { label: "New", value: stats.byStatus.new },
        { label: "Signup", value: stats.bySource.signup ?? 0 },
        { label: "WhatsApp", value: stats.bySource.whatsapp },
        { label: "Email", value: stats.bySource.email ?? 0 },
        { label: "Web", value: stats.bySource.web },
        { label: "Embed", value: stats.bySource.embed },
      ].map((card) => (
        <Box
          key={card.label}
          px={3}
          py={1.5}
          borderRadius="md"
          borderWidth="1px"
          borderColor="border"
          bg="bg.panel"
          minW="72px"
          textAlign="center"
        >
          <Text fontSize="2xs" color="fg.muted" lineHeight="1.2">
            {card.label}
          </Text>
          <Text fontWeight="700" fontSize="md" lineHeight="1.2" mt={0.5}>
            {card.value}
          </Text>
        </Box>
      ))}
    </Flex>
  ) : null;

  return (
    <ListPageStack>
      <ListPageTableSection
        chrome={
          <ListPageStickyChrome gap={{ base: 4, lg: 5 }}>
            <MobilePageChrome
        title="Leads"
        headerActions={
          <IconButton
            aria-label="Copy signup link"
            size="sm"
            variant="outline"
            onClick={() => void copySignupLink()}
          >
            <FiCopy />
          </IconButton>
        }
        desktopActions={
          <Flex gap={2} align="center" wrap="wrap" justify="flex-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copySignupLink()}
            >
              <FiCopy />
              Copy signup link
            </Button>
            {section === "all" ? leadStatsActions : null}
          </Flex>
        }
        searchValue={section === "all" ? searchInput : undefined}
        onSearchChange={section === "all" ? setSearchInput : undefined}
        searchPlaceholder="Name, phone, email…"
        filterContent={
          section === "all" ? (
          <Stack gap={3}>
            <Field.Root>
              <Field.Label>Status</Field.Label>
              <SelectField
                size="sm"
                fieldProps={{
                  value: status,
                  onChange: (e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  },
                }}
              >
                <option value="">All statuses</option>
                {LEAD_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
            </Field.Root>
            <Field.Root>
              <Field.Label>Source</Field.Label>
              <SelectField
                size="sm"
                fieldProps={{
                  value: source,
                  onChange: (e) => {
                    setSource(e.target.value);
                    setPage(1);
                  },
                }}
              >
                <option value="">All sources</option>
                {LEAD_SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
            </Field.Root>
          </Stack>
          ) : undefined
        }
        activeFilterCount={
          section === "all" ? (status ? 1 : 0) + (source ? 1 : 0) : 0
        }
        onClearFilters={
          section === "all"
            ? () => {
                setStatus("");
                setSource("");
                setPage(1);
              }
            : undefined
        }
        sortOptions={
          section === "all"
            ? [
          {
            key: "createdAt",
            label: "Received",
            active: sorts[0]?.sortBy === "createdAt",
            direction:
              sorts[0]?.sortBy === "createdAt" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("createdAt", "desc"),
          },
          {
            key: "name",
            label: "Name",
            active: sorts[0]?.sortBy === "name",
            direction: sorts[0]?.sortBy === "name" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("name", "asc"),
          },
          {
            key: "status",
            label: "Status",
            active: sorts[0]?.sortBy === "status",
            direction:
              sorts[0]?.sortBy === "status" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("status", "asc"),
          },
            ]
            : undefined
        }
            />

            <TabStrip
              tabs={[...LEAD_SECTIONS]}
              active={section}
              onChange={setSection}
              fitContent
            />

            {section === "all" ? (
            <FilterToolbar embedded>
        <FilterField label="Search" flex={FILTER_FLEX.search} minW={0} hideOnMobile>
          <Input
            size="sm"
            placeholder="Name, phone, email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            borderRadius="md"
          />
        </FilterField>
        <FilterField label="Status" flex={FILTER_FLEX.standard} minW="140px" hideOnMobile>
          <SelectField
            size="sm"
            fieldProps={{
              value: status,
              onChange: (e) => {
                setStatus(e.target.value);
                setPage(1);
              },
            }}
          >
            <option value="">All statuses</option>
            {LEAD_STATUS_OPTIONS.map((opt) => (
              <option key={`desk-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectField>
        </FilterField>
        <FilterField label="Source" flex={FILTER_FLEX.standard} minW="140px" hideOnMobile>
          <SelectField
            size="sm"
            fieldProps={{
              value: source,
              onChange: (e) => {
                setSource(e.target.value);
                setPage(1);
              },
            }}
          >
            <option value="">All sources</option>
            {LEAD_SOURCE_OPTIONS.map((opt) => (
              <option key={`desk-src-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectField>
        </FilterField>
            </FilterToolbar>
            ) : null}
          </ListPageStickyChrome>
        }
      >

      {section === "whatsapp" ? (
        <Box pt={{ base: 2, lg: 3 }}>
          <ProspectWhatsAppInbox initialLeadId={initialChannelLeadId} />
        </Box>
      ) : section === "email" ? (
        <Box pt={{ base: 2, lg: 3 }}>
          <ProspectEmailInbox initialLeadId={initialChannelLeadId} />
        </Box>
      ) : (
        <Stack gap={{ base: 4, lg: 5 }} pt={{ base: 2, lg: 3 }}>
      {leadStatsActions ? (
        <Box display={{ base: "block", lg: "none" }}>{leadStatsActions}</Box>
      ) : null}

      {error ? (
        <Box bg="red.50" color="red.700" p={3} borderRadius="lg" fontSize="sm">
          {error}
        </Box>
      ) : null}

      <DataTableCard
        loading={loading}
        loadingMore={loadingMore}
        loadedCount={leads.length}
        pagination={pagination}
        onPageChange={(nextPage) => {
          setPage(nextPage);
          setExpanded(null);
        }}
        itemLabel="leads"
      >
        {loading ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="card" fieldCount={2} />}
            desktop={<DataTableLoadingSkeleton columns={6} fill />}
          />
        ) : leads.length === 0 ? (
          <EmptyState>
            No leads yet. Share the public form or WhatsApp link to start capturing
            enquiries.
          </EmptyState>
        ) : (
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={leads}
                getKey={(l) => l.id}
                expandedId={expanded}
                renderCard={(lead, isOpen) => (
                  <MobileDataCard
                    title={lead.name || lead.phone || `Lead #${lead.id}`}
                    subtitle={`${leadSourceLabel(lead.source)} · ${formatWhen(lead.createdAt)}`}
                    trailing={
                      <Badge colorPalette={statusColor(lead.status)} variant="subtle">
                        {leadStatusLabel(lead.status)}
                      </Badge>
                    }
                    isOpen={isOpen}
                    onClick={() => openLeadRow(lead)}
                    variant="card"
                  />
                )}
                renderExpanded={(lead) => expandPanel(lead)}
              />
            }
            desktop={
              <DataTable fixedLayout>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader
                      {...dataTableTitleColumnHeaderProps}
                      w={DATA_TABLE_LEADING_COL_WIDTH}
                    />
                    <DataTableSortHeader
                      label="Name"
                      column="name"
                      sorts={sorts}
                      onSort={handleSort}
                      defaultDir="asc"
                    />
                    <Table.ColumnHeader {...dataTableTitleColumnHeaderProps}>
                      Contact
                    </Table.ColumnHeader>
                    <DataTableSortHeader
                      label="Source"
                      column="source"
                      sorts={sorts}
                      onSort={handleSort}
                      defaultDir="asc"
                    />
                    <DataTableSortHeader
                      label="Status"
                      column="status"
                      sorts={sorts}
                      onSort={handleSort}
                      defaultDir="asc"
                    />
                    <DataTableSortHeader
                      label="Received"
                      column="createdAt"
                      sorts={sorts}
                      onSort={handleSort}
                      defaultDir="desc"
                    />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {leads.map((lead) => {
                    const isOpen = expanded === lead.id;
                    return (
                      <Fragment key={lead.id}>
                        <Table.Row
                          bg={isOpen ? "brand.50" : undefined}
                          cursor="pointer"
                          onClick={() => openLeadRow(lead)}
                          _hover={{ bg: isOpen ? "brand.50" : "gray.50" }}
                        >
                          <Table.Cell
                            {...dataTableCellProps}
                            w={DATA_TABLE_LEADING_COL_WIDTH}
                          >
                            {isOpen ? (
                              <FiChevronDown size={16} />
                            ) : (
                              <FiChevronRight size={16} />
                            )}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps} fontWeight="semibold">
                            <DisplayText value={lead.name || "—"} fontWeight="semibold" />
                            {lead.interest ? (
                              <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                                {lead.interest}
                              </Text>
                            ) : null}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps}>
                            <Text fontSize="sm">{lead.phone || "—"}</Text>
                            {lead.email ? (
                              <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                                {lead.email}
                              </Text>
                            ) : null}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps}>
                            {leadSourceLabel(lead.source)}
                            {lead.messageCount ? (
                              <Text fontSize="xs" color="fg.muted">
                                {lead.messageCount} msgs
                              </Text>
                            ) : null}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps}>
                            <Badge colorPalette={statusColor(lead.status)} variant="subtle">
                              {leadStatusLabel(lead.status)}
                            </Badge>
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps} color="fg.muted">
                            {formatWhen(lead.createdAt)}
                          </Table.Cell>
                        </Table.Row>
                        {isOpen ? (
                          <Table.Row {...dataTableExpandRowProps}>
                            <Table.Cell
                              colSpan={6}
                              p={3}
                              bg="surface.50"
                              borderBottom="none"
                            >
                              {expandPanel(lead)}
                            </Table.Cell>
                          </Table.Row>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </Table.Body>
              </DataTable>
            }
          />
        )}
      </DataTableCard>
        </Stack>
      )}
      </ListPageTableSection>
    </ListPageStack>
  );
}
