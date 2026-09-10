import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Field, Flex, Input, Stack, Text, Textarea } from "@chakra-ui/react";
import { api, type Building, type Lead } from "../../lib/api";
import { toaster } from "../ui/toaster";
import { AppDialog } from "../ui/AppDialog";
import { SearchableSelect } from "../ui/SearchableSelect";
import {
  APARTMENT_UNIT_MAX,
  BLOCK_MAX,
  apartmentUnitInput,
  apartmentUnitLooksCompound,
  normalizeBlockInput,
} from "../../lib/customerNumber";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (lead: Lead, created: boolean) => void;
};

const EMPTY = {
  name: "",
  phone: "",
  email: "",
  buildingId: "",
  apartmentNumber: "",
  block: "",
  notes: "",
};

export function CreateLeadDialog({ open, onOpenChange, onSaved }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apartmentError, setApartmentError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setApartmentError("");
    setBuildingsLoading(true);
    api
      .listBuildings({ limit: "200", sortBy: "name", sortDir: "asc" })
      .then((res) => setBuildings(res.buildings || res.data || []))
      .catch(() => setBuildings([]))
      .finally(() => setBuildingsLoading(false));
  }, [open]);

  const selectedBuilding = buildings.find((b) => String(b.id) === form.buildingId);
  const buildingOptions = useMemo(
    () =>
      buildings.map((b) => ({
        value: String(b.id),
        label: b.name,
        description: b.buildingCode || undefined,
        keywords: `${b.popName || ""} ${b.buildingCode || ""} ${b.c2bCode} ${b.b2bCode}`,
      })),
    [buildings]
  );

  function setApartment(value: string) {
    setForm((f) => ({ ...f, apartmentNumber: apartmentUnitInput(value) }));
  }

  useEffect(() => {
    if (!form.apartmentNumber) {
      setApartmentError("");
      return;
    }
    setApartmentError(
      apartmentUnitLooksCompound(form.apartmentNumber, selectedBuilding)
        ? "Enter the unit only (e.g. 4G) and put the block in Block."
        : ""
    );
  }, [form.apartmentNumber, selectedBuilding]);

  async function submit() {
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name || name.length < 2) {
      toaster.create({ type: "error", title: "Enter the lead's name" });
      return;
    }
    if (phone.replace(/\D/g, "").length < 9) {
      toaster.create({ type: "error", title: "Enter a valid phone number" });
      return;
    }
    if (form.email.trim() && !form.email.includes("@")) {
      toaster.create({ type: "error", title: "Enter a valid email" });
      return;
    }
    if (form.apartmentNumber && apartmentUnitLooksCompound(form.apartmentNumber, selectedBuilding)) {
      setApartmentError("Enter the unit only (e.g. 4G) and put the block in Block.");
      return;
    }

    setSaving(true);
    try {
      const res = await api.createLead({
        name,
        phone,
        email: form.email.trim() || undefined,
        buildingId: form.buildingId ? Number(form.buildingId) : null,
        apartmentNumber: form.apartmentNumber || undefined,
        block: form.block.trim() || undefined,
        message: form.notes.trim() || undefined,
      });
      toaster.create({
        type: "success",
        title: res.created ? "Lead added" : "Existing lead updated",
      });
      onOpenChange(false);
      onSaved(res.lead, res.created);
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Could not add lead",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppDialog open={open} onOpenChange={(d) => onOpenChange(d.open)} maxW="lg">
      <Dialog.Header pr={12}>
        <Dialog.Title>Add lead</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap={3}>
          <Field.Root required>
            <Field.Label>Name</Field.Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoComplete="name"
            />
          </Field.Root>
          <Flex gap={3} direction={{ base: "column", sm: "row" }}>
            <Field.Root required flex="1">
              <Field.Label>Phone</Field.Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="07XX XXX XXX"
                inputMode="tel"
                autoComplete="tel"
              />
            </Field.Root>
            <Field.Root flex="1">
              <Field.Label>Email</Field.Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                autoComplete="email"
              />
            </Field.Root>
          </Flex>
          <Field.Root>
            <Field.Label>Building</Field.Label>
            <SearchableSelect
              value={form.buildingId}
              onChange={(value) => setForm((f) => ({ ...f, buildingId: value }))}
              options={buildingOptions}
              isLoading={buildingsLoading}
              placeholder="Select building"
              searchPlaceholder="Search buildings…"
              emptyLabel="No buildings match your search"
            />
          </Field.Root>
          <Flex gap={3} direction={{ base: "column", sm: "row" }}>
            <Field.Root flex="1" invalid={Boolean(apartmentError)}>
              <Field.Label>Apartment number</Field.Label>
              <Input
                value={form.apartmentNumber}
                onChange={(e) => setApartment(e.target.value)}
                placeholder="e.g. 4G"
                maxLength={APARTMENT_UNIT_MAX}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              {apartmentError ? (
                <Text fontSize="xs" color="red.600" mt={1}>
                  {apartmentError}
                </Text>
              ) : null}
            </Field.Root>
            <Field.Root flex="1">
              <Field.Label>Block</Field.Label>
              <Input
                value={form.block}
                onChange={(e) =>
                  setForm((f) => ({ ...f, block: normalizeBlockInput(e.target.value) }))
                }
                placeholder="e.g. A"
                maxLength={BLOCK_MAX}
              />
            </Field.Root>
          </Flex>
          <Field.Root>
            <Field.Label>Notes</Field.Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </Field.Root>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer px={5} py={4} borderTopWidth="1px" borderColor="border.muted" gap={2}>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button colorPalette="brand" loading={saving} onClick={() => void submit()}>
          Add lead
        </Button>
      </Dialog.Footer>
    </AppDialog>
  );
}
