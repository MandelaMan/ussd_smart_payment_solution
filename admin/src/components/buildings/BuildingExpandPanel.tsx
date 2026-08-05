import { useEffect, useState, type FormEvent } from "react";
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  IconButton,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FiEdit2, FiHome, FiPlus, FiTrash2 } from "react-icons/fi";
import {
  api,
  formatDate,
  type Building,
  type BuildingOlt,
} from "../../lib/api";
import { ipRulesHint } from "../../lib/buildingIpRules";
import { formatTitleCase } from "../../lib/formatText";
import { toaster } from "../ui/toaster";
import {
  DetailCard,
  DetailGrid,
  EntityExpandShell,
  StatusPill,
} from "../module/EntityExpandShell";

type Props = {
  building: Building;
  onEdit: (building: Building) => void;
  onChanged?: () => void;
  canEdit?: boolean;
};

const emptyOltForm = {
  name: "",
  host: "",
  port: "38881",
  mac: "",
  username: "",
  password: "",
  tenantId: "000000",
};

export function BuildingExpandPanel({
  building,
  onEdit,
  onChanged,
  canEdit = true,
}: Props) {
  const [olts, setOlts] = useState<BuildingOlt[]>(building.olts || []);
  const [showForm, setShowForm] = useState(false);
  const [editingOlt, setEditingOlt] = useState<BuildingOlt | null>(null);
  const [form, setForm] = useState(emptyOltForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setOlts(building.olts || []);
  }, [building.id, building.olts]);

  function openCreate() {
    setEditingOlt(null);
    setForm(emptyOltForm);
    setShowForm(true);
  }

  function openEditOlt(olt: BuildingOlt) {
    setEditingOlt(olt);
    setForm({
      name: olt.name || "",
      host: olt.host || "",
      port: String(olt.port || 38881),
      mac: olt.mac || "",
      username: olt.username || "",
      password: "",
      tenantId: olt.tenantId || "000000",
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingOlt(null);
    setForm(emptyOltForm);
  }

  async function refreshOlts() {
    const res = await api.listBuildingOlts(building.id);
    setOlts(res.olts || []);
    onChanged?.();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim() || null,
        host: form.host.trim(),
        port: Number(form.port) || 38881,
        mac: form.mac.trim(),
        username: form.username.trim(),
        tenantId: form.tenantId.trim() || "000000",
      };
      if (editingOlt) {
        await api.updateBuildingOlt(building.id, editingOlt.id, {
          ...payload,
          ...(form.password.trim() ? { password: form.password } : {}),
        });
        toaster.create({ title: "OLT updated", type: "success" });
      } else {
        await api.createBuildingOlt(building.id, {
          ...payload,
          password: form.password,
        });
        toaster.create({ title: "OLT added", type: "success" });
      }
      closeForm();
      await refreshOlts();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to save OLT",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(olt: BuildingOlt) {
    if (!window.confirm(`Remove OLT ${olt.name || olt.host}?`)) return;
    try {
      await api.deleteBuildingOlt(building.id, olt.id);
      toaster.create({ title: "OLT removed", type: "success" });
      await refreshOlts();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to delete OLT",
        type: "error",
      });
    }
  }

  return (
    <EntityExpandShell
      icon={FiHome}
      title={formatTitleCase(building.name)}
      subtitle={`${building.c2bCode} / ${building.b2bCode}`}
      badge={
        <StatusPill
          label={building.ipSetup}
          colorPalette={building.ipSetup === "STATIC" ? "blue" : "purple"}
        />
      }
      actions={
        canEdit ? (
          <Button size="sm" variant="outline" onClick={() => onEdit(building)}>
            <FiEdit2 />
            Edit
          </Button>
        ) : undefined
      }
      accent="brand.600"
    >
      <DetailGrid>
        <DetailCard label="C2B code" value={building.c2bCode} mono highlight />
        <DetailCard label="B2B code" value={building.b2bCode} mono />
        <DetailCard label="IP setup" value={building.ipSetup} />
        <DetailCard
          label="DSTV setup"
          value={building.dstvSetup === "headend_coax" ? "Headend coax" : "Decoder"}
        />
        <DetailCard
          label="IP prefixes"
          value={
            building.ipSetup === "PPOE"
              ? "Not applicable (PPOE)"
              : building.ipPrefixes?.length
                ? ipRulesHint(building)
                : "None configured"
          }
        />
        <DetailCard
          label="OLTs"
          value={olts.length ? `${olts.length} configured` : "None configured"}
          highlight={olts.length > 0}
        />
        <DetailCard
          label="Added"
          value={building.createdAt ? formatDate(building.createdAt) : null}
        />
        <DetailCard
          label="Street"
          value={building.addressStreet || null}
        />
        <DetailCard
          label="PO Box"
          value={building.addressPoBox || null}
        />
        <DetailCard
          label="City"
          value={
            [building.addressCity, building.addressState, building.addressZip]
              .filter(Boolean)
              .join(", ") || null
          }
        />
        <DetailCard
          label="Country"
          value={building.addressCountry || null}
        />
      </DetailGrid>

      <Box mt={4}>
        <Flex align="center" justify="space-between" mb={2}>
          <Text fontWeight="semibold" fontSize="sm">
            OLT EMS devices
          </Text>
          {canEdit && !showForm ? (
            <Button size="xs" variant="outline" onClick={openCreate}>
              <FiPlus />
              Add OLT
            </Button>
          ) : null}
        </Flex>

        {olts.length === 0 && !showForm ? (
          <Text fontSize="sm" color="fg.muted">
            No OLTs yet. A building can have multiple OLTs — add one to enable ONU control.
          </Text>
        ) : (
          <Stack gap={2}>
            {olts.map((olt) => (
              <Flex
                key={olt.id}
                align={{ base: "flex-start", md: "center" }}
                justify="space-between"
                gap={3}
                bg="bg.subtle"
                px={3}
                py={2}
                borderRadius="md"
                direction={{ base: "column", md: "row" }}
              >
                <Box fontSize="sm" minW={0}>
                  <Text fontWeight="medium">
                    {olt.name || `OLT #${olt.id}`}
                  </Text>
                  <Text fontFamily="mono" fontSize="xs" color="fg.muted">
                    {olt.host}:{olt.port} · {olt.mac}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {olt.username}
                    {olt.passwordConfigured ? " · password set" : " · password missing"}
                    {!olt.isActive ? " · inactive" : ""}
                  </Text>
                </Box>
                {canEdit ? (
                  <Flex gap={1}>
                    <IconButton
                      aria-label="Edit OLT"
                      size="xs"
                      variant="ghost"
                      onClick={() => openEditOlt(olt)}
                    >
                      <FiEdit2 />
                    </IconButton>
                    <IconButton
                      aria-label="Delete OLT"
                      size="xs"
                      variant="ghost"
                      colorPalette="red"
                      onClick={() => handleDelete(olt)}
                    >
                      <FiTrash2 />
                    </IconButton>
                  </Flex>
                ) : null}
              </Flex>
            ))}
          </Stack>
        )}

        {showForm && canEdit ? (
          <Box
            as="form"
            onSubmit={handleSubmit}
            mt={3}
            p={3}
            borderWidth="1px"
            borderRadius="md"
          >
            <Text fontSize="sm" fontWeight="medium" mb={3}>
              {editingOlt ? "Edit OLT" : "Add OLT"}
            </Text>
            <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={3}>
              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Block A OLT"
                />
              </Field.Root>
              <Field.Root required>
                <Field.Label>Host / IP</Field.Label>
                <Input
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="100.114.194.126"
                  fontFamily="mono"
                  required
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>EMS port</Field.Label>
                <Input
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  inputMode="numeric"
                />
              </Field.Root>
              <Field.Root required>
                <Field.Label>MAC</Field.Label>
                <Input
                  value={form.mac}
                  onChange={(e) => setForm({ ...form, mac: e.target.value })}
                  placeholder="6c:68:a4:ee:93:74"
                  fontFamily="mono"
                  required
                />
              </Field.Root>
              <Field.Root required>
                <Field.Label>Username</Field.Label>
                <Input
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                  required
                  autoComplete="off"
                />
              </Field.Root>
              <Field.Root required={!editingOlt}>
                <Field.Label>Password</Field.Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  placeholder={
                    editingOlt
                      ? "Leave blank to keep current"
                      : "EMS password"
                  }
                  autoComplete="new-password"
                  required={!editingOlt}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Tenant ID</Field.Label>
                <Input
                  value={form.tenantId}
                  onChange={(e) =>
                    setForm({ ...form, tenantId: e.target.value })
                  }
                  fontFamily="mono"
                />
              </Field.Root>
            </Grid>
            <Flex gap={2} mt={3}>
              <Button type="submit" size="sm" colorPalette="brand" loading={submitting}>
                {editingOlt ? "Save OLT" : "Add OLT"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={closeForm}>
                Cancel
              </Button>
            </Flex>
          </Box>
        ) : null}
      </Box>
    </EntityExpandShell>
  );
}
