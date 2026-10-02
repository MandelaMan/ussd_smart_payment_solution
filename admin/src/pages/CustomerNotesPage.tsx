import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Flex, Input, Stack, Text } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { api, formatDate, type Building, type Customer } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { hasPermission } from "../lib/rbac";
import {
  displayCustomerStatus,
  SUBSCRIPTION_STATUS_FILTER_OPTIONS,
} from "../lib/customerStatus";
import { customerDisplayTitle, customerUnitLine } from "../lib/premise";
import { formatTitleCase } from "../lib/formatText";
import { getCachedBuildings } from "../lib/sharedLookups";
import { beginListLoad, endListLoad } from "../lib/listLoad";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { SelectField } from "../components/ui/SelectField";
import { PaginationBar } from "../components/ui/PaginationBar";
import { PageErrorBanner } from "../components/ui/pageLayout";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { FILTER_CONTROL_HEIGHT } from "../theme";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { TextStatus } from "../components/ui/TextStatus";
import { SettingsPanelSkeleton } from "../components/PageSkeletons";

function noteExcerpt(note: string | null | undefined) {
  return String(note || "").replace(/\s+/g, " ").trim();
}

export function CustomerNotesPage() {
  const { user } = useAuth();
  const canViewReminders = hasPermission(user, "action_items.view");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Customer[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    pages: 1,
  });
  const [q, setQ] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [status, setStatus] = useState("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const debouncedQ = useDebouncedValue(q, 300);

  const load = useCallback(
    async (page = 1) => {
      beginListLoad({
        hasRows: rowsRef.current.length > 0,
        setLoading,
      });
      setError("");
      try {
        const res = await api.listCustomerNotes({
          search: debouncedQ.trim() || undefined,
          buildingId: buildingId || undefined,
          subscriptionStatus: status || undefined,
          page: String(page),
          limit: String(pagination.limit),
        });
        setRows(res.data || []);
        setPagination(res.pagination);
        setOpenId(null);
      } catch (e) {
        setRows([]);
        setError(e instanceof Error ? e.message : "Failed to load notes");
      } finally {
        endListLoad({ setLoading });
      }
    },
    [debouncedQ, buildingId, status, pagination.limit]
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void getCachedBuildings()
      .then((res) => {
        if (!cancelled) setBuildings(res.buildings || []);
      })
      .catch(() => {
        if (!cancelled) setBuildings([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeFilterCount = Number(Boolean(buildingId)) + Number(Boolean(status));

  const filterFields = (
    <>
      <FilterField label="Building" flex={FILTER_FLEX.wide} minW={0}>
        <SelectField
          size="sm"
          fieldProps={{
            value: buildingId,
            onChange: (e) => setBuildingId(e.target.value),
          }}
        >
          <option value="">All buildings</option>
          {buildings.map((building) => (
            <option key={building.id} value={String(building.id)}>
              {building.name}
            </option>
          ))}
        </SelectField>
      </FilterField>
      <FilterField label="Status" flex={FILTER_FLEX.compact} minW={0}>
        <SelectField
          size="sm"
          fieldProps={{
            value: status,
            onChange: (e) => setStatus(e.target.value),
          }}
        >
          <option value="">All statuses</option>
          {SUBSCRIPTION_STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </FilterField>
    </>
  );

  return (
    <Stack gap={3} minW={0}>
      <MobilePageChrome
        title="Notes"
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Customer, number, or note"
        filterContent={
          <Stack gap={3}>
            <FilterField label="Building">
              <SelectField
                size="sm"
                fieldProps={{
                  value: buildingId,
                  onChange: (e) => setBuildingId(e.target.value),
                }}
              >
                <option value="">All buildings</option>
                {buildings.map((building) => (
                  <option key={building.id} value={String(building.id)}>
                    {building.name}
                  </option>
                ))}
              </SelectField>
            </FilterField>
            <FilterField label="Status">
              <SelectField
                size="sm"
                fieldProps={{
                  value: status,
                  onChange: (e) => setStatus(e.target.value),
                }}
              >
                <option value="">All statuses</option>
                {SUBSCRIPTION_STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </FilterField>
          </Stack>
        }
        activeFilterCount={activeFilterCount}
        onClearFilters={() => {
          setBuildingId("");
          setStatus("");
        }}
        filterTitle="Filter notes"
      />

      <FilterToolbar>
        <FilterField label="Search" flex={FILTER_FLEX.search} minW={0}>
          <Input
            size="sm"
            h={FILTER_CONTROL_HEIGHT}
            value={q}
            placeholder="Customer, number, or note"
            onChange={(e) => setQ(e.target.value)}
          />
        </FilterField>
        {filterFields}
      </FilterToolbar>

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      {loading && !rows.length ? (
        <SettingsPanelSkeleton />
      ) : rows.length === 0 ? (
        <Box borderWidth="1px" borderRadius="lg" px={4} py={8} textAlign="center">
          <Text color="fg.muted" fontSize="sm">
            No customers with notes match this search.
          </Text>
        </Box>
      ) : (
        <Stack gap={2}>
          {rows.map((row) => {
            const open = openId === row.id;
            const title = customerDisplayTitle(row) || row.fullName || "Customer";
            const place = [formatTitleCase(row.buildingName), customerUnitLine(row)]
              .filter(Boolean)
              .join(" · ");
            return (
              <Box
                key={row.id}
                borderWidth="1px"
                borderColor={open ? "brand.300" : "border"}
                borderRadius="lg"
                bg="bg.panel"
                overflow="hidden"
              >
                <Box
                  as="button"
                  w="full"
                  textAlign="left"
                  px={{ base: 3, md: 4 }}
                  py={3}
                  cursor="pointer"
                  bg="transparent"
                  border="none"
                  font="inherit"
                  color="inherit"
                  _hover={{ bg: "bg.subtle" }}
                  onClick={() => setOpenId((current) => (current === row.id ? null : row.id))}
                >
                  <Flex align="start" justify="space-between" gap={3}>
                    <Box minW={0}>
                      <Text fontWeight="semibold" fontSize="sm" truncate>
                        {title}
                      </Text>
                      <Text fontSize="xs" color="fg.muted" truncate>
                        {place}
                        {row.customerNumber ? ` · ${row.customerNumber}` : ""}
                      </Text>
                    </Box>
                    <TextStatus status={displayCustomerStatus(row)} />
                  </Flex>
                  <Text
                    mt={2}
                    fontSize="sm"
                    color="fg"
                    lineHeight="1.5"
                    whiteSpace={open ? "pre-wrap" : "nowrap"}
                    overflow="hidden"
                    textOverflow="ellipsis"
                  >
                    {open ? row.staffNotes : noteExcerpt(row.staffNotes)}
                  </Text>
                  <Flex mt={1.5} align="center" gap={3} flexWrap="wrap">
                    {row.staffNotesUpdatedAt ? (
                      <Text fontSize="xs" color="fg.muted">
                        Updated {formatDate(row.staffNotesUpdatedAt)}
                      </Text>
                    ) : null}
                    {row.noteFollowUp ? (
                      <Text fontSize="xs" color="brand.700" fontWeight="medium">
                        Follow-up {row.noteFollowUp.status === "in_progress" ? "in progress" : "open"}
                      </Text>
                    ) : null}
                  </Flex>
                </Box>
                {open ? (
                  <Flex
                    px={{ base: 3, md: 4 }}
                    py={2}
                    gap={4}
                    borderTopWidth="1px"
                    borderColor="border"
                    bg="bg.subtle"
                  >
                    <RouterLink
                      to={`/customers?q=${encodeURIComponent(row.customerNumber || title)}&customer=${row.id}${
                        row.status === "cancelled" ? "&showCancelled=1" : ""
                      }`}
                    >
                      <Text fontSize="sm" color="brand.700" fontWeight="medium">
                        Open customer
                      </Text>
                    </RouterLink>
                    {row.noteFollowUp && canViewReminders ? (
                      <RouterLink to={`/reminders?id=${row.noteFollowUp.id}`}>
                        <Text fontSize="sm" color="brand.700" fontWeight="medium">
                          Open reminder
                        </Text>
                      </RouterLink>
                    ) : null}
                  </Flex>
                ) : null}
              </Box>
            );
          })}
          <PaginationBar
            pagination={pagination}
            onPageChange={(page) => void load(page)}
            itemLabel="notes"
          />
        </Stack>
      )}
    </Stack>
  );
}
