import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { FiArrowLeft, FiPlus, FiSend } from "react-icons/fi";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useMobileViewport } from "../../hooks/useMobileViewport";
import { useVisibilityRefresh } from "../../hooks/useVisibilityRefresh";
import {
  api,
  type Building,
  type Lead,
  type LeadMessage,
} from "../../lib/api";
import { canMutateCustomers } from "../../lib/rbac";
import { useAuth } from "../../lib/auth";
import { toaster } from "../ui/toaster";
import { SelectField } from "../ui/SelectField";
import { AppDialog } from "../ui/AppDialog";
import { BRAND, fieldControlStyles } from "../../theme";

function prospectLabel(lead: Lead): string {
  return lead.name || lead.phone || lead.whatsappWaId || `Lead #${lead.id}`;
}

function formatChatTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
  });
}

function statusPalette(status: string): string {
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

type Props = {
  initialLeadId?: number | null;
};

export function ProspectWhatsAppInbox({ initialLeadId = null }: Props) {
  const { user } = useAuth();
  const canMutate = canMutateCustomers(user);
  const isMobile = useMobileViewport();
  const [prospects, setProspects] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);
  const [selectedId, setSelectedId] = useState<number | null>(initialLeadId);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    buildingId: "",
    apartmentNumber: "",
  });
  const [savingProspect, setSavingProspect] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const loadProspects = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const params: Record<string, string> = {
          source: "whatsapp",
          page: "1",
          limit: "100",
          sortBy: "name",
          sortDir: "asc",
        };
        if (search.trim()) params.search = search.trim();
        const res = await api.listLeads(params);
        const sorted = [...res.leads].sort((a, b) =>
          prospectLabel(a).localeCompare(prospectLabel(b), undefined, {
            sensitivity: "base",
          })
        );
        setProspects(sorted);
      } catch (e) {
        if (!opts?.silent) {
          toaster.create({
            type: "error",
            title: e instanceof Error ? e.message : "Failed to load prospects",
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [search]
  );

  useEffect(() => {
    void loadProspects();
  }, [loadProspects]);

  useEffect(() => {
    void api
      .listBuildings({ limit: "100" })
      .then((res) => setBuildings(res.data || res.buildings || []))
      .catch(() => setBuildings([]));
  }, []);

  useVisibilityRefresh(() => {
    void loadProspects({ silent: true });
    if (selectedId) void openChat(selectedId, { silent: true });
  });

  const openChat = useCallback(async (id: number, opts?: { silent?: boolean }) => {
    setSelectedId(id);
    setDraft("");
    if (!opts?.silent) setChatLoading(true);
    try {
      const res = await api.getLead(id);
      setSelected(res.lead);
      setMessages(res.messages);
    } catch (e) {
      if (!opts?.silent) {
        toaster.create({
          type: "error",
          title: e instanceof Error ? e.message : "Failed to load chat",
        });
      }
    } finally {
      setChatLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialLeadId) void openChat(initialLeadId);
  }, [initialLeadId, openChat]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selectedId]);

  async function sendReply() {
    if (!canMutate || !selected?.phone || !draft.trim()) return;
    setSending(true);
    try {
      const res = await api.sendCustomerWhatsAppMessage({
        phone: selected.phone,
        name: selected.name || undefined,
        body: draft.trim(),
      });
      setMessages(res.messages);
      setSelected(res.lead);
      setDraft("");
      void loadProspects({ silent: true });
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to send",
      });
    } finally {
      setSending(false);
    }
  }

  async function saveProspect() {
    if (!canMutate) return;
    setSavingProspect(true);
    try {
      const res = await api.createProspect({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        apartmentNumber: form.apartmentNumber.trim() || undefined,
        buildingId: form.buildingId ? Number(form.buildingId) : null,
      });
      toaster.create({
        type: "success",
        title: res.created ? "Prospect added" : "Prospect updated",
      });
      setShowForm(false);
      setForm({
        name: "",
        phone: "",
        email: "",
        buildingId: "",
        apartmentNumber: "",
      });
      await loadProspects();
      await openChat(res.lead.id);
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to save prospect",
      });
    } finally {
      setSavingProspect(false);
    }
  }

  const showList = !isMobile || selectedId == null;
  const showChat = !isMobile || selectedId != null;
  const headerName = selected ? prospectLabel(selected) : "Conversation";

  return (
    <>
      <Flex
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        bg="bg.panel"
        overflow="hidden"
        h={{ base: "calc(100dvh - 180px)", md: "min(720px, calc(100dvh - 200px))" }}
        minH="420px"
      >
        {showList ? (
          <Flex
            direction="column"
            w={{ base: "full", md: "320px", lg: "360px" }}
            borderRightWidth={{ base: 0, md: "1px" }}
            borderColor="border"
            minW={0}
            flexShrink={0}
          >
            <Box px={3} py={3} borderBottomWidth="1px" borderColor="border">
              <Flex justify="space-between" align="center" mb={2} gap={2}>
                <Text fontWeight="700" fontSize="md" color="brand.800">
                  Prospects
                </Text>
                {canMutate ? (
                  <Button size="xs" colorPalette="brand" onClick={() => setShowForm(true)}>
                    <FiPlus />
                    Add
                  </Button>
                ) : null}
              </Flex>
              <Input
                size="sm"
                placeholder="Search name or phone…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                borderRadius="md"
                bg={fieldControlStyles.bg}
                boxShadow={fieldControlStyles.boxShadow}
              />
            </Box>
            <Box flex="1" overflowY="auto" minH={0}>
              {loading ? (
                <Flex justify="center" py={10}>
                  <Spinner color="brand.600" />
                </Flex>
              ) : prospects.length === 0 ? (
                <Text px={4} py={8} fontSize="sm" color="fg.muted" textAlign="center">
                  {search.trim()
                    ? "No prospects match that search."
                    : "No prospects yet. Add someone with name and phone to start WhatsApp outreach."}
                </Text>
              ) : (
                prospects.map((lead) => {
                  const active = lead.id === selectedId;
                  const name = prospectLabel(lead);
                  return (
                    <Flex
                      key={lead.id}
                      as="button"
                      type="button"
                      w="full"
                      textAlign="left"
                      px={3}
                      py={3}
                      gap={3}
                      align="center"
                      borderBottomWidth="1px"
                      borderColor="border.muted"
                      bg={active ? "brand.50" : "transparent"}
                      borderLeftWidth="3px"
                      borderLeftColor={active ? "brand.600" : "transparent"}
                      _hover={{ bg: active ? "brand.50" : "bg.muted" }}
                      onClick={() => void openChat(lead.id)}
                    >
                      <Flex
                        w="40px"
                        h="40px"
                        borderRadius="full"
                        bg={active ? "brand.600" : "brand.100"}
                        color={active ? "white" : "brand.800"}
                        align="center"
                        justify="center"
                        fontWeight="700"
                        fontSize="sm"
                        flexShrink={0}
                      >
                        {name.slice(0, 1).toUpperCase()}
                      </Flex>
                      <Box flex="1" minW={0}>
                        <Flex justify="space-between" gap={2}>
                          <Text fontWeight="600" fontSize="sm" lineClamp={1}>
                            {name}
                          </Text>
                          <Text fontSize="2xs" color="fg.muted" flexShrink={0}>
                            {formatChatTime(lead.lastMessageAt || lead.updatedAt)}
                          </Text>
                        </Flex>
                        <Text fontSize="xs" color="fg.muted" lineClamp={1} mt={0.5}>
                          {lead.phone || "—"}
                          {lead.buildingName || lead.buildingInterest
                            ? ` · ${lead.buildingName || lead.buildingInterest}`
                            : ""}
                          {lead.apartmentNumber ? ` · ${lead.apartmentNumber}` : ""}
                        </Text>
                      </Box>
                    </Flex>
                  );
                })
              )}
            </Box>
          </Flex>
        ) : null}

        {showChat ? (
          <Flex direction="column" flex="1" minW={0} bg="bg.subtle">
            {!selectedId ? (
              <Flex flex="1" align="center" justify="center" px={6}>
                <Stack gap={2} textAlign="center" maxW="320px">
                  <Text fontWeight="600" color="brand.800">
                    Select a prospect
                  </Text>
                  <Text fontSize="sm" color="fg.muted">
                    These are people who are not customers yet. Add minimal details,
                    then message them on WhatsApp.
                  </Text>
                </Stack>
              </Flex>
            ) : (
              <>
                <Flex
                  px={3}
                  py={2.5}
                  align="center"
                  gap={2}
                  borderBottomWidth="1px"
                  borderColor="border"
                  bg="bg.panel"
                  minH="56px"
                >
                  {isMobile ? (
                    <IconButton
                      aria-label="Back"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedId(null);
                        setSelected(null);
                        setMessages([]);
                      }}
                    >
                      <FiArrowLeft />
                    </IconButton>
                  ) : null}
                  <Box flex="1" minW={0}>
                    <Text fontWeight="700" fontSize="sm" lineClamp={1}>
                      {headerName}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                      {selected?.phone || ""}
                      {selected?.email ? ` · ${selected.email}` : ""}
                    </Text>
                  </Box>
                  {selected ? (
                    <Badge colorPalette={statusPalette(selected.status)} variant="subtle">
                      {selected.status}
                    </Badge>
                  ) : null}
                </Flex>

                <Box
                  flex="1"
                  overflowY="auto"
                  px={3}
                  py={4}
                  minH={0}
                  bg={`linear-gradient(180deg, ${BRAND.paleAzure}14 0%, transparent 40%), var(--chakra-colors-bg-subtle)`}
                >
                  {chatLoading ? (
                    <Flex justify="center" py={10}>
                      <Spinner color="brand.600" />
                    </Flex>
                  ) : messages.length === 0 ? (
                    <Text fontSize="sm" color="fg.muted" textAlign="center" py={8}>
                      No messages yet. Send the first WhatsApp message below.
                    </Text>
                  ) : (
                    <Stack gap={2}>
                      {messages.map((m) => {
                        const inbound = m.direction === "inbound";
                        return (
                          <Flex
                            key={m.id}
                            justify={inbound ? "flex-start" : "flex-end"}
                          >
                            <Box
                              maxW={{ base: "88%", md: "70%" }}
                              px={3}
                              py={2}
                              borderRadius="lg"
                              bg={inbound ? "white" : "brand.600"}
                              color={inbound ? "fg" : "white"}
                              boxShadow="sm"
                            >
                              <Text fontSize="sm" whiteSpace="pre-wrap">
                                {m.body}
                              </Text>
                              <Text fontSize="2xs" mt={1} opacity={0.7} textAlign="right">
                                {formatChatTime(m.createdAt)}
                              </Text>
                            </Box>
                          </Flex>
                        );
                      })}
                      <div ref={chatEndRef} />
                    </Stack>
                  )}
                </Box>

                {canMutate ? (
                  <Flex
                    gap={2}
                    px={3}
                    py={3}
                    borderTopWidth="1px"
                    borderColor="border"
                    bg="bg.panel"
                    align="flex-end"
                  >
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Type a WhatsApp message…"
                      rows={2}
                      resize="none"
                      borderRadius="md"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void sendReply();
                        }
                      }}
                    />
                    <Button
                      colorPalette="brand"
                      borderRadius="md"
                      px={4}
                      loading={sending}
                      disabled={!draft.trim()}
                      onClick={() => void sendReply()}
                    >
                      <FiSend />
                    </Button>
                  </Flex>
                ) : null}
              </>
            )}
          </Flex>
        ) : null}
      </Flex>

      <AppDialog
        open={showForm}
        onOpenChange={(d) => setShowForm(d.open)}
        maxW="md"
      >
        <Dialog.Header pr={12}>
          <Dialog.Title>Add prospect</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text fontSize="sm" color="fg.muted" mb={3}>
            Minimal details for someone who is not a customer yet.
          </Text>
          <Stack gap={3}>
            <Field.Root required>
              <Field.Label>Name</Field.Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field.Root>
            <Field.Root required>
              <Field.Label>Phone</Field.Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="07XX XXX XXX"
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Email</Field.Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Building</Field.Label>
              <SelectField
                size="sm"
                fieldProps={{
                  value: form.buildingId,
                  onChange: (e) =>
                    setForm((f) => ({ ...f, buildingId: e.target.value })),
                }}
              >
                <option value="">Select building…</option>
                {buildings.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </SelectField>
            </Field.Root>
            <Field.Root>
              <Field.Label>Apartment no.</Field.Label>
              <Input
                value={form.apartmentNumber}
                onChange={(e) =>
                  setForm((f) => ({ ...f, apartmentNumber: e.target.value }))
                }
              />
            </Field.Root>
            <Flex gap={2} justify="flex-end" pt={2}>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button
                colorPalette="brand"
                loading={savingProspect}
                onClick={() => void saveProspect()}
              >
                Save prospect
              </Button>
            </Flex>
          </Stack>
        </Dialog.Body>
      </AppDialog>
    </>
  );
}
