import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { FiArrowLeft, FiSend } from "react-icons/fi";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useMobileViewport } from "../../hooks/useMobileViewport";
import { useVisibilityRefresh } from "../../hooks/useVisibilityRefresh";
import {
  api,
  type Customer,
  type Lead,
  type LeadMessage,
} from "../../lib/api";
import { canMutateCustomers } from "../../lib/rbac";
import { useAuth } from "../../lib/auth";
import { toaster } from "../ui/toaster";
import { BRAND, fieldControlStyles } from "../../theme";

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
  /** When set, open this lead in the chat pane (e.g. deep-link). */
  initialLeadId?: number | null;
};

export function CustomerWhatsAppChannel({ initialLeadId = null }: Props) {
  const { user } = useAuth();
  const canMutate = canMutateCustomers(user);
  const isMobile = useMobileViewport();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    null
  );
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null
  );
  const [lead, setLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const bootstrappedLead = useRef(false);

  const loadCustomers = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
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
        const sorted = [...res.data].sort((a, b) =>
          customerName(a).localeCompare(customerName(b), undefined, {
            sensitivity: "base",
          })
        );
        setCustomers(sorted);
      } catch (e) {
        if (!opts?.silent) {
          toaster.create({
            type: "error",
            title: e instanceof Error ? e.message : "Failed to load customers",
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [search]
  );

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useVisibilityRefresh(() => {
    void loadCustomers({ silent: true });
    if (selectedCustomer?.phone) {
      void openCustomerChat(selectedCustomer, { silent: true });
    }
  });

  const openCustomerChat = useCallback(
    async (customer: Customer, opts?: { silent?: boolean }) => {
      setSelectedCustomerId(customer.id);
      setSelectedCustomer(customer);
      setDraft("");
      if (!opts?.silent) setChatLoading(true);
      try {
        const res = await api.getWhatsAppLeadByPhone(customer.phone);
        setLead(res.lead);
        setMessages(res.messages);
      } catch (e) {
        if (!opts?.silent) {
          toaster.create({
            type: "error",
            title: e instanceof Error ? e.message : "Failed to load chat",
          });
        }
        setLead(null);
        setMessages([]);
      } finally {
        setChatLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!initialLeadId || bootstrappedLead.current) return;
    bootstrappedLead.current = true;
    void (async () => {
      setChatLoading(true);
      try {
        const res = await api.getLead(initialLeadId);
        setLead(res.lead);
        setMessages(res.messages);
        const phone = res.lead.phone || res.lead.whatsappWaId;
        if (phone) {
          const match = await api.listCustomers({
            search: phone,
            page: "1",
            limit: "10",
            sortBy: "customerName",
            sortDir: "asc",
          });
          const customer = match.data[0] || null;
          if (customer) {
            setSelectedCustomerId(customer.id);
            setSelectedCustomer(customer);
          }
        }
      } catch (e) {
        toaster.create({
          type: "error",
          title: e instanceof Error ? e.message : "Failed to open chat",
        });
      } finally {
        setChatLoading(false);
      }
    })();
  }, [initialLeadId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selectedCustomerId]);

  async function sendReply() {
    if (!canMutate || !selectedCustomer || !draft.trim()) return;
    setSending(true);
    try {
      const res = await api.sendCustomerWhatsAppMessage({
        phone: selectedCustomer.phone,
        name: customerName(selectedCustomer),
        customerId: selectedCustomer.id,
        body: draft.trim(),
      });
      setMessages(res.messages);
      setLead(res.lead);
      setDraft("");
      if (res.sendMode === "template") {
        toaster.create({
          type: "success",
          title: "Message sent via WhatsApp template",
        });
      }
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to send",
      });
    } finally {
      setSending(false);
    }
  }

  const showList = !isMobile || selectedCustomerId == null;
  const showChat = !isMobile || selectedCustomerId != null;
  const headerName = selectedCustomer
    ? customerName(selectedCustomer)
    : lead?.name || "Conversation";
  const headerPhone =
    selectedCustomer?.phone || lead?.phone || lead?.whatsappWaId || "";

  return (
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
            <Text fontWeight="700" fontSize="md" color="brand.800" mb={2}>
              Customers
            </Text>
            <Input
              size="sm"
              placeholder="Search by name or phone…"
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
            ) : customers.length === 0 ? (
              <Text px={4} py={8} fontSize="sm" color="fg.muted" textAlign="center">
                {search.trim()
                  ? "No customers match that name or phone."
                  : "No customers found."}
              </Text>
            ) : (
              customers.map((customer) => {
                const active = customer.id === selectedCustomerId;
                const name = customerName(customer);
                return (
                  <Flex
                    key={customer.id}
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
                    onClick={() => void openCustomerChat(customer)}
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
                      <Text fontWeight="600" fontSize="sm" lineClamp={1} color="fg">
                        {name}
                      </Text>
                      <Text fontSize="xs" color="fg.muted" lineClamp={1} mt={0.5}>
                        {customer.phone || "—"}
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
          {!selectedCustomerId && !lead ? (
            <Flex flex="1" align="center" justify="center" px={6}>
              <Stack gap={2} textAlign="center" maxW="320px">
                <Text fontWeight="600" color="brand.800">
                  Select a customer
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  Choose a customer on the left to view their WhatsApp chat.
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
                    aria-label="Back to customers"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedCustomerId(null);
                      setSelectedCustomer(null);
                      setLead(null);
                      setMessages([]);
                    }}
                  >
                    <FiArrowLeft />
                  </IconButton>
                ) : null}
                <Flex
                  w="36px"
                  h="36px"
                  borderRadius="full"
                  bg="brand.600"
                  color="white"
                  align="center"
                  justify="center"
                  fontWeight="700"
                  fontSize="sm"
                  flexShrink={0}
                >
                  {headerName.slice(0, 1).toUpperCase()}
                </Flex>
                <Box flex="1" minW={0}>
                  <Text fontWeight="700" fontSize="sm" lineClamp={1}>
                    {headerName}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                    {headerPhone}
                    {selectedCustomer?.customerNumber
                      ? ` · ${selectedCustomer.customerNumber}`
                      : ""}
                  </Text>
                </Box>
                {lead ? (
                  <Badge colorPalette={statusPalette(lead.status)} variant="subtle">
                    {lead.status}
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
                ) : !lead ? (
                  <Stack gap={2} py={8} px={4} textAlign="center">
                    <Text fontSize="sm" color="fg.muted">
                      No WhatsApp messages yet. Type below to start the
                      conversation.
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      First outreach outside WhatsApp’s 24-hour window needs an
                      approved template (set WHATSAPP_OUTBOUND_TEMPLATE).
                    </Text>
                  </Stack>
                ) : messages.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted" textAlign="center" py={8}>
                    No messages in this thread yet.
                  </Text>
                ) : (
                  <Stack gap={2}>
                    {messages.map((m) => {
                      const inbound = m.direction === "inbound";
                      const system = m.channel === "system";
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
                            borderBottomLeftRadius={inbound ? "sm" : "lg"}
                            borderBottomRightRadius={inbound ? "lg" : "sm"}
                            bg={
                              system
                                ? "mindaro.500"
                                : inbound
                                  ? "white"
                                  : "brand.600"
                            }
                            color={
                              system
                                ? "brand.900"
                                : inbound
                                  ? "fg"
                                  : "white"
                            }
                            boxShadow="sm"
                          >
                            {system ? (
                              <Text fontSize="2xs" opacity={0.8} mb={0.5}>
                                Internal note
                              </Text>
                            ) : null}
                            <Text fontSize="sm" whiteSpace="pre-wrap">
                              {m.body}
                            </Text>
                            <Text
                              fontSize="2xs"
                              mt={1}
                              opacity={0.7}
                              textAlign="right"
                            >
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

              {canMutate && selectedCustomer ? (
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
                    placeholder={
                      lead
                        ? "Type a WhatsApp message…"
                        : "Start a WhatsApp conversation…"
                    }
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
                    aria-label="Send WhatsApp message"
                  >
                    <FiSend />
                  </Button>
                </Flex>
              ) : !canMutate ? (
                <Box
                  px={3}
                  py={3}
                  borderTopWidth="1px"
                  borderColor="border"
                  bg="bg.panel"
                >
                  <Text fontSize="xs" color="fg.muted">
                    You have read-only access to WhatsApp chats.
                  </Text>
                </Box>
              ) : null}
            </>
          )}
        </Flex>
      ) : null}
    </Flex>
  );
}
