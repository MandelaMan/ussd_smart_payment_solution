import { useEffect, useState, type FormEvent } from "react";
import {
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Grid,
  Heading,
  IconButton,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FiEdit2, FiPlus, FiTrash2 } from "react-icons/fi";
import { api, type Pop } from "../../lib/api";
import { toaster } from "../ui/toaster";
import { SelectField } from "../ui/SelectField";
import { AppDialog } from "../ui/AppDialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

export function PopManageDialog({ open, onOpenChange, onChanged }: Props) {
  const [pops, setPops] = useState<Pop[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Pop | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [c2bCode, setC2bCode] = useState("");
  const [b2bCode, setB2bCode] = useState("");
  const [ipSetup, setIpSetup] = useState<"STATIC" | "PPOE">("STATIC");
  const [dstvSetup, setDstvSetup] = useState<"headend_coax" | "decoder">("decoder");
  const [prefixInput, setPrefixInput] = useState("");
  const [ipPrefixes, setIpPrefixes] = useState<string[]>([]);

  async function loadPops() {
    setLoading(true);
    try {
      const res = await api.listPops();
      setPops(res.pops || []);
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to load POPs",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void loadPops();
  }, [open]);

  function resetForm() {
    setEditing(null);
    setName("");
    setC2bCode("");
    setB2bCode("");
    setIpSetup("STATIC");
    setDstvSetup("decoder");
    setIpPrefixes([]);
    setPrefixInput("");
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(pop: Pop) {
    setEditing(pop);
    setName(pop.name);
    setC2bCode(pop.c2bCode);
    setB2bCode(pop.b2bCode);
    setIpSetup(pop.ipSetup);
    setDstvSetup(pop.dstvSetup || "decoder");
    setIpPrefixes(pop.ipPrefixes || []);
    setPrefixInput("");
    setShowForm(true);
  }

  function addPrefix() {
    const value = prefixInput.trim();
    if (!value) return;
    const normalized = value.endsWith(".") ? value : `${value}.`;
    if (ipPrefixes.includes(normalized) || ipPrefixes.includes(value)) {
      toaster.create({ title: "Prefix already added", type: "warning" });
      return;
    }
    setIpPrefixes([...ipPrefixes, value]);
    setPrefixInput("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        c2bCode: c2bCode.toUpperCase(),
        b2bCode: b2bCode.toUpperCase(),
        ipSetup,
        dstvSetup,
        ipPrefixes: ipSetup === "STATIC" ? ipPrefixes : [],
      };
      if (editing) {
        await api.updatePop(editing.id, payload);
        toaster.create({ title: "POP updated", type: "success" });
      } else {
        await api.createPop(payload);
        toaster.create({ title: "POP created", type: "success" });
      }
      setShowForm(false);
      resetForm();
      await loadPops();
      onChanged();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to save POP",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppDialog open={open} onOpenChange={(d) => onOpenChange(d.open)} maxW="3xl">
      <Dialog.Header pr={12} flexShrink={0}>
        <Dialog.Title>Manage POPs</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body overflowY="auto" flex="1" minH={0} maxH="min(75vh, 720px)">
        <Text fontSize="sm" color="fg.muted" mb={4}>
          C2B/B2B codes, IP setup, DSTV setup, and the IP prefix pool live on the POP.
          Buildings under a POP get an address and assigned prefixes from that pool.
        </Text>

        <Flex justify="space-between" align="center" mb={3}>
          <Heading size="sm">POPs</Heading>
          {!showForm ? (
            <Button size="sm" colorPalette="brand" onClick={openCreate}>
              <FiPlus />
              Add POP
            </Button>
          ) : null}
        </Flex>

        {showForm ? (
          <Box
            as="form"
            onSubmit={handleSubmit}
            mb={4}
            p={4}
            borderWidth="1px"
            borderRadius="md"
          >
            <Heading size="xs" mb={3}>
              {editing ? `Edit ${editing.name}` : "New POP"}
            </Heading>
            <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={3}>
              <Field.Root required>
                <Field.Label>POP name</Field.Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </Field.Root>
              <Field.Root required>
                <Field.Label>IP setup</Field.Label>
                <SelectField
                  fieldProps={{
                    value: ipSetup,
                    onChange: (e) => {
                      const v = e.target.value as "STATIC" | "PPOE";
                      setIpSetup(v);
                      if (v === "PPOE") setIpPrefixes([]);
                    },
                  }}
                >
                  <option value="STATIC">STATIC</option>
                  <option value="PPOE">PPOE</option>
                </SelectField>
              </Field.Root>
              <Field.Root required>
                <Field.Label>C2B code</Field.Label>
                <Input
                  value={c2bCode}
                  onChange={(e) => setC2bCode(e.target.value.toUpperCase())}
                  maxLength={10}
                  required
                />
              </Field.Root>
              <Field.Root required>
                <Field.Label>B2B code</Field.Label>
                <Input
                  value={b2bCode}
                  onChange={(e) => setB2bCode(e.target.value.toUpperCase())}
                  maxLength={10}
                  required
                />
              </Field.Root>
              <Field.Root required>
                <Field.Label>DSTV setup</Field.Label>
                <SelectField
                  fieldProps={{
                    value: dstvSetup,
                    onChange: (e) =>
                      setDstvSetup(e.target.value as "headend_coax" | "decoder"),
                  }}
                >
                  <option value="headend_coax">Headend coax</option>
                  <option value="decoder">Decoder</option>
                </SelectField>
              </Field.Root>
              {ipSetup === "STATIC" ? (
                <Box gridColumn={{ md: "span 2" }}>
                  <Field.Root>
                    <Field.Label>IP prefix pool</Field.Label>
                    <Text fontSize="xs" color="fg.muted" mb={2}>
                      Buildings under this POP can only be assigned prefixes from this pool.
                    </Text>
                    <Flex gap={2} mb={2}>
                      <Input
                        value={prefixInput}
                        onChange={(e) => setPrefixInput(e.target.value)}
                        placeholder="e.g. 10.12.10."
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addPrefix();
                          }
                        }}
                      />
                      <Button type="button" variant="outline" onClick={addPrefix}>
                        <FiPlus /> Add
                      </Button>
                    </Flex>
                    <Stack gap={1}>
                      {ipPrefixes.map((p, i) => (
                        <Flex
                          key={p}
                          align="center"
                          justify="space-between"
                          bg="bg.subtle"
                          px={3}
                          py={1.5}
                          borderRadius="md"
                          fontSize="sm"
                        >
                          <Text fontFamily="mono">
                            {p.endsWith(".") ? p : `${p}.`}x
                          </Text>
                          <IconButton
                            aria-label="Remove"
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            onClick={() =>
                              setIpPrefixes(ipPrefixes.filter((_, idx) => idx !== i))
                            }
                          >
                            <FiTrash2 />
                          </IconButton>
                        </Flex>
                      ))}
                    </Stack>
                  </Field.Root>
                </Box>
              ) : null}
            </Grid>
            <Flex gap={2} mt={4}>
              <Button type="submit" colorPalette="brand" loading={submitting}>
                {editing ? "Save POP" : "Create POP"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
            </Flex>
          </Box>
        ) : null}

        {loading ? (
          <Text fontSize="sm" color="fg.muted">
            Loading…
          </Text>
        ) : pops.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            No POPs yet.
          </Text>
        ) : (
          <Stack gap={2}>
            {pops.map((pop) => (
              <Flex
                key={pop.id}
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
                  <Text fontWeight="medium">{pop.name}</Text>
                  <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                    {pop.c2bCode} / {pop.b2bCode} · {pop.ipSetup} ·{" "}
                    {pop.dstvSetup === "headend_coax" ? "Headend coax" : "Decoder"}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {pop.buildingCount ?? 0} building
                    {(pop.buildingCount ?? 0) === 1 ? "" : "s"}
                    {pop.ipSetup === "STATIC"
                      ? ` · ${(pop.ipPrefixes || []).length} prefix(es)`
                      : ""}
                  </Text>
                </Box>
                <IconButton
                  aria-label="Edit POP"
                  size="xs"
                  variant="ghost"
                  onClick={() => openEdit(pop)}
                >
                  <FiEdit2 />
                </IconButton>
              </Flex>
            ))}
          </Stack>
        )}
      </Dialog.Body>
    </AppDialog>
  );
}
