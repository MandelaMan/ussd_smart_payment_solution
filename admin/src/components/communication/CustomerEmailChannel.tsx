import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Input,
  Spinner,
  Text,
} from "@chakra-ui/react";
import {
  FiArrowLeft,
  FiExternalLink,
  FiPaperclip,
  FiRefreshCw,
  FiSend,
  FiX,
} from "react-icons/fi";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useMobileViewport } from "../../hooks/useMobileViewport";
import { api, type Customer, type CustomerEmailMessage } from "../../lib/api";
import { canMutateCustomers } from "../../lib/rbac";
import { useAuth } from "../../lib/auth";
import { toaster } from "../ui/toaster";
import { ModalShell } from "../ui/ModalShell";
import { fieldControlStyles } from "../../theme";
import {
  RichTextEditor,
  isRichTextEmpty,
  sanitizeEmailHtml,
} from "../ui/RichTextEditor";
import { sanitizeHtml } from "../../lib/sanitizeHtml";

type PendingAttachment = {
  fileName: string;
  contentType: string;
  contentBase64: string;
  size: number;
};

function customerName(customer: Customer): string {
  return (
    customer.fullName ||
    [customer.firstName, customer.middleName, customer.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    customer.customerNumber ||
    `Customer #${customer.id}`
  );
}

/** First letter capital, rest lowercase — e.g. ABDELRAHMAN → Abdelrahman */
function formatGreetingName(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const first = raw.split(/\s+/)[0] || raw;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function defaultEmailSubject(customer: Customer): string {
  const name =
    formatGreetingName(customer.firstName) ||
    formatGreetingName(customerName(customer)) ||
    "Customer";
  return `Dear ${name}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
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
  return d.toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function messageBody(msg: CustomerEmailMessage): string {
  if (msg.bodyHtml) return sanitizeHtml(msg.bodyHtml);
  const text = msg.bodyText || msg.summary || "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function CustomerEmailChannel() {
  const { user } = useAuth();
  const canMutate = canMutateCustomers(user);
  const isMobile = useMobileViewport();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [mailConfigured, setMailConfigured] = useState<boolean | null>(null);
  const [mailboxLabel, setMailboxLabel] = useState(
    "customersupport@sulsolutions.biz"
  );
  const [mailboxName, setMailboxName] = useState("Customer Support");
  const [messages, setMessages] = useState<CustomerEmailMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [emailOnly, setEmailOnly] = useState(false);
  const [poppedOut, setPoppedOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: "1",
        limit: "100",
        sortBy: "customerName",
        sortDir: "asc",
        status: "active",
      };
      if (search.trim()) params.search = search.trim();
      const res = await api.listCustomers(params);
      const rows = Array.isArray(res.data) ? res.data : [];
      let sorted = [...rows].sort((a, b) =>
        customerName(a).localeCompare(customerName(b), undefined, {
          sensitivity: "base",
        })
      );
      if (emailOnly) {
        sorted = sorted.filter((c) => String(c.email || "").trim());
      }
      setCustomers(sorted);
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to load customers",
      });
    } finally {
      setLoading(false);
    }
  }, [search, emailOnly]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    void api
      .getCommunicationStatus()
      .then((s) => {
        setMailConfigured(s.email.configured);
        if (s.email.fromAddress) setMailboxLabel(s.email.fromAddress);
        if (s.email.fromName) setMailboxName(s.email.fromName);
      })
      .catch(() => setMailConfigured(false));
  }, []);

  const loadConversation = useCallback(
    async (customer: Customer, emailOverride?: string) => {
      setThreadLoading(true);
      try {
        const res = await api.listCustomerEmailConversation(
          customer.id,
          emailOverride || customer.email || undefined
        );
        setMessages(res.messages);
        if (res.mailbox?.fromAddress) setMailboxLabel(res.mailbox.fromAddress);
        if (res.mailbox?.fromName) setMailboxName(res.mailbox.fromName);
        const last = res.messages[res.messages.length - 1];
        if (last?.subject) {
          setSubject((prev) =>
            prev.trim()
              ? prev
              : replySubject(last.subject, defaultEmailSubject(customer))
          );
        }
      } catch (e) {
        toaster.create({
          type: "error",
          title: e instanceof Error ? e.message : "Failed to load conversation",
        });
        setMessages([]);
      } finally {
        setThreadLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selected?.id]);

  function pickCustomer(customer: Customer) {
    setSelected(customer);
    setTo(customer.email || "");
    setAttachments([]);
    setBody("");
    setSubject(defaultEmailSubject(customer));
    void loadConversation(customer);
  }

  function clearSelection() {
    setSelected(null);
    setMessages([]);
    setBody("");
    setAttachments([]);
    setPoppedOut(false);
  }

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: PendingAttachment[] = [...attachments];
    for (const file of Array.from(files)) {
      if (next.length >= 5) {
        toaster.create({ type: "error", title: "Maximum 5 attachments" });
        break;
      }
      if (file.size > 8 * 1024 * 1024) {
        toaster.create({
          type: "error",
          title: `${file.name} exceeds 8MB limit`,
        });
        continue;
      }
      try {
        next.push(await fileToBase64(file));
      } catch (e) {
        toaster.create({
          type: "error",
          title: e instanceof Error ? e.message : "Failed to read file",
        });
      }
    }
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function sendEmail() {
    if (!canMutate || !selected) return;
    if (isRichTextEmpty(body) && attachments.length === 0) {
      toaster.create({
        type: "error",
        title: "Add a message or attach a document",
      });
      return;
    }
    setSending(true);
    try {
      const html = isRichTextEmpty(body)
        ? "<p>Please see the attached document(s).</p>"
        : sanitizeEmailHtml(body);
      const res = await api.sendCustomerEmail({
        customerId: selected.id,
        subject: subject.trim(),
        body: html,
        to: to.trim() || undefined,
        attachments: attachments.map(
          ({ fileName, contentType, contentBase64 }) => ({
            fileName,
            contentType,
            contentBase64,
          })
        ),
      });
      toaster.create({ type: "success", title: "Email sent" });
      setBody("");
      setAttachments([]);
      if (res.message) {
        setMessages((prev) => [...prev, res.message as CustomerEmailMessage]);
      } else {
        await loadConversation(selected, to.trim() || undefined);
      }
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to send email",
      });
    } finally {
      setSending(false);
    }
  }

  const canSend =
    Boolean(subject.trim()) &&
    Boolean(to.trim()) &&
    (!isRichTextEmpty(body) || attachments.length > 0);

  const showList = !isMobile || !selected;
  const showThread = !isMobile || Boolean(selected);
  const selectedName = selected ? customerName(selected) : "";

  useEffect(() => {
    if (isMobile) setPoppedOut(false);
  }, [isMobile]);

  return (
    <Flex
      borderWidth="1px"
      borderColor="border"
      borderRadius={{ base: "md", lg: "lg" }}
      bg="bg.panel"
      overflow="hidden"
      flex="1"
      w="full"
      h="100%"
      minH={0}
      direction={{ base: "column", lg: "row" }}
      position="relative"
    >
      {showList ? (
        <Flex
          direction="column"
          w={{ base: "full", lg: "300px", xl: "340px" }}
          borderRightWidth={{ base: 0, lg: "1px" }}
          borderBottomWidth={{ base: selected ? "1px" : 0, lg: 0 }}
          borderColor="border"
          minW={0}
          minH={0}
          flex={{ base: 1, lg: "0 0 auto" }}
          h={{ base: "100%", lg: "100%" }}
        >
          <Box px={3} py={3} borderBottomWidth="1px" borderColor="border" flexShrink={0}>
            <Flex justify="space-between" align="center" mb={2} gap={2}>
              <Text fontWeight="700" fontSize="md" color="brand.800">
                Inbox
              </Text>
              <Badge colorPalette="brand" variant="subtle" size="sm" maxW="50%" lineClamp={1}>
                {mailboxName}
              </Badge>
            </Flex>
            <Input
              size="sm"
              placeholder="Search customers…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              borderRadius="md"
              bg={fieldControlStyles.bg}
              boxShadow={fieldControlStyles.boxShadow}
              mb={2}
            />
            <Flex gap={2} align="center" flexWrap="wrap">
              <Button
                size="xs"
                variant={emailOnly ? "solid" : "outline"}
                colorPalette="brand"
                onClick={() => setEmailOnly((v) => !v)}
              >
                With email
              </Button>
              <Text fontSize="2xs" color="fg.muted" lineClamp={1} minW={0}>
                {mailboxLabel}
              </Text>
            </Flex>
          </Box>
          <Box flex="1" overflowY="auto" minH={0} WebkitOverflowScrolling="touch">
            {loading ? (
              <Flex justify="center" py={10}>
                <Spinner color="brand.600" />
              </Flex>
            ) : customers.length === 0 ? (
              <Text px={4} py={8} fontSize="sm" color="fg.muted" textAlign="center">
                No customers found.
              </Text>
            ) : (
              customers.map((customer) => {
                const active = customer.id === selected?.id;
                const name = customerName(customer);
                const missingEmail = !String(customer.email || "").trim();
                return (
                  <Flex
                    key={customer.id}
                    as="button"
                    w="full"
                    textAlign="left"
                    px={3}
                    py={2.5}
                    gap={3}
                    align="center"
                    borderBottomWidth="1px"
                    borderColor="border.muted"
                    bg={active ? "brand.50" : "transparent"}
                    borderLeftWidth="3px"
                    borderLeftColor={active ? "brand.600" : "transparent"}
                    _hover={{ bg: active ? "brand.50" : "bg.muted" }}
                    onClick={() => pickCustomer(customer)}
                  >
                    <Flex
                      w="36px"
                      h="36px"
                      borderRadius="full"
                      bg={active ? "brand.600" : "brand.100"}
                      color={active ? "white" : "brand.800"}
                      align="center"
                      justify="center"
                      fontSize="xs"
                      fontWeight="700"
                      flexShrink={0}
                    >
                      {initials(name)}
                    </Flex>
                    <Box flex="1" minW={0}>
                      <Text fontWeight="600" fontSize="sm" lineClamp={1}>
                        {name}
                      </Text>
                      {missingEmail ? (
                        <Text fontSize="xs" color="orange.600" lineClamp={1}>
                          Add customer email
                        </Text>
                      ) : (
                        <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                          {customer.email}
                        </Text>
                      )}
                    </Box>
                  </Flex>
                );
              })
            )}
          </Box>
        </Flex>
      ) : null}

      {showThread ? (
        <Flex direction="column" flex="1" minW={0} minH={0}>
          {!selected ? (
            <Flex flex="1" align="center" justify="center" p={6} direction="column" gap={2}>
              <Text fontWeight="600" color="fg.muted">
                Select a customer
              </Text>
              <Text fontSize="sm" color="fg.muted" textAlign="center" maxW="320px">
                Choose someone from the list to view past emails and send a reply
                from {mailboxLabel}.
              </Text>
            </Flex>
          ) : (
            <>
              <Flex
                px={3}
                py={2.5}
                borderBottomWidth="1px"
                borderColor="border"
                align="center"
                gap={2}
                minH="56px"
              >
                {isMobile ? (
                  <IconButton
                    aria-label="Back to list"
                    size="sm"
                    variant="ghost"
                    onClick={clearSelection}
                  >
                    <FiArrowLeft />
                  </IconButton>
                ) : null}
                <Flex
                  w={{ base: "36px", sm: "40px" }}
                  h={{ base: "36px", sm: "40px" }}
                  borderRadius="full"
                  bg="brand.100"
                  color="brand.800"
                  align="center"
                  justify="center"
                  fontSize="sm"
                  fontWeight="700"
                  flexShrink={0}
                >
                  {initials(selectedName)}
                </Flex>
                <Box flex="1" minW={0}>
                  <Text fontWeight="700" fontSize="sm" lineClamp={1}>
                    {selectedName}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                    {to || "Add customer email"}
                    <Text as="span" display={{ base: "none", sm: "inline" }}>
                      {" "}
                      · via {mailboxLabel}
                    </Text>
                  </Text>
                </Box>
                {messages.length > 0 && !poppedOut && !isMobile ? (
                  <IconButton
                    aria-label="Pop out conversation"
                    title="Pop out conversation"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPoppedOut(true)}
                  >
                    <FiExternalLink />
                  </IconButton>
                ) : null}
                <IconButton
                  aria-label="Refresh conversation"
                  size="sm"
                  variant="ghost"
                  loading={threadLoading}
                  onClick={() => void loadConversation(selected, to || undefined)}
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
                  Zoho Mail is not configured. Set ZOHO_MAIL_REFRESH_TOKEN with
                  Mail scopes.
                </Box>
              ) : null}

              {poppedOut ? (
                <Flex
                  flex="1"
                  direction="column"
                  align="center"
                  justify="center"
                  gap={3}
                  bg="bg.muted"
                  minH={0}
                  px={4}
                >
                  <Text fontSize="sm" color="fg.muted" textAlign="center">
                    Conversation with {selectedName} is open in a pop-out window.
                  </Text>
                  <Button size="sm" variant="outline" onClick={() => setPoppedOut(false)}>
                    Return conversation here
                  </Button>
                </Flex>
              ) : (
                <>
              <Box
                flex="1"
                overflowY="auto"
                px={3}
                py={3}
                bg="bg.muted"
                minH={0}
                WebkitOverflowScrolling="touch"
              >
                {threadLoading && messages.length === 0 ? (
                  <Flex justify="center" py={8}>
                    <Spinner color="brand.600" />
                  </Flex>
                ) : messages.length === 0 ? (
                  <Flex
                    direction="column"
                    align="center"
                    justify="center"
                    py={10}
                    gap={1}
                  >
                    <Text fontSize="sm" fontWeight="600" color="fg.muted">
                      No messages yet
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      Write below to start this conversation.
                    </Text>
                  </Flex>
                ) : (
                  <Flex direction="column" gap={2.5}>
                    {messages.map((msg) => {
                      const outbound = msg.direction === "outbound";
                      return (
                        <Flex
                          key={msg.id}
                          justify={outbound ? "flex-end" : "flex-start"}
                        >
                          <Box
                            maxW={{ base: "96%", md: "85%" }}
                            bg={outbound ? "brand.600" : "bg.panel"}
                            color={outbound ? "white" : "fg"}
                            borderWidth={outbound ? 0 : "1px"}
                            borderColor="border"
                            borderRadius="xl"
                            borderBottomRightRadius={outbound ? "sm" : "xl"}
                            borderBottomLeftRadius={outbound ? "xl" : "sm"}
                            px={3}
                            py={2}
                            boxShadow="sm"
                            overflow="visible"
                          >
                            <Text fontSize="xs" fontWeight="700" opacity={0.9} mb={1}>
                              {msg.subject}
                            </Text>
                            <Box
                              fontSize="sm"
                              whiteSpace="normal"
                              overflowWrap="anywhere"
                              css={{
                                "& a": {
                                  color: outbound
                                    ? "white"
                                    : "var(--chakra-colors-brand-600)",
                                  textDecoration: "underline",
                                },
                                "& p": { margin: "0 0 0.35em" },
                                "& p:last-child": { marginBottom: 0 },
                                "& blockquote": {
                                  margin: "0.5em 0",
                                  paddingLeft: "0.75em",
                                  borderLeft: outbound
                                    ? "3px solid rgba(255,255,255,0.45)"
                                    : "3px solid var(--chakra-colors-border)",
                                  opacity: 0.92,
                                },
                                "& img": { maxWidth: "100%", height: "auto" },
                                "& table": { maxWidth: "100%", display: "block", overflowX: "auto" },
                              }}
                              dangerouslySetInnerHTML={{
                                __html: messageBody(msg),
                              }}
                            />
                            {msg.attachmentNames && msg.attachmentNames.length > 0 ? (
                              <Flex gap={1} flexWrap="wrap" mt={1.5}>
                                {msg.attachmentNames.map((name) => (
                                  <Badge
                                    key={`${msg.id}-${name}`}
                                    colorPalette="gray"
                                    variant="subtle"
                                    size="sm"
                                  >
                                    <FiPaperclip /> {name}
                                  </Badge>
                                ))}
                              </Flex>
                            ) : null}
                            <Text fontSize="2xs" opacity={0.75} mt={1.5}>
                              {outbound ? mailboxName : msg.fromAddress || "Customer"}{" "}
                              · {formatMsgTime(msg.createdAt)}
                            </Text>
                          </Box>
                        </Flex>
                      );
                    })}
                    <div ref={threadEndRef} />
                  </Flex>
                )}
              </Box>

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
                      whiteSpace="nowrap"
                    >
                      To
                    </Text>
                    <Input
                      size="sm"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      placeholder="Add customer email"
                      borderRadius="md"
                      px={3}
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
                      whiteSpace="nowrap"
                    >
                      Subject
                    </Text>
                    <Input
                      size="sm"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Subject"
                      borderRadius="md"
                      px={3}
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
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSend) {
                      e.preventDefault();
                      void sendEmail();
                    }
                  }}
                >
                  <RichTextEditor
                    value={body}
                    onChange={setBody}
                    disabled={!canMutate}
                    placeholder="Write your reply…"
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
                            setAttachments((prev) => prev.filter((a) => a !== file))
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

                {canMutate ? (
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
                    <Text fontSize="2xs" color="fg.muted" display={{ base: "none", md: "block" }}>
                      Ctrl+Enter to send · from {mailboxLabel}
                    </Text>
                  </Flex>
                ) : (
                  <Text fontSize="xs" color="fg.muted">
                    You have read-only access.
                  </Text>
                )}
              </Box>
                </>
              )}
            </>
          )}
        </Flex>
      ) : null}

      <ModalShell
        open={Boolean(poppedOut && selected)}
        onClose={() => setPoppedOut(false)}
        maxW="72rem"
        closeOnBackdropClick={false}
      >
        <Flex
          direction="column"
          h={{ base: "100%", sm: "min(820px, calc(100dvh - 4rem))" }}
          minH={0}
          overflow="hidden"
        >
          <Flex
            px={4}
            py={3}
            borderBottomWidth="1px"
            borderColor="border"
            align="center"
            gap={2}
            flexShrink={0}
          >
            <Flex
              w="40px"
              h="40px"
              borderRadius="full"
              bg="brand.100"
              color="brand.800"
              align="center"
              justify="center"
              fontSize="sm"
              fontWeight="700"
              flexShrink={0}
            >
              {initials(selectedName)}
            </Flex>
            <Box flex="1" minW={0}>
              <Text fontWeight="700" fontSize="md" lineClamp={1}>
                {selectedName}
              </Text>
              <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                {to || "Add customer email"} · via {mailboxLabel}
              </Text>
            </Box>
            <IconButton
              aria-label="Refresh conversation"
              size="sm"
              variant="ghost"
              loading={threadLoading}
              onClick={() =>
                selected && void loadConversation(selected, to || undefined)
              }
            >
              <FiRefreshCw />
            </IconButton>
          </Flex>

          <Box flex="1" overflowY="auto" px={4} py={3} bg="bg.muted" minH={0}>
            {messages.length === 0 ? (
              <Text fontSize="sm" color="fg.muted" textAlign="center" py={8}>
                No messages yet.
              </Text>
            ) : (
              <Flex direction="column" gap={2.5}>
                {messages.map((msg) => {
                  const outbound = msg.direction === "outbound";
                  return (
                    <Flex
                      key={`pop-${msg.id}`}
                      justify={outbound ? "flex-end" : "flex-start"}
                    >
                      <Box
                        maxW={{ base: "96%", md: "85%" }}
                        bg={outbound ? "brand.600" : "bg.panel"}
                        color={outbound ? "white" : "fg"}
                        borderWidth={outbound ? 0 : "1px"}
                        borderColor="border"
                        borderRadius="xl"
                        px={3}
                        py={2}
                        boxShadow="sm"
                        overflow="visible"
                      >
                        <Text fontSize="xs" fontWeight="700" mb={1}>
                          {msg.subject}
                        </Text>
                        <Box
                          fontSize="sm"
                          whiteSpace="normal"
                          overflowWrap="anywhere"
                          css={{
                            "& a": {
                              color: outbound
                                ? "white"
                                : "var(--chakra-colors-brand-600)",
                              textDecoration: "underline",
                            },
                            "& p": { margin: "0 0 0.35em" },
                            "& p:last-child": { marginBottom: 0 },
                            "& blockquote": {
                              margin: "0.5em 0",
                              paddingLeft: "0.75em",
                              borderLeft: outbound
                                ? "3px solid rgba(255,255,255,0.45)"
                                : "3px solid var(--chakra-colors-border)",
                              opacity: 0.92,
                            },
                            "& img": { maxWidth: "100%", height: "auto" },
                            "& table": {
                              maxWidth: "100%",
                              display: "block",
                              overflowX: "auto",
                            },
                          }}
                          dangerouslySetInnerHTML={{ __html: messageBody(msg) }}
                        />
                        <Text fontSize="2xs" opacity={0.75} mt={1.5}>
                          {outbound ? mailboxName : msg.fromAddress || "Customer"} ·{" "}
                          {formatMsgTime(msg.createdAt)}
                        </Text>
                      </Box>
                    </Flex>
                  );
                })}
              </Flex>
            )}
          </Box>

          <Box
            borderTopWidth="1px"
            borderColor="border"
            bg="bg.panel"
            px={4}
            py={3}
            flexShrink={0}
          >
            <Flex direction="column" gap={2} mb={2}>
              <Flex align="center" gap={3}>
                <Text fontSize="sm" fontWeight="600" color="fg.muted" w="72px" flexShrink={0}>
                  To
                </Text>
                <Input
                  size="sm"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="Add customer email"
                  borderRadius="md"
                  px={3}
                  h="40px"
                  bg={fieldControlStyles.bg}
                  boxShadow={fieldControlStyles.boxShadow}
                />
              </Flex>
              <Flex align="center" gap={3}>
                <Text fontSize="sm" fontWeight="600" color="fg.muted" w="72px" flexShrink={0}>
                  Subject
                </Text>
                <Input
                  size="sm"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject"
                  borderRadius="md"
                  px={3}
                  h="40px"
                  bg={fieldControlStyles.bg}
                  boxShadow={fieldControlStyles.boxShadow}
                />
              </Flex>
            </Flex>
            <Box w="full" mb={2}>
              <RichTextEditor
                value={body}
                onChange={setBody}
                disabled={!canMutate}
                placeholder="Write your reply…"
                minH="140px"
              />
            </Box>
            {canMutate ? (
              <Flex gap={2}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                >
                  <FiPaperclip />
                  Attach
                </Button>
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
                <Button size="sm" variant="ghost" onClick={() => setPoppedOut(false)}>
                  Dock back
                </Button>
              </Flex>
            ) : null}
          </Box>
        </Flex>
      </ModalShell>
    </Flex>
  );
}
