import { useEffect, useMemo, useState } from "react";
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
import {
  formatCurrency,
  type AgencyInvoicePayload,
  type Customer,
} from "../../lib/api";

type Props = {
  open: boolean;
  mode: "consolidated" | "customer";
  customer?: Customer | null;
  customers: Customer[];
  /** Standing discount % from agency onboarding (e.g. 14.88). */
  defaultDiscountPercent?: number | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (request: AgencyInvoicePayload) => void;
};

function activeBillable(customers: Customer[]) {
  return customers.filter(
    (c) => c.status === "active" && Number(c.packagePrice || 0) > 0
  );
}

function applyUnitDiscount(packagePrice: number, discountPercent: number | null) {
  const price = Math.round(Number(packagePrice) || 0);
  const pct = Number(discountPercent);
  if (!Number.isFinite(pct) || pct <= 0 || price <= 0) return price;
  return Math.round(price * (1 - Math.min(100, pct) / 100));
}

export function AgencyInvoiceDialog({
  open,
  mode,
  customer,
  customers,
  defaultDiscountPercent = null,
  submitting,
  onClose,
  onSubmit,
}: Props) {
  const standingPercent =
    defaultDiscountPercent != null && Number(defaultDiscountPercent) > 0
      ? Number(defaultDiscountPercent)
      : null;

  const [discountEnabled, setDiscountEnabled] = useState(Boolean(standingPercent));
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState(
    standingPercent != null ? String(standingPercent) : ""
  );

  useEffect(() => {
    if (!open) return;
    if (standingPercent != null) {
      setDiscountEnabled(true);
      setDiscountType("percent");
      setDiscountValue(String(standingPercent));
    } else {
      setDiscountEnabled(false);
      setDiscountType("percent");
      setDiscountValue("");
    }
  }, [open, standingPercent]);

  const billable = useMemo(() => {
    if (mode === "customer" && customer) return [customer];
    return activeBillable(customers);
  }, [mode, customer, customers]);

  const billedCount = billable.length;

  const grossSubtotal = useMemo(
    () => billable.reduce((sum, c) => sum + Number(c.packagePrice || 0), 0),
    [billable]
  );

  const percentValue = useMemo(() => {
    if (!discountEnabled || discountType !== "percent") return null;
    const value = Number(discountValue);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(100, value);
  }, [discountEnabled, discountType, discountValue]);

  const netTotal = useMemo(() => {
    if (!discountEnabled) return grossSubtotal;
    const value = Number(discountValue);
    if (!Number.isFinite(value) || value <= 0 || grossSubtotal <= 0) {
      return grossSubtotal;
    }
    if (discountType === "amount") {
      return Math.max(0, grossSubtotal - Math.min(grossSubtotal, value));
    }
    return billable.reduce(
      (sum, c) => sum + applyUnitDiscount(Number(c.packagePrice || 0), value),
      0
    );
  }, [discountEnabled, discountType, discountValue, grossSubtotal, billable]);

  const discountAmount = Math.max(0, grossSubtotal - netTotal);

  const sampleUnit = billable[0] ? Number(billable[0].packagePrice || 0) : 0;
  const sampleDiscountedUnit = applyUnitDiscount(sampleUnit, percentValue);
  const uniformRate =
    billable.length > 0 &&
    billable.every((c) => Number(c.packagePrice || 0) === sampleUnit);

  function handleClose() {
    onClose();
  }

  function handleSubmit() {
    const discount: AgencyInvoicePayload["discount"] =
      discountEnabled && discountAmount > 0
        ? {
            type: discountType,
            value: Number(discountValue),
          }
        : null;

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
        <Dialog.Description fontSize="sm" color="fg.muted" mt={1}>
          {mode === "consolidated"
            ? `${billedCount} active customer${billedCount === 1 ? "" : "s"} will be billed to this agency in Zoho`
            : `${customer?.fullName} · ${formatCurrency(sampleUnit)}`}
        </Dialog.Description>
      </Dialog.Header>

      <Dialog.Body px={5} py={4}>
        <Stack gap={4}>
          <Box
            border="1px solid"
            borderColor="border.muted"
            borderRadius="lg"
            p={3}
            bg="bg.subtle"
          >
            <Flex justify="space-between" fontSize="sm" mb={1}>
              <Text color="fg.muted">List subtotal</Text>
              <Text fontWeight="medium">{formatCurrency(grossSubtotal)}</Text>
            </Flex>
            {percentValue != null && uniformRate ? (
              <Flex justify="space-between" fontSize="sm" mb={1}>
                <Text color="fg.muted">
                  Negotiated rate × {billedCount}
                </Text>
                <Text fontWeight="medium">
                  {formatCurrency(sampleDiscountedUnit)} × {billedCount}
                </Text>
              </Flex>
            ) : null}
            {discountAmount > 0 ? (
              <Flex justify="space-between" fontSize="sm" mb={1}>
                <Text color="fg.muted">
                  Discount
                  {percentValue != null ? ` (${percentValue}%)` : ""}
                </Text>
                <Text fontWeight="medium" color="green.700">
                  −{formatCurrency(discountAmount)}
                </Text>
              </Flex>
            ) : null}
            <Flex
              justify="space-between"
              fontSize="sm"
              pt={discountAmount > 0 || (percentValue != null && uniformRate) ? 2 : 0}
              borderTop={
                discountAmount > 0 || (percentValue != null && uniformRate)
                  ? "1px solid"
                  : undefined
              }
              borderColor="border"
            >
              <Text fontWeight="semibold">Invoice total</Text>
              <Text fontWeight="semibold">{formatCurrency(netTotal)}</Text>
            </Flex>
          </Box>

          <Box
            border="1px solid"
            borderColor="border.muted"
            borderRadius="lg"
            p={3}
            bg="bg.panel"
          >
            <Flex justify="space-between" align="center" mb={discountEnabled ? 3 : 0}>
              <Box>
                <Text fontWeight="semibold" fontSize="sm">
                  Agency discount
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {standingPercent != null
                    ? `Onboarded at ${standingPercent}% — applied to each client rate`
                    : "Optional reduction applied to each client rate on the Zoho invoice"}
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
                    max={discountType === "percent" ? 100 : grossSubtotal}
                    step={discountType === "percent" ? 0.01 : 1}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder="0"
                  />
                </Field.Root>
              </Stack>
            ) : null}
          </Box>
        </Stack>
      </Dialog.Body>

      <Dialog.Footer px={5} py={4} borderTop="1px solid" borderColor="border.muted">
        <Flex gap={2} justify="flex-end" w="full">
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            colorPalette="brand"
            onClick={handleSubmit}
            loading={submitting}
            disabled={grossSubtotal <= 0}
          >
            Create Zoho invoice
          </Button>
        </Flex>
      </Dialog.Footer>
    </AppDialog>
  );
}
