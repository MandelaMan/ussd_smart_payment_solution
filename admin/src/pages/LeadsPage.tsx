import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { mergeInfinitePage, useMobileViewport } from "../hooks/useMobileViewport";
import { useTableSort } from "../hooks/useTableSort";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
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
import { useAuth } from "../lib/auth";
import { canMutateCustomers } from "../lib/rbac";
import { toaster } from "../components/ui/toaster";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { EmptyState, PAGE_STACK_GAP } from "../components/ui/pageLayout";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { DisplayText } from "../components/ui/DisplayText";
import { SelectField } from "../components/ui/SelectField";
import {
  DataTable,
  DataTableCard,
  DataTableSortHeader,
  DATA_TABLE_LEADING_COL_WIDTH,
  dataTableCellProps,
  dataTableExpandRowProps,
} from "../components/ui/DataTable";
import { BRAND } from "../theme";

const PAGE_SIZE = 20;

type LeadSortKey = "createdAt" | "name" | "status" | "source";

function statusColor(status: string): string {
  switch (status) {
    case "new":
      return "orange";
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

function sourceLabel(source: string): string {
  if (source === "whatsapp") return "WhatsApp";
  if (source === "embed") return "Embed";
  return "Website";
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

function intakeUrls() {
  const host = window.location.hostname;
  const apiOrigin = import.meta.env.DEV
    ? `${window.location.protocol}//${host}:4000`
    : window.location.origin.replace(/\/admin\/?$/, "");
  return {
    formUrl: `${apiOrigin}/leads`,
    embedSnippet: `<div id="starlynx-lead-form"></div>\n<script src="${apiOrigin}/leads/embed.js" async></script>`,
    webhookUrl: `${apiOrigin}/api/public/whatsapp/webhook`,
  };
}

export function LeadsPage() {
  const { user } = useAuth();
  const canMutate = canMutateCustomers(user);
  const isMobile = useMobileViewport();
  const links = useMemo(() => intakeUrls(), []);
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

  const load = useCallback(async () => {
    const append = isMobile && page > 1;
    if (append) setLoadingMore(true);
    else setLoading(true);
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
        mergeInfinitePage(prev, listRes.leads, page, isMobile, (a) => a.id)
      );
      setPagination(listRes.pagination);
      if (statsRes) setStats(statsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, page, status, source, sortQuery.sortBy, sortQuery.sortDir, isMobile]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toaster.create({ type: "success", title: `${label} copied` });
    } catch {
      toaster.create({ type: "error", title: "Could not copy" });
    }
  }

  const expandPanel = (lead: Lead) => (
    <Box px={4} py={4} bg="bg.muted" borderTopWidth="1px" borderColor="border">
      {detailLoading ? (
        <Text fontSize="sm" color="fg.muted">
          Loading conversation…
        </Text>
      ) : (
        <Stack gap={4}>
          <Flex gap={3} flexWrap="wrap" align="end">
            <Field.Root maxW="220px">
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
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="converted">Converted</option>
                <option value="closed">Closed</option>
              </SelectField>
            </Field.Root>
            <Box flex="1" minW="180px">
              <Text fontSize="sm" color="fg.muted">
                {lead.interest || "No interest set"}
                {lead.buildingInterest ? ` · ${lead.buildingInterest}` : ""}
              </Text>
              {lead.message ? (
                <Text fontSize="sm" mt={1}>
                  {lead.message}
                </Text>
              ) : null}
            </Box>
          </Flex>

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

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <MobilePageChrome
        title="Leads"
        description="WhatsApp, website, and embed enquiries"
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Name, phone, email…"
        filterContent={
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
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="converted">Converted</option>
                <option value="closed">Closed</option>
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
                <option value="whatsapp">WhatsApp</option>
                <option value="web">Website</option>
                <option value="embed">Embed</option>
              </SelectField>
            </Field.Root>
          </Stack>
        }
        activeFilterCount={(status ? 1 : 0) + (source ? 1 : 0)}
        onClearFilters={() => {
          setStatus("");
          setSource("");
          setPage(1);
        }}
        sortOptions={[
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
        ]}
      />

      {stats ? (
        <Flex gap={3} flexWrap="wrap">
          {[
            { label: "Total", value: stats.total },
            { label: "New", value: stats.byStatus.new },
            { label: "WhatsApp", value: stats.bySource.whatsapp },
            { label: "Web", value: stats.bySource.web },
            { label: "Embed", value: stats.bySource.embed },
          ].map((card) => (
            <Box
              key={card.label}
              px={4}
              py={3}
              borderRadius="md"
              borderWidth="1px"
              borderColor="border"
              bg="bg.panel"
              minW="110px"
            >
              <Text fontSize="xs" color="fg.muted">
                {card.label}
              </Text>
              <Text fontWeight="700" fontSize="xl">
                {card.value}
              </Text>
            </Box>
          ))}
        </Flex>
      ) : null}

      <Box
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        bg="bg.panel"
        px={4}
        py={3}
      >
        <Text fontSize="sm" fontWeight="600" mb={2}>
          Intake links
        </Text>
        <Stack gap={2}>
          <Flex gap={2} align="center" flexWrap="wrap">
            <Text fontSize="sm" color="fg.muted">
              Public form:
            </Text>
            <Box
              asChild
              color="brand.600"
              fontSize="sm"
            >
              <a href={links.formUrl} target="_blank" rel="noreferrer">
                {links.formUrl}
              </a>
            </Box>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void copyText("Form link", links.formUrl)}
            >
              <FiCopy />
            </Button>
          </Flex>
          <Flex gap={2} align="start">
            <Text
              fontSize="xs"
              color="fg.muted"
              whiteSpace="pre-wrap"
              fontFamily="mono"
              flex="1"
            >
              {links.embedSnippet}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void copyText("Embed snippet", links.embedSnippet)}
            >
              <FiCopy />
            </Button>
          </Flex>
          <Text fontSize="xs" color="fg.muted">
            WhatsApp webhook: {links.webhookUrl}
          </Text>
        </Stack>
      </Box>

      <FilterToolbar>
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
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="qualified">Qualified</option>
            <option value="converted">Converted</option>
            <option value="closed">Closed</option>
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
            <option value="whatsapp">WhatsApp</option>
            <option value="web">Website</option>
            <option value="embed">Embed</option>
          </SelectField>
        </FilterField>
      </FilterToolbar>

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
                    subtitle={`${sourceLabel(lead.source)} · ${formatWhen(lead.createdAt)}`}
                    trailing={
                      <Badge colorPalette={statusColor(lead.status)} variant="subtle">
                        {lead.status}
                      </Badge>
                    }
                    isOpen={isOpen}
                    onClick={() => void openLead(lead.id)}
                    variant="card"
                  />
                )}
                renderExpanded={(lead) => expandPanel(lead)}
              />
            }
            desktop={
              <DataTable>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader w={DATA_TABLE_LEADING_COL_WIDTH} />
                    <DataTableSortHeader
                      label="Name"
                      column="name"
                      sorts={sorts}
                      onSort={handleSort}
                      defaultDir="asc"
                    />
                    <Table.ColumnHeader>Contact</Table.ColumnHeader>
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
                  {leads.map((lead) => (
                    <Fragment key={lead.id}>
                      <Table.Row
                        {...dataTableExpandRowProps}
                        cursor="pointer"
                        onClick={() => void openLead(lead.id)}
                      >
                        <Table.Cell {...dataTableCellProps}>
                          {expanded === lead.id ? <FiChevronDown /> : <FiChevronRight />}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps}>
                          <DisplayText value={lead.name || "—"} />
                          {lead.interest ? (
                            <Text fontSize="xs" color="fg.muted">
                              {lead.interest}
                            </Text>
                          ) : null}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps}>
                          <Text fontSize="sm">{lead.phone || "—"}</Text>
                          {lead.email ? (
                            <Text fontSize="xs" color="fg.muted">
                              {lead.email}
                            </Text>
                          ) : null}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps}>
                          {sourceLabel(lead.source)}
                          {lead.messageCount ? (
                            <Text fontSize="xs" color="fg.muted">
                              {lead.messageCount} msgs
                            </Text>
                          ) : null}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps}>
                          <Badge colorPalette={statusColor(lead.status)}>
                            {lead.status}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps}>
                          {formatWhen(lead.createdAt)}
                        </Table.Cell>
                      </Table.Row>
                      {expanded === lead.id ? (
                        <Table.Row>
                          <Table.Cell colSpan={6} p={0}>
                            {expandPanel(lead)}
                          </Table.Cell>
                        </Table.Row>
                      ) : null}
                    </Fragment>
                  ))}
                </Table.Body>
              </DataTable>
            }
          />
        )}
      </DataTableCard>
    </Stack>
  );
}
