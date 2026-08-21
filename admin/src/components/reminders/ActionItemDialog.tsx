import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Input,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import {
  api,
  formatDate,
  type ActionItem,
  type ActionItemEvent,
  type ActionItemStep,
} from "../../lib/api";
import { AppDialog } from "../ui/AppDialog";
import { RowCheckbox } from "../ui/RowCheckbox";
import { toaster } from "../ui/toaster";
import { useAuth } from "../../lib/authContext";
import { hasPermission } from "../../lib/rbac";

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

function actorLine(name: string | null | undefined, at: string | null | undefined) {
  return [name || null, at ? formatDate(at) : null].filter(Boolean).join(" · ");
}

function stepAttribution(step: ActionItemStep) {
  if (step.status !== "done" && step.status !== "skipped") return "";
  return actorLine(step.completedByName, step.completedAt);
}

function pendingChecklistCount(item: ActionItem) {
  return (item.steps || []).filter((step) => step.status === "pending").length;
}

function ActionItemActivity({ history }: { history: ActionItemEvent[] }) {
  return (
    <Box pt={3} borderTopWidth="1px" borderColor="border">
      <Text fontSize="sm" fontWeight="medium" mb={1.5}>
        Activity
      </Text>
      {history.length === 0 ? (
        <Text fontSize="xs" color="fg.muted">
          No updates recorded yet
        </Text>
      ) : (
        <Stack gap={0} maxH="240px" overflowY="auto">
          {history.map((event) => {
            const whoWhen = actorLine(event.actorName, event.createdAt);
            return (
              <Box
                key={String(event.id)}
                py={1.5}
                borderBottomWidth="1px"
                borderColor="border.muted"
                _last={{ borderBottomWidth: 0 }}
              >
                <Text fontSize="sm" lineHeight="1.35">
                  {event.message}
                </Text>
                {event.detail ? (
                  <Text fontSize="xs" color="fg.muted" lineHeight="1.35" whiteSpace="pre-wrap">
                    {event.detail}
                  </Text>
                ) : null}
                {whoWhen ? (
                  <Text fontSize="xs" color="fg.muted" mt={0.5}>
                    {whoWhen}
                  </Text>
                ) : null}
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

type Props = {
  itemId: number | null;
  onClose: () => void;
  onChanged?: (item: ActionItem) => void;
};

export function ActionItemDialog({ itemId, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const canEdit = hasPermission(user, "action_items.edit");
  const canAssign = hasPermission(user, "action_items.assign") || canEdit;
  const [item, setItem] = useState<ActionItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [newStep, setNewStep] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: number; name: string; email: string }[]>([]);
  const pendingSteps = item ? pendingChecklistCount(item) : 0;

  useEffect(() => {
    if (!itemId) {
      setItem(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api
      .getActionItem(itemId)
      .then((res) => {
        if (cancelled) return;
        setItem(res.actionItem);
        setNotes(res.actionItem.notes || res.actionItem.description || "");
        setAssigneeIds((res.actionItem.assignees || []).map((a) => a.id));
      })
      .catch((e) => {
        if (!cancelled) {
          toaster.create({
            title: e instanceof Error ? e.message : "Failed to load reminder",
            type: "error",
          });
          onClose();
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    if (!itemId || !canAssign) return;
    void api
      .listActionAssignees()
      .then((res) => setAllUsers(res.users || []))
      .catch(() => setAllUsers([]));
  }, [itemId, canAssign]);

  function apply(next: ActionItem) {
    setItem(next);
    setAssigneeIds((next.assignees || []).map((a) => a.id));
    onChanged?.(next);
  }

  async function setStatus(status: ActionItem["status"]) {
    if (!item) return;
    setSaving(true);
    try {
      const res = await api.updateActionItem(item.id, { status });
      apply(res.actionItem);
      toaster.create({ title: `Marked ${statusLabel(status)}`, type: "success" });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Update failed",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    if (!item) return;
    setSaving(true);
    try {
      const res = await api.updateActionItem(item.id, { notes });
      apply(res.actionItem);
      toaster.create({ title: "Notes saved", type: "success" });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Save failed",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleStep(step: ActionItemStep) {
    if (!item || !canEdit) return;
    const next = step.status === "done" ? "pending" : "done";
    setSaving(true);
    try {
      const res = await api.updateActionStep(item.id, step.id, { status: next });
      apply(res.actionItem);
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Could not update step",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function addStep() {
    if (!item || !newStep.trim()) return;
    setSaving(true);
    try {
      const res = await api.addActionStep(item.id, { label: newStep.trim() });
      apply(res.actionItem);
      setNewStep("");
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Could not add step",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveAssignees() {
    if (!item) return;
    setSaving(true);
    try {
      const res = await api.assignActionItem(item.id, assigneeIds);
      apply(res.actionItem);
      toaster.create({ title: "Tagged users updated", type: "success" });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Could not update tags",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppDialog open={Boolean(itemId)} onOpenChange={(d) => !d.open && onClose()} maxW="lg">
      <Box px={5} py={4} overflowY="auto">
        {loading && !item ? (
          <Text color="fg.muted">Loading…</Text>
        ) : item ? (
          <>
            <Flex justify="space-between" align="start" gap={3} pr={8} mb={3}>
              <Box minW={0}>
                <Text fontWeight="semibold">{item.title}</Text>
                <Text fontSize="sm" color="fg.muted">
                  {item.typeName}
                  {item.dueDisplay ? ` · due ${item.dueDisplay}` : ""}
                </Text>
                {item.createdByName || item.createdAt ? (
                  <Text fontSize="xs" color="fg.muted" mt={0.5}>
                    Created{item.createdByName ? ` by ${item.createdByName}` : ""}
                    {item.createdAt ? ` · ${formatDate(item.createdAt)}` : ""}
                  </Text>
                ) : null}
              </Box>
              <Flex gap={1} flexShrink={0}>
                <Badge colorPalette={statusPalette(item.status)}>{statusLabel(item.status)}</Badge>
                <Badge colorPalette={priorityPalette(item.priority)}>{item.priority}</Badge>
              </Flex>
            </Flex>

            {item.customerId ? (
              <Text fontSize="sm" mb={3}>
                <RouterLink to={`/customers?search=${encodeURIComponent(item.customerNumber)}`} style={{ color: "var(--chakra-colors-blue-600)" }}>
                  {item.customerNumber}
                </RouterLink>
                {item.customerName ? ` · ${item.customerName}` : ""}
                {item.buildingName
                  ? ` · ${item.buildingName}${item.apartmentNumber ? ` ${item.apartmentNumber}` : ""}`
                  : ""}
              </Text>
            ) : null}

            {item.description ? (
              <Text fontSize="sm" color="fg" mb={3} whiteSpace="pre-wrap">
                {item.description}
              </Text>
            ) : null}

            <Text fontSize="sm" fontWeight="medium" mb={1.5}>
              Checklist ({item.stepsDone}/{item.stepCount || item.steps?.length || 0})
            </Text>
            <Stack gap={1} mb={3}>
              {(item.steps || []).map((step) => {
                const attribution = stepAttribution(step);
                return (
                  <Flex key={step.id} align="flex-start" gap={2} minH="28px">
                    <Box pt="2px">
                      <RowCheckbox
                        checked={step.status === "done"}
                        disabled={!canEdit || saving}
                        onChange={() => void toggleStep(step)}
                        aria-label={step.label}
                      />
                    </Box>
                    <Box minW={0}>
                      <Text
                        fontSize="sm"
                        lineHeight="1.3"
                        title={step.description || undefined}
                        textDecoration={step.status === "done" ? "line-through" : undefined}
                        color={step.status === "skipped" || step.status === "done" ? "fg.muted" : "fg"}
                      >
                        {step.label}
                      </Text>
                      {attribution ? (
                        <Text fontSize="xs" color="fg.muted" lineHeight="1.3">
                          {attribution}
                        </Text>
                      ) : null}
                    </Box>
                  </Flex>
                );
              })}
            </Stack>

            {canEdit ? (
              <Flex gap={2} mb={4}>
                <Input
                  size="sm"
                  value={newStep}
                  placeholder="Add a checklist item"
                  onChange={(e) => setNewStep(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addStep();
                    }
                  }}
                />
                <Button size="sm" variant="outline" loading={saving} onClick={() => void addStep()}>
                  Add
                </Button>
              </Flex>
            ) : null}

            {canAssign ? (
              <Box mb={4}>
                <Flex align="center" justify="space-between" gap={2} mb={1.5}>
                  <Text fontSize="sm" fontWeight="medium">
                    Tagged users
                  </Text>
                  <Button size="xs" variant="outline" loading={saving} onClick={() => void saveAssignees()}>
                    Save tags
                  </Button>
                </Flex>
                <Flex wrap="wrap" gap={1.5}>
                  {allUsers.map((u) => {
                    const selected = assigneeIds.includes(u.id);
                    return (
                      <Box
                        key={u.id}
                        as="button"
                        aria-pressed={selected}
                        aria-label={`Tag ${u.name}`}
                        title={u.email}
                        onClick={() =>
                          setAssigneeIds((prev) =>
                            prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]
                          )
                        }
                        h="28px"
                        px={2.5}
                        display="inline-flex"
                        alignItems="center"
                        borderRadius="full"
                        borderWidth="1px"
                        borderColor={selected ? "brand.500" : "border"}
                        bg={selected ? "brand.50" : "bg.panel"}
                        color={selected ? "brand.800" : "fg.muted"}
                        fontSize="xs"
                        fontWeight={selected ? "medium" : "normal"}
                        lineHeight="1"
                        cursor="pointer"
                        _hover={{
                          borderColor: "brand.400",
                          bg: selected ? "brand.100" : "bg.muted",
                          color: selected ? "brand.800" : "fg",
                        }}
                      >
                        {u.name}
                      </Box>
                    );
                  })}
                </Flex>
              </Box>
            ) : item.assigneeNames ? (
              <Flex wrap="wrap" gap={1.5} mb={4}>
                {item.assigneeNames.split(", ").filter(Boolean).map((name) => (
                  <Badge key={name} colorPalette="brand" variant="subtle" borderRadius="full">
                    {name}
                  </Badge>
                ))}
              </Flex>
            ) : null}

            {canEdit ? (
              <Field.Root mb={4}>
                <Field.Label>Internal notes</Field.Label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                <Button size="xs" mt={2} variant="outline" loading={saving} onClick={() => void saveNotes()}>
                  Save notes
                </Button>
              </Field.Root>
            ) : null}

            {canEdit ? (
              <Box mb={4}>
                <Flex gap={2} wrap="wrap">
                  {item.status !== "in_progress" && item.status !== "completed" ? (
                    <Button size="sm" variant="outline" loading={saving} onClick={() => void setStatus("in_progress")}>
                      Start
                    </Button>
                  ) : null}
                  {item.status !== "completed" ? (
                    <Button
                      size="sm"
                      colorPalette="brand"
                      loading={saving}
                      disabled={pendingSteps > 0}
                      onClick={() => void setStatus("completed")}
                    >
                      Complete
                    </Button>
                  ) : null}
                  {item.status !== "cancelled" && item.status !== "completed" ? (
                    <Button size="sm" variant="ghost" loading={saving} onClick={() => void setStatus("cancelled")}>
                      Cancel reminder
                    </Button>
                  ) : null}
                </Flex>
              </Box>
            ) : null}

            <ActionItemActivity history={item.history || []} />
          </>
        ) : null}
      </Box>
    </AppDialog>
  );
}
