import { Box, Flex, Text } from "@chakra-ui/react";
import type { Customer } from "../../lib/api";
import { ModalShell } from "../ui/ModalShell";
import { CustomerForm } from "./CustomerForm";

type Props = {
  customer: Customer | null;
  onClose: () => void;
  onSaved: (customer: Customer, tisp?: { ok: boolean; error?: string }) => void;
};

export function CustomerEditDialog({ customer, onClose, onSaved }: Props) {
  if (!customer) return null;

  return (
    <ModalShell open onClose={onClose} maxW="56rem">
      <Flex direction="column" maxH="min(90vh, 880px)">
        <Box
          px={5}
          pt={5}
          pb={4}
          pr={12}
          borderBottomWidth="1px"
          borderColor="gray.100"
          flexShrink={0}
        >
          <Text fontSize="lg" fontWeight="semibold" color="gray.900">
            Edit customer
          </Text>
          <Text fontSize="xs" color="gray.500" mt={0.5}>
            {customer.fullName} · {customer.customerNumber}
            {customer.status === "cancelled" ? " · Cancelled" : ""}
          </Text>
        </Box>

        <Box flex="1" overflowY="auto" px={5} py={4}>
          <CustomerForm
            customer={customer}
            embedded
            onUpdated={(updated, tisp) => onSaved(updated, tisp)}
            onCancel={onClose}
          />
        </Box>
      </Flex>
    </ModalShell>
  );
}
