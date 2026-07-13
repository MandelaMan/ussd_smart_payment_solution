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
import { useState } from "react";
import { formatCurrency, type Customer, type Product } from "../../lib/api";
import { SelectField } from "../ui/SelectField";
import { AppDialog, NESTED_APP_DIALOG_Z_INDEX } from "../ui/AppDialog";
import { FormSubmitSummary, type FormSummaryItem } from "../ui/FormSubmitSummary";

const PAYMENT_FREQUENCY_OPTIONS: Array<{
  value: Customer["paymentFrequency"];
  label: string;
}> = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
];

const DAYS_PER_MONTH = 30;

function priceFromMonthlyBase(monthlyPrice: number, days: number) {
  return Math.round((monthlyPrice * days) / DAYS_PER_MONTH);
}

function packageDisplayPrice(
  product: Product,
  frequency: Customer["paymentFrequency"],
  customPeriodDays: string
) {
  if (frequency === "custom") {
    const days = Number(customPeriodDays);
    if (days >= 1) return priceFromMonthlyBase(product.monthlyPrice, days);
  }
  return product.price;
}

function frequencyLabel(
  frequency: Customer["paymentFrequency"],
  customPeriodDays: number | null | undefined
) {
  if (frequency === "custom" && customPeriodDays) {
    return `Custom (${customPeriodDays} days)`;
  }
  return frequency;
}

type Props = {
  customer: Customer;
  paymentFrequency: Customer["paymentFrequency"];
  customPeriodDays: string;
  previewProduct: Product | null;
  loading: boolean;
  dataLoading?: boolean;
  onPaymentFrequencyChange: (frequency: Customer["paymentFrequency"]) => void;
  onCustomPeriodDaysChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function PaymentFrequencyForm({
  customer,
  paymentFrequency,
  customPeriodDays,
  previewProduct,
  loading,
  dataLoading = false,
  onPaymentFrequencyChange,
  onCustomPeriodDaysChange,
  onSubmit,
  onCancel,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fieldsDisabled = loading || confirmOpen || dataLoading;

  const unchanged =
    paymentFrequency === customer.paymentFrequency &&
    (paymentFrequency !== "custom" ||
      Number(customPeriodDays) === (customer.customPeriodDays ?? 0));

  const customDaysInvalid =
    paymentFrequency === "custom" &&
    (!customPeriodDays || Number(customPeriodDays) < 1);

  const confirmDisabled =
    loading || dataLoading || unchanged || customDaysInvalid || !previewProduct;

  const newPrice = previewProduct
    ? packageDisplayPrice(previewProduct, paymentFrequency, customPeriodDays)
    : null;

  const summaryItems: FormSummaryItem[] = [
    { label: "Customer", value: `${customer.fullName} · ${customer.customerNumber}` },
    {
      label: "Current billing",
      value: `${customer.productMbps} Mbps · ${formatCurrency(customer.packagePrice)} · ${frequencyLabel(customer.paymentFrequency, customer.customPeriodDays)}`,
    },
    {
      label: "New billing",
      value: newPrice != null && previewProduct
        ? `${previewProduct.mbps} Mbps · ${formatCurrency(newPrice)} · ${frequencyLabel(paymentFrequency, Number(customPeriodDays) || null)}`
        : frequencyLabel(paymentFrequency, Number(customPeriodDays) || null),
    },
  ];

  return (
    <>
    <Stack gap={3} w="full" onMouseDown={(e) => e.stopPropagation()}>
      <Box
        bg="bg.subtle"
        borderRadius="md"
        px={2.5}
        py={2}
        fontSize="xs"
        w="full"
        lineHeight="1.4"
      >
        <Text color="fg.muted" fontSize="2xs" textTransform="uppercase" letterSpacing="wide">
          Current
        </Text>
        <Text fontWeight="semibold" color="fg">
          {customer.productMbps} Mbps · {formatCurrency(customer.packagePrice)} ·{" "}
          {frequencyLabel(customer.paymentFrequency, customer.customPeriodDays)}
        </Text>
        <Text color="fg.muted" truncate title={customer.productName}>
          {customer.productName}
        </Text>
      </Box>

      <Field.Root w="full">
        <Field.Label fontSize="sm">New payment frequency</Field.Label>
        <SelectField
          width="100%"
          disabled={fieldsDisabled}
          isLoading={dataLoading}
          fieldProps={{
            value: paymentFrequency,
            onChange: (e) =>
              onPaymentFrequencyChange(e.target.value as Customer["paymentFrequency"]),
          }}
        >
          {PAYMENT_FREQUENCY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </Field.Root>

      {paymentFrequency === "custom" ? (
        <Field.Root required w="full">
          <Field.Label fontSize="sm">Period (days)</Field.Label>
          <Input
            type="number"
            min={1}
            size="sm"
            value={customPeriodDays}
            onChange={(e) => onCustomPeriodDaysChange(e.target.value)}
            placeholder="e.g. 30"
            disabled={fieldsDisabled}
          />
          <Field.HelperText fontSize="2xs">
            Price = monthly base × days ÷ 30
          </Field.HelperText>
        </Field.Root>
      ) : null}

      {newPrice != null && previewProduct && !unchanged ? (
        <Box
          bg="blue.50"
          borderRadius="md"
          px={2.5}
          py={2}
          borderWidth="1px"
          borderColor="blue.100"
          fontSize="xs"
        >
          <Flex justify="space-between" gap={2}>
            <Text color="blue.700">New package price</Text>
            <Text fontWeight="semibold" color="blue.900">
              {formatCurrency(newPrice)}
            </Text>
          </Flex>
          <Text color="blue.700" mt={0.5}>
            Same {customer.productMbps} Mbps plan · {frequencyLabel(paymentFrequency, Number(customPeriodDays) || null)}
          </Text>
        </Box>
      ) : null}

      {!previewProduct && !unchanged && !customDaysInvalid ? (
        <Text fontSize="xs" color="fg.muted">
          No matching package found for this billing frequency.
        </Text>
      ) : null}

      <Flex justify="flex-end" gap={2} pt={1}>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={fieldsDisabled}>
          Cancel
        </Button>
        <Button
          colorPalette="brand"
          size="sm"
          loading={loading}
          disabled={confirmDisabled}
          onClick={() => setConfirmOpen(true)}
        >
          Review change
        </Button>
      </Flex>
    </Stack>

    <AppDialog
      open={confirmOpen}
      onOpenChange={(details) => {
        if (!loading) setConfirmOpen(details.open);
      }}
      maxW="md"
      zIndex={NESTED_APP_DIALOG_Z_INDEX}
    >
      <Dialog.Header borderBottomWidth="1px" borderColor="border.muted" px={4} py={3} pr={12}>
        <Dialog.Title fontSize="md">Confirm billing frequency change</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body px={4} py={3}>
        <FormSubmitSummary
          description="This will update the customer package price and sync to TISP and Zoho."
          items={summaryItems}
        />
      </Dialog.Body>
      <Dialog.Footer px={4} py={3} borderTopWidth="1px" borderColor="border.muted" gap={2}>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => setConfirmOpen(false)}>
          Back
        </Button>
        <Button
          colorPalette="brand"
          size="sm"
          loading={loading}
          onClick={() => {
            onSubmit();
          }}
        >
          Confirm change
        </Button>
      </Dialog.Footer>
    </AppDialog>
    </>
  );
}
