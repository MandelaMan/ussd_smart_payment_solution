import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { formatCurrency } from "../../lib/api";
import { formatTitleCase } from "../../lib/formatText";
import type { ReconciliationCustomerDetail } from "../../lib/api";

type Tone = "ok" | "warn" | "error" | "neutral";

export type SystemCheckRow = {
  system: string;
  status: string;
  tone: Tone;
  explanation: string;
};

const TONE_STYLES: Record<Tone, { border: string; bg: string; status: string }> = {
  ok: { border: "green.400", bg: "green.50", status: "green.800" },
  warn: { border: "orange.400", bg: "orange.50", status: "orange.800" },
  error: { border: "red.400", bg: "red.50", status: "red.800" },
  neutral: { border: "gray.300", bg: "gray.50", status: "gray.700" },
};

export function buildSystemChecks(detail: ReconciliationCustomerDetail): SystemCheckRow[] {
  const m = detail.metrics;
  const rows: SystemCheckRow[] = [];

  const accountStatus = m.accountStatus || detail.customer?.status || "unknown";
  const accountActive = String(accountStatus).toLowerCase() === "active";
  const accountCancelled = String(accountStatus).toLowerCase() === "cancelled";

  rows.push({
    system: "Dashboard account",
    status: formatTitleCase(String(accountStatus)),
    tone: accountCancelled ? "error" : accountActive ? "ok" : "warn",
    explanation: accountActive
      ? "Customer record is active and eligible for service"
      : accountCancelled
        ? "Account is cancelled — service should normally be off"
        : "Account status needs review before billing actions",
  });

  const tisp = m.subscriptionStatus || "Unknown";
  const tispActive = tisp === "Active";
  const tispSuspended = tisp === "Suspended";

  let tispTone: Tone = tispActive ? "ok" : tispSuspended ? "error" : "warn";
  let tispExplanation = tispActive
    ? "Internet service is connected on TISP"
    : tispSuspended
      ? "Internet service is suspended on TISP"
      : "TISP status could not be confirmed — sync may be stale";

  if (tispActive && m.outstandingBalance > 0) {
    tispTone = "warn";
    tispExplanation = `Service is on but ${formatCurrency(m.outstandingBalance)} is unpaid in Zoho — customer may owe payment`;
  } else if (tispSuspended && m.outstandingBalance <= 0 && (m.amountPaid > 0 || detail.zohoPayments?.length)) {
    tispTone = "warn";
    tispExplanation = "Service is off but Zoho shows no balance due — payment may need a TISP reconnect";
  } else if (tispSuspended && m.tispDueDate) {
    tispExplanation = `Service suspended — TISP due date was ${new Date(m.tispDueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}`;
  }

  rows.push({
    system: "TISP",
    status: tisp,
    tone: tispTone,
    explanation: tispExplanation,
  });

  if (detail.billedViaAgency || detail.customer?.customerType === "B2B") {
    rows.push({
      system: "Zoho Books",
      status: "Agency billed",
      tone: "neutral",
      explanation: `B2B customer — invoices go to ${detail.agencyName || "the managing agency"}, not individually`,
    });
  } else if (!m.zohoLinked) {
    rows.push({
      system: "Zoho Books",
      status: "Not linked",
      tone: "error",
      explanation: "No Zoho contact found for this customer number — cannot invoice or collect in Zoho Books",
    });
  } else if (m.overdueCount > 0) {
    rows.push({
      system: "Zoho Books",
      status: `${formatCurrency(m.outstandingBalance)} overdue`,
      tone: "error",
      explanation: `${m.overdueCount} overdue invoice${m.overdueCount === 1 ? "" : "s"} — payment required to clear balance`,
    });
  } else if (m.outstandingBalance > 0) {
    rows.push({
      system: "Zoho Books",
      status: `${formatCurrency(m.outstandingBalance)} outstanding`,
      tone: "warn",
      explanation: `${m.unpaidInvoiceCount || 1} open invoice${(m.unpaidInvoiceCount || 1) === 1 ? "" : "s"} awaiting payment`,
    });
  } else {
    rows.push({
      system: "Zoho Books",
      status: "Paid up",
      tone: "ok",
      explanation: "Linked in Zoho Books with no open invoice balance",
    });
  }

  if (!detail.billedViaAgency && detail.customer?.customerType !== "B2B") {
    rows.push({
      system: "Recurring billing",
      status: m.recurringInvoiceActive ? "Active" : "Stopped / missing",
      tone: m.recurringInvoiceActive ? "ok" : "warn",
      explanation: m.recurringInvoiceActive
        ? "Automatic recurring invoice profile is active in Zoho"
        : "No active recurring profile — future invoices may not generate automatically",
    });
  }

  if (m.unmatchedMpesaCount > 0) {
    rows.push({
      system: "M-Pesa",
      status: `${m.unmatchedMpesaCount} unallocated`,
      tone: "warn",
      explanation: "Payment(s) received but not applied to a Zoho invoice — allocate to update billing",
    });
  } else {
    const recentUnmatched = detail.mpesaPayments?.some((p) => !p.matchedToZoho);
    if (recentUnmatched) {
      rows.push({
        system: "M-Pesa",
        status: "Pending allocation",
        tone: "warn",
        explanation: "Recent M-Pesa payment not yet matched to Zoho — verify invoice allocation",
      });
    }
  }

  const extraCodes = new Set([
    "billing_frequency_mismatch",
    "duplicate_open_invoices",
    "credit_with_outstanding",
    "credit_balance",
    "tisp_sync_failed",
    "tisp_status_unknown",
    "zoho_sync_error",
    "tisp_sync_error",
  ]);

  for (const v of detail.validations || []) {
    if (!extraCodes.has(v.code)) continue;
    const tone: Tone =
      v.severity === "critical" ? "error" : v.severity === "high" ? "warn" : "neutral";
    rows.push({
      system: "Other",
      status: formatTitleCase(v.code.replace(/_/g, " ")),
      tone,
      explanation: v.message,
    });
  }

  return rows;
}

type Props = { detail: ReconciliationCustomerDetail };

export function ReconciliationSystemChecks({ detail }: Props) {
  const rows = buildSystemChecks(detail);
  const hasIssue = rows.some((r) => r.tone === "error" || r.tone === "warn");

  return (
    <Box
      border="1px solid"
      borderColor={hasIssue ? "orange.200" : "green.200"}
      borderRadius="md"
      overflow="hidden"
      bg="white"
    >
      <Box
        px={3}
        py={2}
        bg={hasIssue ? "orange.50" : "green.50"}
        borderBottom="1px solid"
        borderColor={hasIssue ? "orange.100" : "green.100"}
      >
        <Text fontSize="sm" fontWeight="semibold" color={hasIssue ? "orange.900" : "green.900"}>
          System status
        </Text>
        <Text fontSize="xs" color={hasIssue ? "orange.800" : "green.800"} mt={0.5}>
          Quick read across dashboard, TISP, and Zoho Books
        </Text>
      </Box>

      <Stack gap={0} divideY="1px" divideColor="gray.100">
        {rows.map((row) => {
          const style = TONE_STYLES[row.tone];
          return (
            <Flex key={`${row.system}-${row.status}`} gap={0} align="stretch">
              <Box w="3px" flexShrink={0} bg={style.border} />
              <Box flex={1} px={3} py={2.5} bg={row.tone !== "ok" ? style.bg : undefined}>
                <Flex
                  justify="space-between"
                  align={{ base: "flex-start", sm: "center" }}
                  gap={2}
                  wrap="wrap"
                  mb={1}
                >
                  <Text fontSize="sm" fontWeight="semibold" color="brand.800">
                    {row.system}
                  </Text>
                  <Text fontSize="sm" fontWeight="bold" color={style.status}>
                    {row.status}
                  </Text>
                </Flex>
                <Text fontSize="xs" color="gray.700" lineHeight="1.45">
                  {row.explanation}
                </Text>
              </Box>
            </Flex>
          );
        })}
      </Stack>
    </Box>
  );
}
