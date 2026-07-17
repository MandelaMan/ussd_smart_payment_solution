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
    <ModalShell open onClose={onClose} maxW="72rem">
      <Flex direction="column" maxH="min(88vh, 740px)" minH={0}>
        <Box
          px={5}
          pt={4}
          pb={3}
          pr={12}
          borderBottomWidth="1px"
          borderColor="border.muted"
          flexShrink={0}
        >
          <Text fontSize="md" fontWeight="semibold" color="fg" lineHeight="short">
            Edit customer
          </Text>
          <Text fontSize="xs" color="fg.muted" mt={0.5} lineHeight="short">
            {customer.fullName} · {customer.customerNumber}
            {customer.status === "cancelled" ? " · Cancelled" : ""}
          </Text>
        </Box>

        <Box flex="1" overflowY="auto" minH={0} px={5} pt={3} pb={2}>
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
