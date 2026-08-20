import { useEffect, useMemo, useState } from "react";
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
import {
  api,
  type ActionAssignee,
  type ActionType,
  type Customer,
} from "../../lib/api";
import { AppDialog } from "../ui/AppDialog";
import { DateField } from "../ui/DateField";
import { SelectField } from "../ui/SelectField";
import { RowCheckbox } from "../ui/RowCheckbox";
import { toaster } from "../ui/toaster";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useAuth } from "../../lib/authContext";
import { normalizeRole } from "../../lib/rbac";
import { useNotifications } from "../notifications/NotificationProvider";

type PrefillCustomer = {
  id: number;
  customerNumber?: string;
  fullName?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  customer?: PrefillCustomer | Customer | null;
};

export function CreateActionDialog({ open, onClose, onCreated, customer }: Props) {
  const { user } = useAuth();
  const { refresh: refreshNotifications } = useNotifications();
  const [types, setTypes] = useState<ActionType[]>([]);
  const [users, setUsers] = useState<ActionAssignee[]>([]);
  const [typeKey, setTypeKey] = useState("customer_move_out");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const [extraStep, setExtraStep] = useState("");
  const [extraSteps, setExtraSteps] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<PrefillCustomer | null>(customer || null);
  const [results, setResults] = useState<PrefillCustomer[]>([]);
  const debouncedSearch = useDebouncedValue(search, 250);

  const selectedType = useMemo(
    () => types.find((t) => t.key === typeKey) || null,
    [types, typeKey]
  );

  useEffect(() => {
    if (!open) return;
    setTypeKey("customer_move_out");
    setDueDate("");
    setPriority("normal");
    setDescription("");
    setExtraStep("");
    setExtraSteps([]);
    setSelectedUserIds([]);
    setNotifyCustomer(false);
    setSearch("");
    setResults([]);
    setPicked(customer || null);
    void api.listActionTypes().then((res) => {
      setTypes(res.types || []);
      if (res.types?.length && !res.types.some((t) => t.key === "customer_move_out")) {
        setTypeKey(res.types[0].key);
      }
    }).catch(() => setTypes([]));
    void api.listActionAssignees().then((res) => {
      const list = res.users || [];
      setUsers(list);
      const tagged = new Set(
        list
          .filter((row) => normalizeRole(row.role || undefined) === "admin")
          .map((row) => row.id)
      );
      if (user?.id) tagged.add(user.id);
      setSelectedUserIds([...tagged]);
    }).catch(() => setUsers([]));
  }, [open, customer, user?.id]);

  useEffect(() => {
    if (!open || customer) return;
    const q = debouncedSearch.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    void api
      .listCustomers({ search: q, limit: "8", status: "active" })
      .then((res) => {
        if (cancelled) return;
        setResults(
          (res.data || []).map((c) => ({
            id: c.id,
            customerNumber: c.customerNumber,
            fullName: c.fullName,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, open, customer]);

  function addExtra() {
    const label = extraStep.trim();
    if (!label) return;
    setExtraSteps((prev) => [...prev, label]);
    setExtraStep("");
  }

  function toggleUser(id: number) {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function submit() {
    if (selectedType?.requiresCustomer && !picked?.id) {
      toaster.create({ title: "Select a customer for this reminder", type: "error" });
      return;
    }
    if (typeKey === "custom" && extraSteps.length === 0 && !selectedType?.steps.length) {
      toaster.create({ title: "Add at least one checklist item", type: "error" });
      return;
    }
    if (!selectedUserIds.length) {
      toaster.create({ title: "Tag at least one user", type: "error" });
      return;
    }
    setSaving(true);
    try {
      await api.createActionItem({
        typeKey,
        customerId: picked?.id || null,
        description: description.trim() || undefined,
        dueDate: dueDate || null,
        priority: priority as "low" | "normal" | "high" | "urgent",
        assigneeIds: selectedUserIds,
        extraSteps: extraSteps.map((label) => ({ label })),
        notifyCustomer: Boolean(picked?.id) && notifyCustomer,
      });
      toaster.create({
        title: "Reminder created",
        description: picked?.id
          ? "Tagged users were notified. The customer was emailed."
          : "Tagged users were notified.",
        type: "success",
      });
      void refreshNotifications();
      onCreated?.();
      onClose();
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Could not create reminder",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppDialog open={open} onOpenChange={(d) => !d.open && onClose()} maxW="lg">
      <Box px={5} py={4} overflowY="auto">
        <Text fontWeight="semibold" mb={1} pr={8}>
          New reminder
        </Text>
        <Text fontSize="sm" color="fg.muted" mb={4}>
          Tag teammates so they get a notification bubble. Customer-linked
          reminders also send the customer an email.
        </Text>

        <Stack gap={3}>
          <Field.Root required>
            <Field.Label>Type</Field.Label>
            <SelectField
              size="md"
              fieldProps={{
                value: typeKey,
                onChange: (e) => setTypeKey(e.target.value),
              }}
            >
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </SelectField>
            {selectedType?.description ? (
              <Text fontSize="xs" color="fg.muted" mt={1}>
                {selectedType.description}
              </Text>
            ) : null}
          </Field.Root>

          {customer ? (
            <Field.Root>
              <Field.Label>Customer</Field.Label>
              <Flex
                align="center"
                borderWidth="1px"
                borderRadius="md"
                px={3}
                h="40px"
                minH="40px"
                bg="bg.muted"
              >
                <Text fontSize="sm" fontWeight="medium" truncate>
                  {customer.customerNumber} · {customer.fullName}
                </Text>
              </Flex>
            </Field.Root>
          ) : (
            <Field.Root required={Boolean(selectedType?.requiresCustomer)}>
              <Field.Label>Customer</Field.Label>
              {picked ? (
                <Flex
                  align="center"
                  justify="space-between"
                  gap={2}
                  borderWidth="1px"
                  borderRadius="md"
                  px={3}
                  h="40px"
                  minH="40px"
                >
                  <Text fontSize="sm" truncate>
                    {picked.customerNumber} · {picked.fullName}
                  </Text>
                  <Button size="xs" variant="ghost" onClick={() => setPicked(null)}>
                    Change
                  </Button>
                </Flex>
              ) : (
                <>
                  <Input
                    size="md"
                    h="40px"
                    placeholder="Search name or account number"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {results.length ? (
                    <Stack gap={0} mt={1} borderWidth="1px" borderRadius="md" overflow="hidden">
                      {results.map((c) => (
                        <Button
                          key={c.id}
                          variant="ghost"
                          size="sm"
                          justifyContent="flex-start"
                          borderRadius={0}
                          onClick={() => {
                            setPicked(c);
                            setSearch("");
                            setResults([]);
                          }}
                        >
                          {c.customerNumber} · {c.fullName}
                        </Button>
                      ))}
                    </Stack>
                  ) : null}
                </>
              )}
            </Field.Root>
          )}

          <Flex gap={3} direction={{ base: "column", sm: "row" }} align={{ sm: "flex-end" }}>
            <Field.Root flex="1">
              <Field.Label>Due date</Field.Label>
              <DateField
                size="md"
                value={dueDate}
                onChange={setDueDate}
                onClear={() => setDueDate("")}
              />
            </Field.Root>
            <Field.Root flex="1">
              <Field.Label>Priority</Field.Label>
              <SelectField
                size="md"
                fieldProps={{
                  value: priority,
                  onChange: (e) => setPriority(e.target.value),
                }}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </SelectField>
            </Field.Root>
          </Flex>

          <Field.Root>
            <Field.Label>Notes</Field.Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Customer is moving out 31 Aug — collect ONU after cancellation."
            />
          </Field.Root>

          {selectedType?.steps.length ? (
            <Box>
              <Text fontSize="sm" fontWeight="medium" mb={1}>
                Checklist
              </Text>
              <Stack gap={0.5}>
                {selectedType.steps.map((step) => (
                  <Text key={step.key} fontSize="sm" color="fg.muted" title={step.description || undefined}>
                    • {step.label}
                  </Text>
                ))}
                {extraSteps.map((label) => (
                  <Flex key={label} gap={2} align="center">
                    <Text fontSize="sm" color="fg">
                      • {label}
                    </Text>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setExtraSteps((prev) => prev.filter((x) => x !== label))}
                    >
                      Remove
                    </Button>
                  </Flex>
                ))}
              </Stack>
            </Box>
          ) : null}

          <Field.Root>
            <Field.Label>Add checklist item</Field.Label>
            <Flex gap={2} align="center">
              <Input
                size="md"
                h="40px"
                value={extraStep}
                placeholder="Optional extra step"
                onChange={(e) => setExtraStep(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addExtra();
                  }
                }}
              />
              <Button size="md" h="40px" variant="outline" onClick={addExtra} flexShrink={0}>
                Add
              </Button>
            </Flex>
          </Field.Root>

          <Box>
            <Flex align="center" justify="space-between" gap={2} mb={1.5}>
              <Text fontSize="sm" fontWeight="medium">
                Tag users
              </Text>
              {selectedUserIds.length ? (
                <Badge colorPalette="brand" variant="subtle">
                  {selectedUserIds.length} tagged
                </Badge>
              ) : null}
            </Flex>
            <Flex wrap="wrap" gap={1.5}>
              {users.map((u) => {
                const selected = selectedUserIds.includes(u.id);
                return (
                  <Box
                    key={u.id}
                    as="button"
                    aria-pressed={selected}
                    aria-label={`Tag ${u.name}`}
                    title={u.jobTitle || u.email}
                    onClick={() => toggleUser(u.id)}
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

          {picked ? (
            <Flex align="center" gap={2}>
              <RowCheckbox
                checked={notifyCustomer}
                onChange={() => setNotifyCustomer((v) => !v)}
                aria-label="Email the customer"
              />
              <Text fontSize="sm">Email the customer about this reminder</Text>
            </Flex>
          ) : null}
        </Stack>

        <Flex justify="flex-end" gap={2} mt={5}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button colorPalette="brand" loading={saving} onClick={() => void submit()}>
            Create reminder
          </Button>
        </Flex>
      </Box>
    </AppDialog>
  );
}
