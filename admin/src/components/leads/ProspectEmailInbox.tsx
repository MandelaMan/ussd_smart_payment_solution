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
} from "@chakra-ui/react";
import {
  FiArrowLeft,
  FiPaperclip,
  FiPlus,
  FiRefreshCw,
  FiSend,
  FiX,
} from "react-icons/fi";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useMobileViewport } from "../../hooks/useMobileViewport";
import { useVisibilityRefresh } from "../../hooks/useVisibilityRefresh";
import {
  api,
  type Building,
  type CustomerEmailMessage,
  type Lead,
} from "../../lib/api";
import { canMutateCustomers } from "../../lib/rbac";
import { useAuth } from "../../lib/authContext";
import { toaster } from "../ui/toaster";
import { InboxListSkeleton } from "../PageSkeletons";
import { SelectField } from "../ui/SelectField";
import { AppDialog } from "../ui/AppDialog";
import { fieldControlStyles } from "../../theme";
import {
  RichTextEditor,
  isRichTextEmpty,
  sanitizeEmailHtml,
} from "../ui/RichTextEditor";
import { EmailMessageBubble } from "../communication/EmailMessageBubble";

type PendingAttachment = {
  fileName: string;
  contentType: string;
  contentBase64: string;
  size: number;
};

function prospectLabel(lead: Lead): string {
  return lead.name || lead.email || `Lead #${lead.id}`;
}

function formatGreetingName(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const first = raw.split(/\s+/)[0] || raw;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function defaultEmailSubject(lead: Lead): string {
  const name =
    formatGreetingName(lead.name) ||
    formatGreetingName(prospectLabel(lead)) ||
    "there";
  return `Dear ${name}`;
}

function formatMsgTime(value: string | null | undefined): string {
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

function replySubject(previous: string | undefined, fallback: string): string {
  const base = (previous || fallback || "").trim();
  if (!base) return "";
  return /^re:\s*/i.test(base) ? base : `Re: ${base}`;
}

function fileToBase64(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        contentBase64: base64,
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  initialLeadId?: number | null;
};

export function ProspectEmailInbox({ initialLeadId = null }: Props) {
  const { user } = useAuth();
  const canMutate = canMutateCustomers(user);
  const isMobile = useMobileViewport();
  const [prospects, setProspects] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);
  const [selectedId, setSelectedId] = useState<number | null>(initialLeadId);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<CustomerEmailMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [mailConfigured, setMailConfigured] = useState<boolean | null>(null);
  const [mailboxLabel, setMailboxLabel] = useState("");
  const [mailboxName, setMailboxName] = useState("Support");
  const [showForm, setShowForm] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    buildingId: "",
    apartmentNumber: "",
  });
  const [savingProspect, setSavingProspect] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const canSend =
    canMutate &&
    mailConfigured !== false &&
    to.trim().includes("@") &&
    subject.trim().length > 0 &&
    !isRichTextEmpty(body);

  const loadProspects = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const params: Record<string, string> = {
          hasEmail: "1",
          page: "1",
          limit: "100",
          sortBy: "name",
          sortDir: "asc",
        };
        if (search.trim()) params.search = search.trim();
        const res = await api.listLeads(params);
        const rows = Array.isArray(res.leads)
          ? res.leads
          : Array.isArray(res.data)
            ? res.data
            : [];
        const sorted = [...rows].sort((a, b) =>
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

  useEffect(() => {
    void api
      .getCommunicationStatus()
      .then((s) => {
        setMailConfigured(Boolean(s.email?.configured));
        if (s.email?.fromAddress) setMailboxLabel(s.email.fromAddress);
        if (s.email?.fromName) setMailboxName(s.email.fromName);
      })
      .catch(() => setMailConfigured(false));
  }, []);

  const openChat = useCallback(
    async (id: number, opts?: { silent?: boolean; emailOverride?: string }) => {
      setSelectedId(id);
      if (!opts?.silent) setChatLoading(true);
      try {
        const res = await api.listLeadEmailConversation(
          id,
          opts?.emailOverride
        );
        setSelected(res.lead);
        setMessages(res.messages);
        if (res.mailbox?.fromAddress) setMailboxLabel(res.mailbox.fromAddress);
        if (res.mailbox?.fromName) setMailboxName(res.mailbox.fromName);

        const emailAddr = (
          opts?.emailOverride ||
          res.email ||
          res.lead.email ||
          ""
        ).trim();
        setTo(emailAddr);

        if (!opts?.silent) {
          const last = res.messages[res.messages.length - 1];
          setSubject(
            last?.subject
              ? replySubject(last.subject, defaultEmailSubject(res.lead))
              : defaultEmailSubject(res.lead)
          );
          setBody("");
          setAttachments([]);
        }
      } catch (e) {
        if (!opts?.silent) {
          toaster.create({
            type: "error",
            title: e instanceof Error ? e.message : "Failed to load conversation",
          });
        }
      } finally {
        setChatLoading(false);
      }
    },
    []
  );

  useVisibilityRefresh(() => {
    void loadProspects({ silent: true });
    if (selectedId) void openChat(selectedId, { silent: true });
  });

  useEffect(() => {
    if (initialLeadId) void openChat(initialLeadId);
  }, [initialLeadId, openChat]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selectedId]);

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const next: PendingAttachment[] = [];
      for (const file of Array.from(files).slice(0, 5)) {
        if (file.size > 8 * 1024 * 1024) {
          toaster.create({
            type: "error",
            title: `${file.name} exceeds 8MB`,
          });
          continue;
        }
        next.push(await fileToBase64(file));
      }
      setAttachments((prev) => [...prev, ...next].slice(0, 5));
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to attach files",
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function sendEmail() {
    if (!canSend || !selectedId) return;
    setSending(true);
    try {
      const html = sanitizeEmailHtml(body);
      await api.sendLeadEmail({
        leadId: selectedId,
        to: to.trim(),
        subject: subject.trim(),
        body: html,
        attachments: attachments.map(({ fileName, contentType, contentBase64 }) => ({
          fileName,
          contentType,
          contentBase64,
        })),
      });
      toaster.create({ type: "success", title: "Email sent" });
      setBody("");
      setAttachments([]);
      await openChat(selectedId, { silent: false, emailOverride: to.trim() });
      void loadProspects({ silent: true });
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to send email",
      });
    } finally {
      setSending(false);
    }
  }

  async function saveProspect() {
    if (!canMutate) return;
    setSavingProspect(true);
    try {
      const res = await api.createEmailProspect({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
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
        email: "",
        phone: "",
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
                placeholder="Search name or email…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                borderRadius="md"
                bg={fieldControlStyles.bg}
                boxShadow={fieldControlStyles.boxShadow}
              />
            </Box>
            <Box flex="1" overflowY="auto" minH={0}>
              {loading ? (
                <InboxListSkeleton />
              ) : prospects.length === 0 ? (
                <Text px={4} py={8} fontSize="sm" color="fg.muted" textAlign="center">
                  {search.trim()
                    ? "No prospects match that search."
                    : "No email prospects yet. Add someone with name and email to start outreach."}
                </Text>
              ) : (
                prospects.map((lead) => {
                  const active = lead.id === selectedId;
                  const name = prospectLabel(lead);
                  return (
                    <Flex
                      key={lead.id}
                      as="button"
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
                            {formatMsgTime(lead.updatedAt)}
                          </Text>
                        </Flex>
                        <Text fontSize="xs" color="fg.muted" lineClamp={1} mt={0.5}>
                          {lead.email || "—"}
                          {lead.buildingName || lead.buildingInterest
                            ? ` · ${lead.buildingName || lead.buildingInterest}`
                            : ""}
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
                    These are people who are not customers yet. Add name and email,
                    then start a conversation from your support mailbox.
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
                      {to || selected?.email || "Add email"}
                      {mailboxLabel ? ` · via ${mailboxLabel}` : ""}
                    </Text>
                  </Box>
                  {selected ? (
                    <Badge colorPalette={statusPalette(selected.status)} variant="subtle">
                      {selected.status}
                    </Badge>
                  ) : null}
                  <IconButton
                    aria-label="Refresh conversation"
                    size="sm"
                    variant="ghost"
                    loading={chatLoading}
                    onClick={() => void openChat(selectedId)}
                  >
                    <FiRefreshCw />
                  </IconButton>
                </Flex>

                {mailConfigured === false ? (
                  <Box
                    mx={3}
                    mt={2}
                    bg="orange.50"
                    color="orange.800"
                    px={3}
                    py={2}
                    borderRadius="md"
                    fontSize="sm"
                    flexShrink={0}
                  >
                    Zoho Mail is not configured. Set ZOHO_MAIL_REFRESH_TOKEN with Mail
                    scopes.
                  </Box>
                ) : null}

                <Box
                  flex="1"
                  overflowY="auto"
                  px={3}
                  py={3}
                  minH={0}
                  bg="bg.muted"
                >
                  {chatLoading && messages.length === 0 ? (
                    <Flex justify="center" py={10}>
                      <Spinner color="brand.600" />
                    </Flex>
                  ) : messages.length === 0 ? (
                    <Text fontSize="sm" color="fg.muted" textAlign="center" py={8}>
                      No messages yet. Write below to start this conversation.
                    </Text>
                  ) : (
                    <Flex direction="column" gap={2.5}>
                      {messages.map((msg) => (
                        <EmailMessageBubble
                          key={msg.id}
                          message={msg}
                          outboundLabel={mailboxName}
                        />
                      ))}
                      <div ref={chatEndRef} />
                    </Flex>
                  )}
                </Box>

                {canMutate ? (
                  <Box
                    borderTopWidth="1px"
                    borderColor="border"
                    bg="bg.panel"
                    px={3}
                    py={2.5}
                    flexShrink={0}
                  >
                    <Flex direction="column" gap={2} mb={2}>
                      <Flex
                        align={{ base: "stretch", sm: "center" }}
                        gap={{ base: 1, sm: 3 }}
                        direction={{ base: "column", sm: "row" }}
                      >
                        <Text
                          fontSize="sm"
                          fontWeight="600"
                          color="fg.muted"
                          w={{ base: "auto", sm: "72px" }}
                          flexShrink={0}
                        >
                          To
                        </Text>
                        <Input
                          size="sm"
                          value={to}
                          onChange={(e) => setTo(e.target.value)}
                          placeholder="Prospect email"
                          borderRadius="md"
                          h="40px"
                          bg={fieldControlStyles.bg}
                          boxShadow={fieldControlStyles.boxShadow}
                        />
                      </Flex>
                      <Flex
                        align={{ base: "stretch", sm: "center" }}
                        gap={{ base: 1, sm: 3 }}
                        direction={{ base: "column", sm: "row" }}
                      >
                        <Text
                          fontSize="sm"
                          fontWeight="600"
                          color="fg.muted"
                          w={{ base: "auto", sm: "72px" }}
                          flexShrink={0}
                        >
                          Subject
                        </Text>
                        <Input
                          size="sm"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          placeholder="Subject"
                          borderRadius="md"
                          h="40px"
                          bg={fieldControlStyles.bg}
                          boxShadow={fieldControlStyles.boxShadow}
                        />
                      </Flex>
                    </Flex>

                    <Box
                      w="full"
                      mb={2}
                      onKeyDown={(e) => {
                        if (
                          (e.ctrlKey || e.metaKey) &&
                          e.key === "Enter" &&
                          canSend
                        ) {
                          e.preventDefault();
                          void sendEmail();
                        }
                      }}
                    >
                      <RichTextEditor
                        value={body}
                        onChange={setBody}
                        disabled={!canMutate}
                        placeholder="Write your message…"
                        minH={isMobile ? "88px" : "110px"}
                      />
                    </Box>

                    {attachments.length > 0 ? (
                      <Flex gap={1.5} flexWrap="wrap" mb={2}>
                        {attachments.map((file) => (
                          <Flex
                            key={`${file.fileName}-${file.size}`}
                            align="center"
                            gap={1}
                            bg="bg.muted"
                            borderRadius="md"
                            px={2}
                            py={1}
                            fontSize="xs"
                          >
                            <FiPaperclip />
                            <Text lineClamp={1} maxW="140px">
                              {file.fileName}
                            </Text>
                            <Text color="fg.muted">{formatBytes(file.size)}</Text>
                            <IconButton
                              aria-label="Remove attachment"
                              size="2xs"
                              variant="ghost"
                              onClick={() =>
                                setAttachments((prev) =>
                                  prev.filter((a) => a !== file)
                                )
                              }
                            >
                              <FiX />
                            </IconButton>
                          </Flex>
                        ))}
                      </Flex>
                    ) : null}

                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      hidden
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.txt,.csv,.zip"
                      onChange={(e) => void onPickFiles(e.target.files)}
                    />

                    <Flex gap={2} align="center" justify="space-between">
                      <Flex gap={2} align="center">
                        <IconButton
                          aria-label="Attach file"
                          size="sm"
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={sending}
                        >
                          <FiPaperclip />
                        </IconButton>
                        <Button
                          size="sm"
                          colorPalette="brand"
                          loading={sending}
                          disabled={!canSend}
                          onClick={() => void sendEmail()}
                        >
                          <FiSend />
                          Send
                        </Button>
                      </Flex>
                      <Text
                        fontSize="2xs"
                        color="fg.muted"
                        display={{ base: "none", md: "block" }}
                      >
                        Ctrl+Enter to send
                        {mailboxLabel ? ` · from ${mailboxLabel}` : ""}
                      </Text>
                    </Flex>
                  </Box>
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
          <Dialog.Title>Add email prospect</Dialog.Title>
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
              <Field.Label>Email</Field.Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@example.com"
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Phone</Field.Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Optional"
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
                disabled={
                  form.name.trim().length < 2 || !form.email.trim().includes("@")
                }
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
