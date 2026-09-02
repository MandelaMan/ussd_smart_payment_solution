import { Box, Grid, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { formatDateTime, type ApiCallLog } from "../lib/api";

function JsonBlock({ value }: { value: unknown }) {
  const text =
    value == null
      ? "—"
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);

  return (
    <Box
      as="pre"
      fontSize="xs"
      bg="bg.subtle"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="md"
      p={{ base: 2, md: 3 }}
      overflowX="auto"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      maxH={{ base: "220px", md: "320px" }}
      overflowY="auto"
    >
      {text}
    </Box>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={0.5}>
        {label}
      </Text>
      <Text fontSize="sm">{children}</Text>
    </Box>
  );
}

export function LogExpandPanel({ log }: { log: ApiCallLog }) {
  return (
    <Box bg="bg.subtle" borderRadius="md" p={{ base: 2, md: 4 }} w="full">
      <Grid
        templateColumns={{ base: "1fr 1fr", md: "repeat(3, 1fr)" }}
        gap={{ base: 2, md: 4 }}
        mb={{ base: 2.5, md: 4 }}
      >
        <Field label="Service">{log.service.toUpperCase()}</Field>
        <Field label="Operation">{log.operation}</Field>
        <Field label="Called">{formatDateTime(log.createdAt)}</Field>
        <Field label="HTTP status">{log.httpStatus ?? "—"}</Field>
        <Field label="Customer">{log.customerNumber ?? "—"}</Field>
        <Field label="Reference">{log.referenceId ?? "—"}</Field>
        <Field label="Retries">{log.retryCount}</Field>
      </Grid>

      {log.errorMessage ? (
        <Box mb={{ base: 2.5, md: 4 }}>
          <Text fontSize="xs" fontWeight="semibold" color="red.600" mb={1}>
            Error
          </Text>
          <Text fontSize="sm" color="red.700">
            {log.errorMessage}
          </Text>
        </Box>
      ) : null}

      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={{ base: 2.5, md: 4 }}>
        <Box minW={0}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={1}>
            Request payload
          </Text>
          <JsonBlock value={log.requestPayload} />
        </Box>
        <Box minW={0}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={1}>
            Response
          </Text>
          <JsonBlock value={log.responsePayload} />
        </Box>
      </Grid>
    </Box>
  );
}
