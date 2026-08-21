import { Box, Button, Field, Flex, Stack, Text } from "@chakra-ui/react";
import { DateField } from "../ui/DateField";
import { ModalShell } from "../ui/ModalShell";
import { TISP_STANDARD_DUE_DATE } from "../../lib/tispConstants";
import { formatTitleCase } from "../../lib/formatText";
import type { Customer } from "../../lib/api";

type Props = {
  customers: Customer[];
  dueDate: string;
  loading: boolean;
  onDueDateChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function CreateOnTispDialog({
  customers,
  dueDate,
  loading,
  onDueDateChange,
  onClose,
  onSubmit,
}: Props) {
  if (!customers.length) return null;

  const single = customers.length === 1 ? customers[0] : null;
  const hasB2B = customers.some((c) => c.customerType === "B2B");

  return (
    <ModalShell open onClose={loading ? () => undefined : onClose} maxW="28rem">
      <Box px={5} pt={5} pb={4} pr={12} borderBottomWidth="1px" borderColor="border.muted">
        <Text fontSize="lg" fontWeight="semibold" color="fg">
          Create on TISP
        </Text>
        <Text fontSize="sm" color="fg.muted" mt={1}>
          {single
            ? `${formatTitleCase(single.fullName)} · ${single.customerNumber}`
            : `${customers.length} selected customers`}
        </Text>
      </Box>

      <Stack gap={4} px={5} py={4}>
        <Box bg="brand.50" borderRadius="md" px={3} py={3} fontSize="sm" color="brand.900">
          Creates the TISP account only. Zoho is not updated
          {hasB2B ? ", and the agency is not emailed a new-house invoice" : ""}.
        </Box>
        <Field.Root required>
          <Field.Label>Due date</Field.Label>
          <DateField
            value={dueDate}
            onChange={onDueDateChange}
            placeholder={`Default ${TISP_STANDARD_DUE_DATE}`}
          />
        </Field.Root>
        <Flex justify="flex-end" gap={2}>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            colorPalette="brand"
            loading={loading}
            disabled={!dueDate.trim()}
            onClick={onSubmit}
          >
            {single ? "Create on TISP" : `Create ${customers.length} on TISP`}
          </Button>
        </Flex>
      </Stack>
    </ModalShell>
  );
}
