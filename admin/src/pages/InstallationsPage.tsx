import { useCallback, useEffect, useState } from "react";
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
} from "@chakra-ui/react";
import { FiRefreshCw } from "react-icons/fi";
import {
  api,
  type Installation,
  type InstallationTechnician,
} from "../lib/api";
import { useAuth } from "../lib/authContext";
import { hasPermission } from "../lib/rbac";
import { toaster } from "../components/ui/toaster";
import { AppDialog } from "../components/ui/AppDialog";
import { DateField } from "../components/ui/DateField";
import {
  defaultInstallationDate,
  DEFAULT_INSTALLATION_TIME,
} from "../components/installations/InstallationScheduleFields";
import { SelectField } from "../components/ui/SelectField";
import { PaginationBar } from "../components/ui/PaginationBar";
import { PAGE_STACK_GAP, PageErrorBanner, PageHeader } from "../components/ui/pageLayout";
import { SettingsPanelSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { FILTER_CONTROL_HEIGHT } from "../theme";

function statusPalette(status: string) {
  switch (status) {
    case "assigned":
      return "blue";
    case "in_progress":
      return "orange";
    case "completed":
      return "green";
    case "cancelled":
      return "gray";
    default:
      return "yellow";
  }
}

function kindLabel(kind: string) {
  return kind === "apartment_switch" ? "Apartment move" : "Onboarding";
}

function statusLabel(status: string) {
  if (status === "in_progress") return "In progress";
  return status.replace(/_/g, " ");
}

export function InstallationsPage() {
  const { user } = useAuth();
  const canAssign = hasPermission(user, "installations.assign");
  const canEdit = hasPermission(user, "installations.edit");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Installation[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 40,
    total: 0,
    pages: 1,
  });
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [technicians, setTechnicians] = useState<InstallationTechnician[]>([]);
  const [assignTarget, setAssignTarget] = useState<Installation | null>(null);
  const [assignTechId, setAssignTechId] = useState("");
  const [scheduleTarget, setScheduleTarget] = useState<Installation | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (page = pagination.page) => {
      setLoading(true);
      setError("");
      try {
        const res = await api.listInstallations({
          status: status || undefined,
          kind: kind || undefined,
          q: q.trim() || undefined,
          from: from || undefined,
          to: to || undefined,
          page: String(page),
          limit: String(pagination.limit),
        });
        setRows(res.data || []);
        setPagination(res.pagination);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load installations");
      } finally {
        setLoading(false);
      }
    },
    [status, kind, q, from, to, pagination.limit, pagination.page]
  );

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on filter change
  }, [status, kind, from, to]);

  useEffect(() => {
    void api
      .listInstallationTechnicians()
      .then((res) => setTechnicians(res.technicians || []))
      .catch(() => setTechnicians([]));
  }, []);

  async function setStatusFor(row: Installation, next: Installation["status"]) {
    setSaving(true);
    try {
      const res = await api.updateInstallation(row.id, { status: next });
      setRows((prev) => prev.map((r) => (r.id === row.id ? res.installation : r)));
      toaster.create({ title: `Marked ${statusLabel(next)}`, type: "success" });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Update failed",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function submitAssign() {
    if (!assignTarget) return;
    setSaving(true);
    try {
      const res = await api.assignInstallation(
        assignTarget.id,
        assignTechId ? Number(assignTechId) : null
      );
      setRows((prev) =>
        prev.map((r) => (r.id === assignTarget.id ? res.installation : r))
      );
      toaster.create({
        title: res.installation.technicianName
          ? `Assigned to ${res.installation.technicianName}`
          : "Left unassigned",
        type: "success",
      });
      setAssignTarget(null);
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Assign failed",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function submitSchedule() {
    if (!scheduleTarget || !scheduleDate || !scheduleTime) {
      toaster.create({ title: "Enter a date and time", type: "error" });
      return;
    }
    setSaving(true);
    try {
      const time = /^\d{2}:\d{2}$/.test(scheduleTime)
        ? `${scheduleTime}:00`
        : scheduleTime;
      const res = await api.updateInstallation(scheduleTarget.id, {
        scheduledAt: `${scheduleDate} ${time}`,
      });
      setRows((prev) =>
        prev.map((r) => (r.id === scheduleTarget.id ? res.installation : r))
      );
      toaster.create({
        title: `Scheduled ${res.installation.displayDateTime}`,
        type: "success",
      });
      setScheduleTarget(null);
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Schedule failed",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <PageHeader
        title="Installations"
        description="Field jobs created when a customer is onboarded or moves apartment."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load(pagination.page)}
          >
            <FiRefreshCw />
            Refresh
          </Button>
        }
      />

      <FilterToolbar>
        <FilterField label="Search" flex={FILTER_FLEX.search} minW={0}>
          <Input
            size="sm"
            h={FILTER_CONTROL_HEIGHT}
            value={q}
            placeholder="Customer, apartment, building"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(1);
            }}
          />
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
            <option value="unscheduled">No date provided</option>
            <option value="unassigned">Unassigned</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </SelectField>
        </FilterField>
        <FilterField label="Type" flex={FILTER_FLEX.compact} minW={0}>
          <SelectField
            size="sm"
            fieldProps={{
              value: kind,
              onChange: (e) => setKind(e.target.value),
            }}
          >
            <option value="">All types</option>
            <option value="onboarding">Onboarding</option>
            <option value="apartment_switch">Apartment move</option>
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
          <Text color="fg.muted">No installations match these filters.</Text>
        </Box>
      ) : (
        <Box borderWidth="1px" borderRadius="lg" overflowX="auto">
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>When</Table.ColumnHeader>
                <Table.ColumnHeader>Customer</Table.ColumnHeader>
                <Table.ColumnHeader>Location</Table.ColumnHeader>
                <Table.ColumnHeader>Type</Table.ColumnHeader>
                <Table.ColumnHeader>Technician</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.id}>
                  <Table.Cell>
                    {row.needsSchedule ? (
                      <>
                        <Text fontWeight="medium" color="orange.700">
                          No date provided
                        </Text>
                        <Text fontSize="xs" color="fg.muted">
                          Created without a visit slot
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text fontWeight="medium">{row.displayDate}</Text>
                        <Text fontSize="xs" color="fg.muted">
                          {row.displayTime}
                        </Text>
                      </>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontWeight="medium">{row.customerNumber}</Text>
                    <Text fontSize="xs" color="fg.muted">
                      {row.customerName}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text>{row.buildingName || "—"}</Text>
                    <Text fontSize="xs" color="fg.muted">
                      Apt {row.apartmentNumber || "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>{kindLabel(row.kind)}</Table.Cell>
                  <Table.Cell>{row.technicianName || "Unassigned"}</Table.Cell>
                  <Table.Cell>
                    <Badge colorPalette={statusPalette(row.status)} variant="subtle">
                      {statusLabel(row.status)}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Flex gap={1} justify="flex-end" wrap="wrap">
                      {canEdit && row.needsSchedule ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            setScheduleTarget(row);
                            setScheduleDate(defaultInstallationDate());
                            setScheduleTime(DEFAULT_INSTALLATION_TIME);
                          }}
                        >
                          Set date
                        </Button>
                      ) : null}
                      {canAssign &&
                      row.status !== "completed" &&
                      row.status !== "cancelled" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            setAssignTarget(row);
                            setAssignTechId(
                              row.technicianId ? String(row.technicianId) : ""
                            );
                          }}
                        >
                          Assign
                        </Button>
                      ) : null}
                      {canEdit && row.status === "assigned" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={saving}
                          onClick={() => void setStatusFor(row, "in_progress")}
                        >
                          Start
                        </Button>
                      ) : null}
                      {canEdit &&
                      (row.status === "assigned" || row.status === "in_progress") ? (
                        <Button
                          size="xs"
                          colorPalette="green"
                          variant="outline"
                          disabled={saving}
                          onClick={() => void setStatusFor(row, "completed")}
                        >
                          Complete
                        </Button>
                      ) : null}
                      {canEdit &&
                      row.status !== "completed" &&
                      row.status !== "cancelled" ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={saving}
                          onClick={() => void setStatusFor(row, "cancelled")}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
          <Box px={3} py={2}>
            <PaginationBar
              pagination={pagination}
              onPageChange={(page) => void load(page)}
              itemLabel="installations"
            />
          </Box>
        </Box>
      )}

      <AppDialog
        open={Boolean(assignTarget)}
        onOpenChange={(d) => !d.open && setAssignTarget(null)}
      >
        <Box px={5} py={4}>
          <Text fontWeight="semibold" mb={1}>
            Assign technician
          </Text>
          <Text fontSize="sm" color="fg.muted" mb={4}>
            {assignTarget
              ? `${assignTarget.customerNumber} · ${assignTarget.displayDateTime}`
              : ""}
          </Text>
          <Field.Root>
            <Field.Label>Technician</Field.Label>
            <SelectField
              fieldProps={{
                value: assignTechId,
                onChange: (e) => setAssignTechId(e.target.value),
              }}
            >
              <option value="">Unassigned — wait for admin</option>
              {technicians.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                  {t.jobTitle ? ` (${t.jobTitle})` : ""}
                </option>
              ))}
            </SelectField>
            {!technicians.length ? (
              <Text fontSize="xs" color="fg.muted" mt={2}>
                No users in the Technician group yet. Add staff to that group in
                Settings → Users, or pick Assign later when booking a slot.
              </Text>
            ) : null}
          </Field.Root>
          <Flex justify="flex-end" gap={2} mt={5}>
            <Button variant="ghost" onClick={() => setAssignTarget(null)}>
              Cancel
            </Button>
            <Button colorPalette="brand" loading={saving} onClick={() => void submitAssign()}>
              Save
            </Button>
          </Flex>
        </Box>
      </AppDialog>

      <AppDialog
        open={Boolean(scheduleTarget)}
        onOpenChange={(d) => !d.open && setScheduleTarget(null)}
      >
        <Box px={5} py={4}>
          <Text fontWeight="semibold" mb={1}>
            Set installation date
          </Text>
          <Text fontSize="sm" color="fg.muted" mb={4}>
            {scheduleTarget
              ? `${scheduleTarget.customerNumber} · ${scheduleTarget.customerName}`
              : ""}
          </Text>
          <Stack gap={3}>
            <Field.Root required>
              <Field.Label>Date</Field.Label>
              <DateField
                size="md"
                value={scheduleDate}
                onChange={setScheduleDate}
                min={new Date().toISOString().slice(0, 10)}
              />
            </Field.Root>
            <Field.Root required>
              <Field.Label>Time</Field.Label>
              <Input
                type="time"
                w="full"
                h="40px"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
              />
            </Field.Root>
          </Stack>
          <Flex justify="flex-end" gap={2} mt={5}>
            <Button variant="ghost" onClick={() => setScheduleTarget(null)}>
              Cancel
            </Button>
            <Button
              colorPalette="brand"
              loading={saving}
              onClick={() => void submitSchedule()}
            >
              Save
            </Button>
          </Flex>
        </Box>
      </AppDialog>
    </Stack>
  );
}
