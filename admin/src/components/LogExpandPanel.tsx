import { Box, Grid, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import type { ApiCallLog } from "../lib/api";

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
      bg="gray.50"
      border="1px solid"
      borderColor="gray.100"
      borderRadius="md"
      p={3}
      overflowX="auto"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      maxH="320px"
      overflowY="auto"
    >
      {text}
    </Box>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="gray.500" mb={0.5}>
        {label}
      </Text>
      <Text fontSize="sm">{children}</Text>
    </Box>
  );
}

export function LogExpandPanel({ log }: { log: ApiCallLog }) {
  return (
    <Box bg="gray.50" borderRadius="md" p={4}>
      <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={4} mb={4}>
        <Field label="Service">{log.service.toUpperCase()}</Field>
        <Field label="Operation">{log.operation}</Field>
        <Field label="HTTP status">{log.httpStatus ?? "—"}</Field>
        <Field label="Customer">{log.customerNumber ?? "—"}</Field>
        <Field label="Reference">{log.referenceId ?? "—"}</Field>
        <Field label="Retries">{log.retryCount}</Field>
      </Grid>

      {log.errorMessage ? (
        <Box mb={4}>
          <Text fontSize="xs" fontWeight="semibold" color="red.600" mb={1}>
            Error
          </Text>
          <Text fontSize="sm" color="red.700">
            {log.errorMessage}
          </Text>
        </Box>
      ) : null}

      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={4}>
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="gray.500" mb={1}>
            Request payload
          </Text>
          <JsonBlock value={log.requestPayload} />
        </Box>
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="gray.500" mb={1}>
            Response
          </Text>
          <JsonBlock value={log.responsePayload} />
        </Box>
      </Grid>
    </Box>
  );
}
