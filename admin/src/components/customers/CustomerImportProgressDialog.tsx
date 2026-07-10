import {
  Box,
  Button,
  Flex,
  Progress,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FiCheck, FiX } from "react-icons/fi";
import { ModalShell } from "../ui/ModalShell";
import type { CustomerImportEvent } from "../../lib/api";

export type { CustomerImportEvent };

type Props = {
  open: boolean;
  events: CustomerImportEvent[];
  running: boolean;
  onClose: () => void;
};

function latestForLine(events: CustomerImportEvent[], line: number) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.line === line && event.type === "progress") return event;
  }
  return null;
}

function rowOutcome(events: CustomerImportEvent[], line: number) {
  return events.find(
    (event) =>
      event.line === line &&
      (event.type === "row_done" || event.type === "row_error")
  );
}

export function CustomerImportProgressDialog({
  open,
  events,
  running,
  onClose,
}: Props) {
  const startEvent = events.find((event) => event.type === "start");
  const completeEvent = events.find((event) => event.type === "complete");
  const total = completeEvent?.total ?? startEvent?.total ?? 0;
  const succeeded = completeEvent?.succeeded ?? 0;
  const failed = completeEvent?.failed ?? 0;
  const processed = succeeded + failed;
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;

  const rowStarts = events.filter((event) => event.type === "row_start");
  const currentProgress = [...events]
    .reverse()
    .find((event) => event.type === "progress");

  const canClose = !running;

  return (
    <ModalShell
      open={open}
      onClose={canClose ? onClose : () => {}}
      maxW="40rem"
      showCloseButton={canClose}
    >
      <Box p={5} pr={12}>
        <Stack gap={4}>
          <Box>
            <Text fontSize="lg" fontWeight="bold">
              Importing customers
            </Text>
            <Text fontSize="sm" color="gray.500" mt={1}>
              {running
                ? "Please keep this window open while each customer is created and synced."
                : "Import finished."}
            </Text>
          </Box>

          {total > 0 && (
            <Box>
              <Flex justify="space-between" mb={2} fontSize="sm">
                <Text color="gray.600">
                  {processed} of {total} processed
                </Text>
                <Text color="gray.600">{progressPct}%</Text>
              </Flex>
              <Progress.Root value={progressPct} size="sm" colorPalette="brand">
                <Progress.Track borderRadius="full">
                  <Progress.Range borderRadius="full" />
                </Progress.Track>
              </Progress.Root>
            </Box>
          )}

          {currentProgress && running && (
            <Box
              bg="brand.50"
              border="1px solid"
              borderColor="brand.100"
              borderRadius="lg"
              px={4}
              py={3}
            >
              <Flex align="center" gap={2}>
                <Spinner size="sm" color="brand.600" />
                <Box minW={0}>
                  <Text fontSize="sm" fontWeight="semibold" color="gray.800">
                    Row {currentProgress.line}
                    {currentProgress.customerNumber
                      ? ` · ${currentProgress.customerNumber}`
                      : ""}
                  </Text>
                  <Text fontSize="sm" color="gray.600">
                    {currentProgress.message}
                  </Text>
                </Box>
              </Flex>
            </Box>
          )}

          {rowStarts.length > 0 && (
            <Stack
              gap={2}
              maxH="280px"
              overflowY="auto"
              border="1px solid"
              borderColor="gray.100"
              borderRadius="lg"
              px={3}
              py={3}
            >
              {rowStarts.map((rowStart) => {
                const outcome = rowOutcome(events, rowStart.line!);
                const latest = latestForLine(events, rowStart.line!);
                const isDone = outcome?.type === "row_done";
                const isError = outcome?.type === "row_error";

                return (
                  <Flex key={rowStart.line} align="start" gap={2}>
                    <Box mt="2px" color={isError ? "red.500" : isDone ? "green.600" : "gray.400"}>
                      {isError ? (
                        <FiX />
                      ) : isDone ? (
                        <FiCheck />
                      ) : (
                        <Spinner size="xs" color="gray.400" />
                      )}
                    </Box>
                    <Box minW={0} flex="1">
                      <Text fontSize="sm" fontWeight="medium">
                        Row {rowStart.line}
                        {outcome?.customerNumber ? ` · ${outcome.customerNumber}` : ""}
                      </Text>
                      <Text fontSize="xs" color={isError ? "red.600" : "gray.500"}>
                        {isError
                          ? outcome?.error
                          : isDone
                            ? "Imported successfully"
                            : latest?.message || "Waiting…"}
                      </Text>
                      {isDone && outcome?.tispOk === false && outcome?.tispError && (
                        <Text fontSize="xs" color="orange.600" mt={0.5}>
                          TISP sync warning: {outcome.tispError}
                        </Text>
                      )}
                      {isDone && outcome?.zohoOk === false && outcome?.zohoError && (
                        <Text fontSize="xs" color="orange.600" mt={0.5}>
                          Zoho sync warning: {outcome.zohoError}
                        </Text>
                      )}
                    </Box>
                  </Flex>
                );
              })}
            </Stack>
          )}

          {completeEvent && (
            <Box
              bg={failed > 0 ? "orange.50" : "green.50"}
              border="1px solid"
              borderColor={failed > 0 ? "orange.100" : "green.100"}
              borderRadius="lg"
              px={4}
              py={3}
            >
              <Text fontSize="sm" fontWeight="semibold">
                Imported {succeeded} of {total} customers
              </Text>
              {failed > 0 && (
                <Text fontSize="sm" color="gray.600" mt={1}>
                  {failed} row(s) failed — review the list above for details.
                </Text>
              )}
            </Box>
          )}

          <Flex justify="flex-end">
            <Button
              colorPalette="brand"
              borderRadius="lg"
              disabled={!canClose}
              onClick={onClose}
            >
              {canClose ? "Close" : "Importing…"}
            </Button>
          </Flex>
        </Stack>
      </Box>
    </ModalShell>
  );
}
