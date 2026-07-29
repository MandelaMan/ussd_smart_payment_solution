import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Input,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { FiSend } from "react-icons/fi";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { api, type Customer } from "../../lib/api";
import { canMutateCustomers } from "../../lib/rbac";
import { useAuth } from "../../lib/auth";
import { toaster } from "../ui/toaster";
import { fieldControlStyles } from "../../theme";
import {
  RichTextEditor,
  isRichTextEmpty,
  sanitizeEmailHtml,
} from "../ui/RichTextEditor";

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

export function CustomerEmailChannel() {
  const { user } = useAuth();
  const canMutate = canMutateCustomers(user);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [mailConfigured, setMailConfigured] = useState<boolean | null>(null);

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
      const sorted = [...res.data].sort((a, b) =>
        customerName(a).localeCompare(customerName(b), undefined, {
          sensitivity: "base",
        })
      );
      setCustomers(sorted);
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to load customers",
      });
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    void api
      .getCommunicationStatus()
      .then((s) => setMailConfigured(s.email.configured))
      .catch(() => setMailConfigured(false));
  }, []);

  function pickCustomer(customer: Customer) {
    setSelected(customer);
    setTo(customer.email || "");
    if (!subject) {
      setSubject(`Hello ${customer.firstName || customerName(customer)}`);
    }
  }

  async function sendEmail() {
    if (!canMutate || !selected) return;
    if (isRichTextEmpty(body)) {
      toaster.create({ type: "error", title: "Message body is required" });
      return;
    }
    setSending(true);
    try {
      await api.sendCustomerEmail({
        customerId: selected.id,
        subject: subject.trim(),
        body: sanitizeEmailHtml(body),
        to: to.trim() || undefined,
      });
      toaster.create({ type: "success", title: "Email sent" });
      setBody("");
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
    !isRichTextEmpty(body) &&
    Boolean(to.trim());

  return (
    <Flex
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      bg="bg.panel"
      overflow="hidden"
      h={{ base: "auto", md: "min(720px, calc(100dvh - 200px))" }}
      minH="420px"
      direction={{ base: "column", md: "row" }}
    >
      <Flex
        direction="column"
        w={{ base: "full", md: "320px", lg: "360px" }}
        borderRightWidth={{ base: 0, md: "1px" }}
        borderBottomWidth={{ base: "1px", md: 0 }}
        borderColor="border"
        maxH={{ base: "280px", md: "none" }}
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
                  type="button"
                  w="full"
                  textAlign="left"
                  px={3}
                  py={3}
                  gap={3}
                  borderBottomWidth="1px"
                  borderColor="border.muted"
                  bg={active ? "brand.50" : "transparent"}
                  borderLeftWidth="3px"
                  borderLeftColor={active ? "brand.600" : "transparent"}
                  _hover={{ bg: active ? "brand.50" : "bg.muted" }}
                  onClick={() => pickCustomer(customer)}
                >
                  <Box flex="1" minW={0}>
                    <Text fontWeight="600" fontSize="sm" lineClamp={1}>
                      {name}
                    </Text>
                    <Flex fontSize="xs" color="fg.muted" align="center" gap={1} minW={0}>
                      {missingEmail ? (
                        <Badge colorPalette="orange" variant="subtle" size="sm">
                          No email on file
                        </Badge>
                      ) : (
                        <Text lineClamp={1}>{customer.email}</Text>
                      )}
                      {customer.phone ? (
                        <Text lineClamp={1} flexShrink={0}>
                          · {customer.phone}
                        </Text>
                      ) : null}
                    </Flex>
                  </Box>
                </Flex>
              );
            })
          )}
        </Box>
      </Flex>

      <Flex direction="column" flex="1" minW={0} p={4} gap={3} overflowY="auto">
        {!selected ? (
          <Flex flex="1" align="center" justify="center">
            <Text fontSize="sm" color="fg.muted">
              Select a customer to compose an email.
            </Text>
          </Flex>
        ) : (
          <>
            {mailConfigured === false ? (
              <Box
                bg="orange.50"
                color="orange.800"
                px={3}
                py={2}
                borderRadius="md"
                fontSize="sm"
              >
                Zoho Mail is not configured. Set ZOHO_MAIL_* in .env to send email.
              </Box>
            ) : null}
            <Text fontWeight="600" fontSize="sm">
              To {customerName(selected)}
            </Text>
            <Field.Root>
              <Field.Label>Recipient</Field.Label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="customer@email.com"
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Subject</Field.Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field.Root>
            <Field.Root flex="1" w="full">
              <Field.Label>Message</Field.Label>
              <Box w="full">
                <RichTextEditor
                  value={body}
                  onChange={setBody}
                  disabled={!canMutate}
                  placeholder="Write your message…"
                  minH="240px"
                />
              </Box>
            </Field.Root>
            {canMutate ? (
              <Button
                colorPalette="brand"
                alignSelf="flex-start"
                loading={sending}
                disabled={!canSend}
                onClick={() => void sendEmail()}
              >
                <FiSend />
                Send email
              </Button>
            ) : (
              <Text fontSize="xs" color="fg.muted">
                You have read-only access.
              </Text>
            )}
          </>
        )}
      </Flex>
    </Flex>
  );
}
