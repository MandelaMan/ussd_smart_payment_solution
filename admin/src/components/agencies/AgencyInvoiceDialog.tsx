import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { AppDialog } from "../ui/AppDialog";
import { SelectField } from "../ui/SelectField";
import { formatCurrency, type AgencyInvoicePayload, type Customer } from "../../lib/api";

type Props = {
  open: boolean;
  mode: "consolidated" | "customer";
  customer?: Customer | null;
  customers: Customer[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (request: AgencyInvoicePayload) => void;
};

function activeBillable(customers: Customer[]) {
  return customers.filter(
    (c) => c.status === "active" && Number(c.packagePrice || 0) > 0
  );
}

export function AgencyInvoiceDialog({
  open,
  mode,
  customer,
  customers,
  submitting,
  onClose,
  onSubmit,
}: Props) {
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("");

  const subtotal = useMemo(() => {
    if (mode === "customer" && customer) {
      return Number(customer.packagePrice || 0);
    }
    return activeBillable(customers).reduce(
      (sum, c) => sum + Number(c.packagePrice || 0),
      0
    );
  }, [mode, customer, customers]);

  const billedCount =
    mode === "customer" ? 1 : activeBillable(customers).length;

  const discountAmount = useMemo(() => {
    if (!discountEnabled) return 0;
    const value = Number(discountValue);
    if (!Number.isFinite(value) || value <= 0 || subtotal <= 0) return 0;
    if (discountType === "amount") return Math.min(subtotal, value);
    return Math.round((subtotal * Math.min(100, value)) / 100);
  }, [discountEnabled, discountType, discountValue, subtotal]);

  const netTotal = Math.max(0, subtotal - discountAmount);

  function handleClose() {
    setDiscountEnabled(false);
    setDiscountType("percent");
    setDiscountValue("");
    onClose();
  }

  function handleSubmit() {
    const discount: AgencyInvoicePayload["discount"] | undefined =
      discountEnabled && discountAmount > 0
        ? {
            type: discountType,
            value: Number(discountValue),
          }
        : undefined;

    if (mode === "customer" && customer) {
      onSubmit({
        mode: "customer",
        customerId: customer.id,
        discount,
      });
      return;
    }

    onSubmit({ mode: "consolidated", discount });
  }

  const title =
    mode === "consolidated"
      ? "Create consolidated Zoho invoice"
      : `Invoice ${customer?.customerNumber || "customer"}`;

  return (
    <AppDialog open={open} onOpenChange={(d) => !d.open && handleClose()} maxW="md">
      <Dialog.Header px={5} pt={5} pb={3} pr={12}>
        <Dialog.Title fontSize="lg">{title}</Dialog.Title>
        <Dialog.Description fontSize="sm" color="gray.500" mt={1}>
          {mode === "consolidated"
            ? `${billedCount} active customer${billedCount === 1 ? "" : "s"} will be billed to this agency in Zoho`
            : `${customer?.fullName} · ${formatCurrency(subtotal)}`}
        </Dialog.Description>
      </Dialog.Header>

      <Dialog.Body px={5} py={4}>
        <Stack gap={4}>
          <Box
            border="1px solid"
            borderColor="gray.100"
            borderRadius="lg"
            p={3}
            bg="gray.50"
          >
            <Flex justify="space-between" fontSize="sm" mb={1}>
              <Text color="gray.600">Subtotal</Text>
              <Text fontWeight="medium">{formatCurrency(subtotal)}</Text>
            </Flex>
            {discountAmount > 0 ? (
              <Flex justify="space-between" fontSize="sm" mb={1}>
                <Text color="gray.600">Discount</Text>
                <Text fontWeight="medium" color="green.700">
                  −{formatCurrency(discountAmount)}
                </Text>
              </Flex>
            ) : null}
            <Flex justify="space-between" fontSize="sm" pt={discountAmount > 0 ? 2 : 0} borderTop={discountAmount > 0 ? "1px solid" : undefined} borderColor="gray.200">
              <Text fontWeight="semibold">Invoice total</Text>
              <Text fontWeight="semibold">{formatCurrency(netTotal)}</Text>
            </Flex>
          </Box>

          <Box
            border="1px solid"
            borderColor="gray.100"
            borderRadius="lg"
            p={3}
            bg="white"
          >
            <Flex justify="space-between" align="center" mb={discountEnabled ? 3 : 0}>
              <Box>
                <Text fontWeight="semibold" fontSize="sm">
                  Agency discount
                </Text>
                <Text fontSize="xs" color="gray.500">
                  Optional reduction applied on the Zoho invoice
                </Text>
              </Box>
              <Button
                size="xs"
                variant={discountEnabled ? "solid" : "outline"}
                colorPalette={discountEnabled ? "brand" : "gray"}
                onClick={() => setDiscountEnabled((v) => !v)}
              >
                {discountEnabled ? "On" : "Off"}
              </Button>
            </Flex>

            {discountEnabled ? (
              <Stack gap={3}>
                <Field.Root>
                  <Field.Label fontSize="xs">Discount type</Field.Label>
                  <SelectField
                    size="sm"
                    fieldProps={{
                      value: discountType,
                      onChange: (e) =>
                        setDiscountType(e.target.value as "percent" | "amount"),
                    }}
                  >
                    <option value="percent">Percentage (%)</option>
                    <option value="amount">Fixed amount (KES)</option>
                  </SelectField>
                </Field.Root>
                <Field.Root>
                  <Field.Label fontSize="xs">
                    {discountType === "percent" ? "Discount percentage" : "Discount amount"}
                  </Field.Label>
                  <Input
                    size="sm"
                    type="number"
                    min={0}
                    max={discountType === "percent" ? 100 : subtotal}
                    step={discountType === "percent" ? 0.1 : 1}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 5000"}
                  />
                </Field.Root>
              </Stack>
            ) : null}
          </Box>
        </Stack>
      </Dialog.Body>

      <Dialog.Footer px={5} py={4} borderTop="1px solid" borderColor="gray.100">
        <Flex gap={2} justify="flex-end" w="full">
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            colorPalette="brand"
            onClick={handleSubmit}
            loading={submitting}
            disabled={subtotal <= 0}
          >
            Create Zoho invoice
          </Button>
        </Flex>
      </Dialog.Footer>
    </AppDialog>
  );
}
