import { useEffect, useState, type ReactNode } from "react";
import { Badge, Box, Flex, Grid, Text } from "@chakra-ui/react";
import { FiCreditCard, FiFileText, FiWifi } from "react-icons/fi";
import {
  api,
  formatCurrency,
  formatDate,
  type IntegrationEventDetail,
  type MpesaTransactionDetail,
} from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { TransactionExpandSkeleton } from "./PageSkeletons";

type Props = {
  source: "mpesa" | "zoho" | "tisp";
  id: number;
};

const SOURCE_META = {
  mpesa: {
    title: "M-Pesa Payment",
    color: "brand",
    icon: FiCreditCard,
    accent: "brand.600",
  },
  zoho: {
    title: "Zoho Books Invoice",
    color: "blue",
    icon: FiFileText,
    accent: "blue.600",
  },
  tisp: {
    title: "TISP Reconnection",
    color: "teal",
    icon: FiWifi,
    accent: "teal.600",
  },
} as const;

export function TransactionExpandPanel({ source, id }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mpesa, setMpesa] = useState<MpesaTransactionDetail | null>(null);
  const [integration, setIntegration] = useState<IntegrationEventDetail | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    const load =
      source === "mpesa"
        ? api.getMpesaTransaction(id).then(setMpesa)
        : api.getIntegrationEvent(id).then((r) => setIntegration(r.event));

    load.catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [source, id]);

  if (loading) {
    return <TransactionExpandSkeleton />;
  }

  if (error) {
    return (
      <Box bg="red.50" borderRadius="md" px={4} py={3} fontSize="sm" color="red.700">
        {error}
      </Box>
    );
  }

  if (source === "mpesa" && mpesa) {
    return <MpesaPanel data={mpesa} />;
  }

  if (integration) {
    return source === "zoho" ? (
      <ZohoPanel event={integration} />
    ) : (
      <TispPanel event={integration} />
    );
  }

  return null;
}

function PanelShell({
  source,
  amount,
  status,
  subtitle,
  badge,
  children,
}: {
  source: keyof typeof SOURCE_META;
  amount: number | null;
  status: string;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const meta = SOURCE_META[source];
  const Icon = meta.icon;

  return (
    <Box
      bg="white"
      borderRadius="lg"
      border="1px solid"
      borderColor="gray.200"
      overflow="hidden"
      boxShadow="sm"
    >
      <Flex
        direction={{ base: "column", sm: "row" }}
        align={{ base: "stretch", sm: "center" }}
        justify="space-between"
        gap={3}
        px={3}
        py={3}
        bg="gray.50"
        borderBottom="1px solid"
        borderColor="gray.100"
        borderLeft="4px solid"
        borderLeftColor={meta.accent}
        minW={0}
      >
        <Flex align="center" gap={3} minW={0} flex="1">
          <Flex
            boxSize="36px"
            borderRadius="lg"
            bg="white"
            border="1px solid"
            borderColor="gray.200"
            align="center"
            justify="center"
            color={meta.accent}
            flexShrink={0}
          >
            <Icon size={18} />
          </Flex>
          <Box minW={0} overflow="hidden">
            <Text fontWeight="semibold" fontSize="sm" color="gray.800">
              {meta.title}
            </Text>
            {subtitle && (
              <Text fontSize="xs" color="gray.500" truncate>
                {subtitle}
              </Text>
            )}
          </Box>
        </Flex>
        <Flex
          align="center"
          gap={2}
          flexShrink={0}
          flexWrap="wrap"
          justify={{ base: "flex-start", sm: "flex-end" }}
          minW={0}
        >
          {badge}
          {amount != null && (
            <Text fontWeight="bold" fontSize="lg" color="gray.900" letterSpacing="-0.02em" whiteSpace="nowrap">
              {formatCurrency(amount)}
            </Text>
          )}
          <StatusBadge status={status} />
        </Flex>
      </Flex>
      <Box p={3}>{children}</Box>
    </Box>
  );
}

function DetailGrid({ children }: { children: ReactNode }) {
  return (
    <Grid
      templateColumns={{ base: "1fr 1fr", md: "repeat(3, 1fr)", lg: "repeat(4, 1fr)" }}
      gap={3}
    >
      {children}
    </Grid>
  );
}

function DetailCard({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <Box
      bg={highlight ? "brand.50" : "gray.50"}
      border="1px solid"
      borderColor={highlight ? "brand.100" : "gray.100"}
      borderRadius="md"
      px={3}
      py={3}
      minH="56px"
    >
      <Text
        fontSize="2xs"
        fontWeight="semibold"
        color="gray.500"
        textTransform="uppercase"
        letterSpacing="0.04em"
        mb={1}
      >
        {label}
      </Text>
      <Box
        fontSize="sm"
        fontWeight="medium"
        color="gray.800"
        fontFamily={mono ? "mono" : undefined}
        wordBreak={mono ? "break-all" : undefined}
        lineHeight="1.35"
      >
        {value || <Text as="span" color="gray.400">—</Text>}
      </Box>
    </Box>
  );
}

function IntegrationLinks({
  items,
}: {
  items: Array<{ id: number; source: string; status: string; outcome: string | null }>;
}) {
  if (!items.length) return null;

  return (
    <Box mt={4}>
      <Text fontSize="xs" fontWeight="semibold" color="gray.500" mb={2} textTransform="uppercase" letterSpacing="0.04em">
        Linked integrations
      </Text>
      <Flex gap={2} flexWrap="wrap">
        {items.map((i) => (
          <Flex
            key={i.id}
            align="center"
            gap={2}
            bg="white"
            border="1px solid"
            borderColor="gray.200"
            borderRadius="sm"
            pl={3}
            pr={2}
            py={1.5}
            fontSize="sm"
          >
            <Text textTransform="capitalize" fontWeight="medium" color="gray.700">
              {i.source}
            </Text>
            <Text fontSize="xs" color="gray.500">
              {i.outcome || i.status}
            </Text>
            <StatusBadge status={i.status} />
          </Flex>
        ))}
      </Flex>
    </Box>
  );
}

function MpesaPanel({ data }: { data: MpesaTransactionDetail }) {
  const { transaction: t, integrations } = data;

  return (
    <PanelShell
      source="mpesa"
      amount={t.amount}
      status={t.status}
      subtitle={t.accountReference || t.phone || undefined}
    >
      <DetailGrid>
        <DetailCard label="Receipt" value={t.mpesaReceipt} mono highlight />
        <DetailCard label="Amount" value={formatCurrency(t.amount)} highlight />
        <DetailCard label="Account" value={t.accountReference} />
        <DetailCard label="Phone" value={t.phone} mono />
        <DetailCard label="Channel" value={t.channel} />
        <DetailCard label="Checkout ID" value={t.checkoutRequestId} mono />
        <DetailCard label="Date" value={formatDate(t.createdAt)} />
        <DetailCard label="Result" value={t.resultDesc} />
      </DetailGrid>
      <IntegrationLinks items={integrations} />
    </PanelShell>
  );
}

function ZohoPanel({ event }: { event: IntegrationEventDetail }) {
  const result = event.payload?.result as Record<string, unknown> | undefined;
  const strategy = result?.strategy ? String(result.strategy) : "";
  const zohoAction =
    strategy === "created_and_paid"
      ? "created"
      : event.status === "paid" || event.status === "success"
        ? "updated"
        : null;
  const strategyLabel = strategy ? strategy.replace(/_/g, " ") : null;

  return (
    <PanelShell
      source="zoho"
      amount={event.amount}
      status={event.status}
      subtitle={event.customerNo || undefined}
      badge={
        zohoAction ? (
          <Badge
            colorPalette={zohoAction === "created" ? "green" : "orange"}
            variant="outline"
          >
            {zohoAction === "created" ? "Invoice Created" : "Invoice Updated"}
          </Badge>
        ) : undefined
      }
    >
      <DetailGrid>
        <DetailCard label="Customer" value={event.customerNo} highlight />
        <DetailCard label="Amount" value={formatCurrency(event.amount)} highlight />
        <DetailCard
          label="Invoice ID"
          value={String(event.referenceId || result?.invoice_id || "")}
          mono
        />
        <DetailCard
          label="Invoice #"
          value={result?.invoice_number ? String(result.invoice_number) : undefined}
        />
        <DetailCard label="Strategy" value={strategyLabel} />
        <DetailCard label="Channel" value={event.channel} />
        <DetailCard label="M-Pesa receipt" value={event.mpesaReceipt} mono />
        <DetailCard label="Date" value={formatDate(event.createdAt)} />
      </DetailGrid>
      {result?.reason != null && result.reason !== "" && (
        <Box mt={3} px={3} py={2} bg="blue.50" borderRadius="md" fontSize="sm" color="blue.800">
          {String(result.reason)}
        </Box>
      )}
    </PanelShell>
  );
}

function TispPanel({ event }: { event: IntegrationEventDetail }) {
  const ok = event.outcome === "success";

  return (
    <PanelShell
      source="tisp"
      amount={event.amount}
      status={ok ? "success" : "failed"}
      subtitle={event.customerNo || undefined}
    >
      <DetailGrid>
        <DetailCard label="Customer" value={event.customerNo} highlight />
        <DetailCard label="Amount" value={formatCurrency(event.amount)} highlight />
        <DetailCard label="Transaction ref" value={event.referenceId} mono />
        <DetailCard label="Outcome" value={event.outcome} />
        <DetailCard label="Channel" value={event.channel} />
        <DetailCard label="Phone" value={event.phone} mono />
        <DetailCard label="Account" value={event.accountReference} />
        <DetailCard label="Date" value={formatDate(event.createdAt)} />
      </DetailGrid>
      <Flex
        mt={3}
        align="center"
        gap={2}
        px={3}
        py={2.5}
        borderRadius="md"
        bg={ok ? "green.50" : "red.50"}
        border="1px solid"
        borderColor={ok ? "green.100" : "red.100"}
      >
        <Badge colorPalette={ok ? "green" : "red"} variant="subtle">
          {ok ? "Reconnected" : "Failed"}
        </Badge>
        <Text fontSize="sm" color={ok ? "green.800" : "red.800"}>
          {ok
            ? "Customer service was successfully restored on TISP."
            : event.outcome || "Reconnection attempt failed."}
        </Text>
      </Flex>
    </PanelShell>
  );
}
