import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Grid,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import {
  api,
  formatDate,
  type ActivityAuditItem,
  type ActivityChange,
  type AdminUser,
} from "../lib/api";
import { ADMIN_AUDIT_EVENT_TYPES } from "../lib/activityFeed";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { EmptyState, ListPageStack } from "../components/ui/pageLayout";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { SelectField } from "../components/ui/SelectField";
import { DateField } from "../components/ui/DateField";
import {
  DataTable,
  DataTableCard,
  DATA_TABLE_LEADING_COL_WIDTH,
  dataTableCellProps,
  dataTableTitleColumnHeaderProps,
  dataTableExpandRowProps,
} from "../components/ui/DataTable";
import { TextStatus } from "../components/ui/TextStatus";

const PAGE_SIZE = 30;

function eventLabel(value: string): string {
  if (value === "user_login") return "User signed in";
  if (value === "user_recovery_requested") return "Account recovery requested";
  return value
    .replace(/^customer_/, "")
    .replace(/^tisp_/, "TISP ")
    .replace(/^user_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function changesFromItem(item: ActivityAuditItem): ActivityChange[] {
  const raw = item.metadata?.changes;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is ActivityChange =>
      Boolean(c) &&
      typeof c === "object" &&
      typeof (c as ActivityChange).label === "string"
  );
}

function ChangesPanel({ item }: { item: ActivityAuditItem }) {
  const changes = changesFromItem(item);

  return (
    <Box bg="bg.subtle" borderRadius="md" p={{ base: 2, md: 4 }} w="full">
      <Grid
        templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }}
        gap={{ base: 2, md: 4 }}
        mb={{ base: 2.5, md: 4 }}
      >
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={0.5}>
            Action
          </Text>
          <Text fontSize="sm">{item.title}</Text>
        </Box>
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={0.5}>
            Customer
          </Text>
          <Text fontSize="sm">{item.customerRef || "—"}</Text>
        </Box>
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={0.5}>
            By
          </Text>
          <Text fontSize="sm">{item.actorName || "—"}</Text>
        </Box>
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={0.5}>
            When
          </Text>
          <Text fontSize="sm">{formatDate(item.createdAt)}</Text>
        </Box>
      </Grid>

      {item.message ? (
        <Text fontSize="sm" color="fg.muted" mb={{ base: 2.5, md: 4 }}>
          {item.message}
        </Text>
      ) : null}

      {changes.length > 0 ? (
        <Box
          border="1px solid"
          borderColor="border.muted"
          borderRadius="md"
          overflow="hidden"
          bg="bg.panel"
        >
          <Grid
            templateColumns="minmax(120px, 1.2fr) 1fr 1fr"
            gap={0}
            px={3}
            py={2}
            borderBottom="1px solid"
            borderColor="border.muted"
            bg="bg.subtle"
          >
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Field
            </Text>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Before
            </Text>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              After
            </Text>
          </Grid>
          {changes.map((change) => (
            <Grid
              key={`${change.field}-${change.label}`}
              templateColumns="minmax(120px, 1.2fr) 1fr 1fr"
              gap={2}
              px={3}
              py={2}
              borderBottom="1px solid"
              borderColor="border.muted"
              _last={{ borderBottom: "none" }}
            >
              <Text fontSize="sm" fontWeight="medium">
                {change.label}
              </Text>
              <Text fontSize="sm" color="fg.muted" wordBreak="break-word">
                {change.from ?? "—"}
              </Text>
              <Text fontSize="sm" fontWeight="semibold" wordBreak="break-word">
                {change.to ?? "—"}
              </Text>
            </Grid>
          ))}
        </Box>
      ) : (
        <Text fontSize="sm" color="fg.subtle">
          No field-level changes were recorded for this event
          {item.message ? " — see summary above." : "."}
        </Text>
      )}
    </Box>
  );
}

function ActivityFilters({
  actorUserId,
  eventType,
  date,
  users,
  onActorChange,
  onEventTypeChange,
  onDateChange,
  hideOnMobile,
}: {
  actorUserId: string;
  eventType: string;
  date: string;
  users: AdminUser[];
  onActorChange: (value: string) => void;
  onEventTypeChange: (value: string) => void;
  onDateChange: (value: string) => void;
  hideOnMobile?: boolean;
}) {
  return (
    <>
      <FilterField
        label="User"
        flex={FILTER_FLEX.standard}
        minW={0}
        hideOnMobile={hideOnMobile}
      >
        <SelectField
          size="sm"
          fieldProps={{
            value: actorUserId,
            onChange: (e) => onActorChange(e.target.value),
            borderRadius: "md",
          }}
        >
          <option value="">All users</option>
          {users.map((user) => (
            <option key={user.id} value={String(user.id)}>
              {user.name}
            </option>
          ))}
        </SelectField>
      </FilterField>
      <FilterField
        label="Action"
        flex={FILTER_FLEX.standard}
        minW={0}
        hideOnMobile={hideOnMobile}
      >
        <SelectField
          size="sm"
          fieldProps={{
            value: eventType,
            onChange: (e) => onEventTypeChange(e.target.value),
            borderRadius: "md",
          }}
        >
          <option value="">All actions</option>
          {ADMIN_AUDIT_EVENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {eventLabel(value)}
            </option>
          ))}
        </SelectField>
      </FilterField>
      <FilterField
        label="Date"
        flex={FILTER_FLEX.standard}
        minW={0}
        hideOnMobile={hideOnMobile}
      >
        <DateField
          size="sm"
          value={date}
          onChange={onDateChange}
          onClear={() => onDateChange("")}
          placeholder="Any date"
        />
      </FilterField>
    </>
  );
}

export function ActivityAuditPage() {
  const [actorUserId, setActorUserId] = useState("");
  const [eventType, setEventType] = useState("");
  const [date, setDate] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ActivityAuditItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [expanded, setExpanded] = useState<number | null>(null);

  const activeFilterCount = [actorUserId, eventType, date].filter(Boolean).length;

  function resetFilters() {
    setActorUserId("");
    setEventType("");
    setDate("");
    setPage(1);
    setExpanded(null);
  }

  function applyFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
    setExpanded(null);
  }

  useEffect(() => {
    let cancelled = false;
    api
      .listUsers()
      .then((res) => {
        if (!cancelled) {
          setUsers(
            (res.users || [])
              .slice()
              .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
          );
        }
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(PAGE_SIZE),
      };
      if (actorUserId) params.actorUserId = actorUserId;
      if (eventType) params.eventType = eventType;
      if (date) {
        params.dateFrom = date;
        params.dateTo = date;
      }
      const res = await api.getActivityAudit(params);
      setRows(res.data ?? []);
      setPagination(res.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, actorUserId, eventType, date]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ListPageStack>
      <ListPageTableSection
        chrome={
          <ListPageStickyChrome>
            <MobilePageChrome
              title="Activity"
              description="Admin audit of customer changes — who changed what"
              filterTitle="Filters"
              activeFilterCount={activeFilterCount}
              onClearFilters={resetFilters}
              filterContent={
                <ActivityFilters
                  actorUserId={actorUserId}
                  eventType={eventType}
                  date={date}
                  users={users}
                  onActorChange={(v) => applyFilter(setActorUserId, v)}
                  onEventTypeChange={(v) => applyFilter(setEventType, v)}
                  onDateChange={(v) => applyFilter(setDate, v)}
                />
              }
            />

            <FilterToolbar embedded>
              <ActivityFilters
                actorUserId={actorUserId}
                eventType={eventType}
                date={date}
                users={users}
                onActorChange={(v) => applyFilter(setActorUserId, v)}
                onEventTypeChange={(v) => applyFilter(setEventType, v)}
                onDateChange={(v) => applyFilter(setDate, v)}
                hideOnMobile
              />
            </FilterToolbar>
          </ListPageStickyChrome>
        }
      >
        {error ? (
          <Text color="red.600" fontSize="sm" mb={2}>
            {error}
          </Text>
        ) : null}

        <DataTableCard
          loading={loading && rows.length === 0}
          loadedCount={rows.length}
          pagination={pagination}
          onPageChange={setPage}
          itemLabel="events"
        >
          {loading && rows.length === 0 ? (
            <ResponsiveListViews
              fill
              mobile={<MobileCardListSkeleton fill variant="card" fieldCount={2} />}
              desktop={<DataTableLoadingSkeleton columns={6} fill />}
            />
          ) : (
            <ResponsiveListViews
              mobile={
                rows.length === 0 ? (
                  <EmptyState>No customer activity yet</EmptyState>
                ) : (
                  <MobileDataList
                    items={rows}
                    getKey={(row) => row.id}
                    expandedId={expanded}
                    renderCard={(row, isOpen) => {
                      const changeCount = changesFromItem(row).length;
                      return (
                        <MobileDataCard
                          title={row.title}
                          subtitle={row.message || undefined}
                          trailing={
                            <TextStatus
                              status={row.status === "failed" ? "Failed" : "Success"}
                            />
                          }
                          isOpen={isOpen}
                          onClick={() =>
                            setExpanded((prev) => (prev === row.id ? null : row.id))
                          }
                          fields={[
                            { label: "By", value: row.actorName ?? "—" },
                            { label: "Customer", value: row.customerRef ?? "—" },
                            { label: "When", value: formatDate(row.createdAt) },
                            {
                              label: "Changes",
                              value: changeCount ? `${changeCount} fields` : "Summary only",
                            },
                          ]}
                        />
                      );
                    }}
                    renderExpanded={(row) => <ChangesPanel item={row} />}
                  />
                )
              }
              desktop={
                <DataTable fixedLayout>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader
                        {...dataTableTitleColumnHeaderProps}
                        w={DATA_TABLE_LEADING_COL_WIDTH}
                      />
                      <Table.ColumnHeader {...dataTableTitleColumnHeaderProps}>
                        Action
                      </Table.ColumnHeader>
                      <Table.ColumnHeader {...dataTableTitleColumnHeaderProps}>
                        Customer
                      </Table.ColumnHeader>
                      <Table.ColumnHeader {...dataTableTitleColumnHeaderProps}>
                        By
                      </Table.ColumnHeader>
                      <Table.ColumnHeader {...dataTableTitleColumnHeaderProps}>
                        Changes
                      </Table.ColumnHeader>
                      <Table.ColumnHeader {...dataTableTitleColumnHeaderProps}>
                        When
                      </Table.ColumnHeader>
                      <Table.ColumnHeader {...dataTableTitleColumnHeaderProps}>
                        Status
                      </Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {rows.length === 0 ? (
                      <Table.Row>
                        <Table.Cell
                          colSpan={7}
                          {...dataTableCellProps}
                          borderBottom="none"
                        >
                          <Text py={6} textAlign="center" color="fg.muted" fontSize="sm">
                            No customer activity yet
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      rows.map((row) => {
                        const isOpen = expanded === row.id;
                        const changeCount = changesFromItem(row).length;
                        return (
                          <Fragment key={row.id}>
                            <Table.Row
                              cursor="pointer"
                              onClick={() =>
                                setExpanded((prev) => (prev === row.id ? null : row.id))
                              }
                              bg={isOpen ? "bg.subtle" : undefined}
                              _hover={{ bg: "bg.subtle" }}
                            >
                              <Table.Cell {...dataTableCellProps}>
                                {isOpen ? (
                                  <FiChevronDown size={14} />
                                ) : (
                                  <FiChevronRight size={14} />
                                )}
                              </Table.Cell>
                              <Table.Cell {...dataTableCellProps}>
                                <Text fontWeight="semibold" lineClamp={1}>
                                  {row.title}
                                </Text>
                              </Table.Cell>
                              <Table.Cell {...dataTableCellProps}>
                                {row.customerRef || "—"}
                              </Table.Cell>
                              <Table.Cell {...dataTableCellProps}>
                                {row.actorName || "—"}
                              </Table.Cell>
                              <Table.Cell {...dataTableCellProps}>
                                {changeCount > 0 ? (
                                  <Badge colorPalette="purple" variant="subtle" size="sm">
                                    {changeCount} field{changeCount === 1 ? "" : "s"}
                                  </Badge>
                                ) : (
                                  <Text fontSize="sm" color="fg.subtle">
                                    Summary
                                  </Text>
                                )}
                              </Table.Cell>
                              <Table.Cell {...dataTableCellProps}>
                                {formatDate(row.createdAt)}
                              </Table.Cell>
                              <Table.Cell {...dataTableCellProps}>
                                <TextStatus
                                  status={row.status === "failed" ? "Failed" : "Success"}
                                />
                              </Table.Cell>
                            </Table.Row>
                            {isOpen ? (
                              <Table.Row>
                                <Table.Cell colSpan={7} {...dataTableExpandRowProps}>
                                  <ChangesPanel item={row} />
                                </Table.Cell>
                              </Table.Row>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </Table.Body>
                </DataTable>
              }
            />
          )}
        </DataTableCard>
      </ListPageTableSection>
    </ListPageStack>
  );
}
