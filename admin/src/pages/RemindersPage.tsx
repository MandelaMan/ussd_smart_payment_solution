import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiPlus, FiRefreshCw } from "react-icons/fi";
import { useSearchParams } from "react-router-dom";
import { api, type ActionItem } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { hasPermission } from "../lib/rbac";

import { DateField } from "../components/ui/DateField";
import { SelectField } from "../components/ui/SelectField";
import { PaginationBar } from "../components/ui/PaginationBar";
import { PAGE_STACK_GAP, PageErrorBanner, PageHeader } from "../components/ui/pageLayout";
import { SettingsPanelSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { FILTER_CONTROL_HEIGHT } from "../theme";
import { CreateActionDialog } from "../components/reminders/CreateActionDialog";
import { ActionItemDialog } from "../components/reminders/ActionItemDialog";

function statusPalette(status: string) {
  switch (status) {
    case "in_progress":
      return "orange";
    case "completed":
      return "green";
    case "cancelled":
      return "gray";
    default:
      return "blue";
  }
}

function priorityPalette(priority: string) {
  switch (priority) {
    case "urgent":
      return "red";
    case "high":
      return "orange";
    case "low":
      return "gray";
    default:
      return "blue";
  }
}

function statusLabel(status: string) {
  if (status === "in_progress") return "In progress";
  return status.replace(/_/g, " ");
}

export function RemindersPage() {
  const { user } = useAuth();
  const canCreate = hasPermission(user, "action_items.create");
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("id") ? Number(searchParams.get("id")) : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ActionItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 40,
    total: 0,
    pages: 1,
  });
  const [status, setStatus] = useState("open_any");
  const [typeKey, setTypeKey] = useState("");
  const [scope, setScope] = useState("mine");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [types, setTypes] = useState<{ key: string; name: string }[]>([]);

  const load = useCallback(
    async (page = pagination.page) => {
      setLoading(true);
      setError("");
      try {
        const res = await api.listActionItems({
          status: status || undefined,
          typeKey: typeKey || undefined,
          mine: scope === "mine" ? "1" : undefined,
          overdue: scope === "overdue" ? "1" : undefined,
          q: q.trim() || undefined,
          from: from || undefined,
          to: to || undefined,
          page: String(page),
          limit: String(pagination.limit),
        });
        setRows(res.data || []);
        setPagination(res.pagination);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load reminders");
      } finally {
        setLoading(false);
      }
    },
    [status, typeKey, scope, q, from, to, pagination.limit, pagination.page]
  );

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on filter change
  }, [status, typeKey, scope, from, to]);

  useEffect(() => {
    void api
      .listActionTypes()
      .then((res) => setTypes((res.types || []).map((t) => ({ key: t.key, name: t.name }))))
      .catch(() => setTypes([]));
  }, []);

  function closeDetail() {
    const next = new URLSearchParams(searchParams);
    next.delete("id");
    setSearchParams(next, { replace: true });
  }

  function openDetail(id: number) {
    const next = new URLSearchParams(searchParams);
    next.set("id", String(id));
    setSearchParams(next, { replace: true });
  }

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <PageHeader
        title="Reminders"
        description="Action items for move-outs, collections, faults, and other follow-ups. Tagged users get a notification bubble."
        actions={
          <Flex gap={2} wrap="wrap">
            <Button size="sm" variant="outline" onClick={() => void load(pagination.page)}>
              <FiRefreshCw />
              Refresh
            </Button>
            {canCreate ? (
              <Button size="sm" colorPalette="brand" onClick={() => setCreateOpen(true)}>
                <FiPlus />
                New reminder
              </Button>
            ) : null}
          </Flex>
        }
      />

      <FilterToolbar>
        <FilterField label="Search" flex={FILTER_FLEX.search} minW={0}>
          <Input
            size="sm"
            h={FILTER_CONTROL_HEIGHT}
            value={q}
            placeholder="Customer, title, apartment"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(1);
            }}
          />
        </FilterField>
        <FilterField label="Scope" flex={FILTER_FLEX.compact} minW={0}>
          <SelectField
            size="sm"
            fieldProps={{
              value: scope,
              onChange: (e) => setScope(e.target.value),
            }}
          >
            <option value="mine">Assigned to me</option>
            <option value="all">All reminders</option>
            <option value="overdue">Overdue</option>
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
            <option value="open_any">Open</option>
            <option value="">All statuses</option>
            <option value="open">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </SelectField>
        </FilterField>
        <FilterField label="Type" flex={FILTER_FLEX.compact} minW={0}>
          <SelectField
            size="sm"
            fieldProps={{
              value: typeKey,
              onChange: (e) => setTypeKey(e.target.value),
            }}
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </SelectField>
        </FilterField>
        <FilterField label="From" flex={FILTER_FLEX.compact} minW={0}>
          <DateField size="sm" value={from} onChange={setFrom} onClear={() => setFrom("")} />
        </FilterField>
        <FilterField label="To" flex={FILTER_FLEX.compact} minW={0}>
          <DateField size="sm" value={to} onChange={setTo} onClear={() => setTo("")} />
        </FilterField>
      </FilterToolbar>

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      {loading && !rows.length ? (
        <SettingsPanelSkeleton />
      ) : rows.length === 0 ? (
        <Box borderWidth="1px" borderRadius="lg" p={8} textAlign="center">
          <Text color="fg.muted">No reminders match these filters.</Text>
        </Box>
      ) : (
        <Box borderWidth="1px" borderRadius="lg" overflowX="auto">
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Reminder</Table.ColumnHeader>
                <Table.ColumnHeader>Customer</Table.ColumnHeader>
                <Table.ColumnHeader>Due</Table.ColumnHeader>
                <Table.ColumnHeader>Tagged</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row
                  key={row.id}
                  cursor="pointer"
                  _hover={{ bg: "bg.muted" }}
                  onClick={() => openDetail(row.id)}
                >
                  <Table.Cell>
                    <Text fontWeight="medium">{row.title}</Text>
                    <Text fontSize="xs" color="fg.muted">
                      {row.typeName}
                      {row.stepCount
                        ? ` · ${row.stepsDone}/${row.stepCount} steps`
                        : ""}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {row.customerNumber || "—"}
                    {row.customerName ? (
                      <Text fontSize="xs" color="fg.muted">
                        {row.customerName}
                      </Text>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell>
                    <Flex align="center" gap={1}>
                      <Text>{row.dueDisplay || "—"}</Text>
                      {row.priority !== "normal" ? (
                        <Badge colorPalette={priorityPalette(row.priority)}>{row.priority}</Badge>
                      ) : null}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="sm" lineClamp={2}>
                      {row.assigneeNames || "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge colorPalette={statusPalette(row.status)}>{statusLabel(row.status)}</Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
          <Box px={3} py={2}>
            <PaginationBar
              pagination={pagination}
              onPageChange={(page) => void load(page)}
              itemLabel="reminders"
            />
          </Box>
        </Box>
      )}

      <CreateActionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void load(1)}
      />
      <ActionItemDialog
        itemId={openId && Number.isFinite(openId) ? openId : null}
        onClose={closeDetail}
        onChanged={(item) =>
          setRows((prev) => prev.map((r) => (r.id === item.id ? { ...r, ...item } : r)))
        }
      />
    </Stack>
  );
}
