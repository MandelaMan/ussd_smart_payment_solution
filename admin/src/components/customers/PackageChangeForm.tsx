import {
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Grid,
  Input,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useState } from "react";
import {
  formatCurrency,
  formatDate,
  type Customer,
  type Product,
  type PendingUpgrade,
  type UpgradePaymentMethod,
  type UpgradeQuote,
} from "../../lib/api";
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

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <Flex justify="space-between" gap={2} fontSize="xs">
      <Text color="blue.700">{label}</Text>
      <Text fontWeight="medium" textAlign="right">
        {value}
      </Text>
    </Flex>
  );
}

function PaymentMethodTile({
  method,
  selected,
  recommended,
  title,
  description,
  onSelect,
  disabled = false,
}: {
  method: UpgradePaymentMethod;
  selected: boolean;
  recommended: boolean;
  title: string;
  description: string;
  onSelect: (method: UpgradePaymentMethod) => void;
  disabled?: boolean;
}) {
  return (
    <Button
      key={method}
      type="button"
      variant="outline"
      onClick={() => onSelect(method)}
      disabled={disabled}
      flex={1}
      minW={0}
      h="auto"
      py={2}
      px={2.5}
      borderRadius="md"
      borderWidth="2px"
      borderColor={selected ? "brand.500" : "gray.200"}
      bg={selected ? "brand.50" : "white"}
      _hover={{ borderColor: "brand.400" }}
      fontWeight="normal"
      whiteSpace="normal"
    >
      <Stack gap={0.5} align="start" w="full">
        <Flex align="center" gap={1.5} flexWrap="wrap">
          <Text fontWeight="semibold" fontSize="xs">
            {title}
          </Text>
          {recommended ? (
            <Badge colorPalette="green" size="sm">
              Rec.
            </Badge>
          ) : null}
        </Flex>
        <Text fontSize="2xs" color="gray.600" lineHeight="1.3">
          {description}
        </Text>
      </Stack>
    </Button>
  );
}

type Props = {
  mode: "upgrade" | "downgrade";
  customer: Customer;
  packages: Product[];
  productId: string;
  paymentFrequency: Customer["paymentFrequency"];
  customPeriodDays: string;
  upgradeQuote: UpgradeQuote | null;
  upgradeQuoteLoading: boolean;
  pendingUpgrade?: PendingUpgrade | null;
  cancellingPending?: boolean;
  paymentMethod: UpgradePaymentMethod | "";
  loading: boolean;
  dataLoading: boolean;
  onProductChange: (id: string) => void;
  onPaymentFrequencyChange: (frequency: Customer["paymentFrequency"]) => void;
  onCustomPeriodDaysChange: (value: string) => void;
  onPaymentMethodChange: (method: UpgradePaymentMethod) => void;
  onCancelPendingUpgrade?: () => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function PackageChangeForm({
  mode,
  customer,
  packages,
  productId,
  paymentFrequency,
  customPeriodDays,
  upgradeQuote,
  upgradeQuoteLoading,
  pendingUpgrade,
  cancellingPending = false,
  paymentMethod,
  loading,
  dataLoading,
  onProductChange,
  onPaymentFrequencyChange,
  onCustomPeriodDaysChange,
  onPaymentMethodChange,
  onCancelPendingUpgrade,
  onSubmit,
  onCancel,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fieldsDisabled = loading || confirmOpen || dataLoading;

  const isUpgrade = mode === "upgrade";
  const hasPendingUpgrade =
    isUpgrade && customer.upgradePaymentStatus === "payment_pending";
  const upgradeNeedsPayment = isUpgrade && upgradeQuote?.paymentRequired === true;

  const confirmDisabled =
    dataLoading ||
    upgradeQuoteLoading ||
    cancellingPending ||
    hasPendingUpgrade ||
    !productId ||
    packages.length === 0 ||
    (isUpgrade &&
      !!productId &&
      !upgradeQuote &&
      !upgradeQuoteLoading &&
      !hasPendingUpgrade) ||
    (isUpgrade &&
      paymentFrequency === "custom" &&
      (!customPeriodDays || Number(customPeriodDays) < 1)) ||
    (upgradeNeedsPayment && !paymentMethod);

  const billingLabel =
    customer.paymentFrequency === "custom" && customer.customPeriodDays
      ? `Custom (${customer.customPeriodDays} days)`
      : customer.paymentFrequency;

  const selectedProduct = packages.find((p) => String(p.id) === productId);
  const summaryItems: FormSummaryItem[] = [
    { label: "Customer", value: `${customer.fullName} · ${customer.customerNumber}` },
    {
      label: "Current package",
      value: `${customer.productMbps} Mbps · ${formatCurrency(customer.packagePrice)}`,
    },
  ];
  if (selectedProduct) {
    summaryItems.push({
      label: isUpgrade ? "New package" : "Downgrade to",
      value: `${selectedProduct.mbps} Mbps · ${formatCurrency(
        packageDisplayPrice(selectedProduct, paymentFrequency, customPeriodDays),
      )}`,
    });
  }
  if (isUpgrade && upgradeQuote) {
    summaryItems.push({
      label: "Top-up required",
      value: upgradeQuote.paymentRequired
        ? formatCurrency(upgradeQuote.topUpAmount)
        : "None",
    });
    if (upgradeNeedsPayment && paymentMethod) {
      summaryItems.push({
        label: "Payment method",
        value: paymentMethod === "invoice" ? "Zoho invoice" : "M-Pesa STK",
      });
    }
  }

  return (
    <>
    <Stack gap={3} w="full" onMouseDown={(e) => e.stopPropagation()}>
      {hasPendingUpgrade && (
        <Box
          bg="orange.50"
          borderRadius="md"
          px={2.5}
          py={2}
          fontSize="xs"
          color="orange.900"
          borderWidth="1px"
          borderColor="orange.200"
        >
          <Text mb={1.5}>
            An upgrade is already awaiting payment
            {pendingUpgrade?.targetProductMbps
              ? ` (${pendingUpgrade.targetProductMbps} Mbps)`
              : ""}
            . Cancel it to start a new upgrade or wait for payment to complete.
          </Text>
          {onCancelPendingUpgrade ? (
            <Button
              size="xs"
              variant="outline"
              colorPalette="orange"
              loading={cancellingPending}
              onClick={onCancelPendingUpgrade}
            >
              Cancel pending upgrade
            </Button>
          ) : null}
        </Box>
      )}

      <Box
        bg="gray.50"
        borderRadius="md"
        px={2.5}
        py={2}
        fontSize="xs"
        w="full"
        lineHeight="1.4"
      >
        <Text color="gray.500" fontSize="2xs" textTransform="uppercase" letterSpacing="wide">
          Current
        </Text>
        <Text fontWeight="semibold" color="gray.900">
          {customer.productMbps} Mbps · {formatCurrency(customer.packagePrice)} · {billingLabel}
        </Text>
        <Text color="gray.500" truncate title={customer.productName}>
          {customer.productName}
        </Text>
      </Box>

      <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap={3}>
        <Field.Root w="full">
          <Field.Label fontSize="sm">Payment frequency</Field.Label>
          <SelectField
            width="100%"
            disabled={fieldsDisabled}
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
        ) : (
          <Field.Root required w="full">
            <Field.Label fontSize="sm">
              {isUpgrade ? "New package" : "Lower package"}
            </Field.Label>
            {dataLoading ? (
              <Flex align="center" gap={2} h="9">
                <Spinner size="sm" color="brand.600" />
                <Text fontSize="xs" color="gray.500">
                  Loading…
                </Text>
              </Flex>
            ) : packages.length === 0 ? (
              <Text fontSize="xs" color="gray.500" py={2}>
                No packages available.
              </Text>
            ) : (
              <SelectField
                width="100%"
                disabled={fieldsDisabled}
                fieldProps={{
                  value: productId,
                  onChange: (e) => onProductChange(e.target.value),
                }}
              >
                <option value="">Select…</option>
                {packages.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.mbps} Mbps ·{" "}
                    {formatCurrency(packageDisplayPrice(p, paymentFrequency, customPeriodDays))}
                    {p.hasDstv ? " · DSTV" : ""}
                  </option>
                ))}
              </SelectField>
            )}
          </Field.Root>
        )}
      </Grid>

      {paymentFrequency === "custom" && (
        <Field.Root required w="full">
          <Field.Label fontSize="sm">
            {isUpgrade ? "New package" : "Lower package"}
          </Field.Label>
          {dataLoading ? (
            <Flex align="center" gap={2} h="9">
              <Spinner size="sm" color="brand.600" />
              <Text fontSize="xs" color="gray.500">
                Loading…
              </Text>
            </Flex>
          ) : packages.length === 0 ? (
            <Text fontSize="xs" color="gray.500">
              No packages available.
            </Text>
          ) : (
            <SelectField
              width="100%"
              disabled={fieldsDisabled}
              fieldProps={{
                value: productId,
                onChange: (e) => onProductChange(e.target.value),
              }}
            >
              <option value="">Select…</option>
              {packages.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.mbps} Mbps ·{" "}
                  {formatCurrency(packageDisplayPrice(p, paymentFrequency, customPeriodDays))}
                  {p.hasDstv ? " · DSTV" : ""}
                </option>
              ))}
            </SelectField>
          )}
        </Field.Root>
      )}

      {isUpgrade && productId ? (
        <Box w="full">
          {upgradeQuoteLoading ? (
            <Flex align="center" justify="center" gap={2} py={2}>
              <Spinner size="sm" color="brand.600" />
              <Text fontSize="xs" color="gray.500">
                Calculating top-up…
              </Text>
            </Flex>
          ) : upgradeQuote ? (
            <Stack gap={2}>
              <Box
                bg="blue.50"
                borderRadius="md"
                px={2.5}
                py={2}
                borderWidth="1px"
                borderColor="blue.100"
                w="full"
              >
                <Flex justify="space-between" align="center" mb={1.5}>
                  <Text fontWeight="semibold" fontSize="xs" color="blue.900">
                    Upgrade summary
                  </Text>
                  <Text fontWeight="bold" fontSize="sm" color="blue.900">
                    Top-up {formatCurrency(upgradeQuote.topUpAmount)}
                  </Text>
                </Flex>
                <Stack gap={0.5}>
                  <QuoteRow
                    label="Current"
                    value={`${upgradeQuote.currentMbps} Mbps · ${formatCurrency(upgradeQuote.currentPrice)}`}
                  />
                  <QuoteRow
                    label="New"
                    value={`${upgradeQuote.newMbps} Mbps · ${formatCurrency(upgradeQuote.newPrice)}`}
                  />
                  {upgradeQuote.dueDate ? (
                    <QuoteRow
                      label="Due"
                      value={`${formatDate(upgradeQuote.dueDate)}${
                        upgradeQuote.daysUntilDue != null
                          ? ` (${upgradeQuote.daysUntilDue}d)`
                          : ""
                      }`}
                    />
                  ) : null}
                </Stack>
              </Box>

              {upgradeQuote.paymentRequired ? (
                <Field.Root required w="full">
                  <Field.Label fontSize="sm">Payment method</Field.Label>
                  <Flex gap={2} w="full" direction={{ base: "column", sm: "row" }}>
                    <PaymentMethodTile
                      method="invoice"
                      selected={paymentMethod === "invoice"}
                      recommended={upgradeQuote.recommendedPaymentMethod === "invoice"}
                      title="Zoho invoice"
                      description="Upgrade on payment received"
                      onSelect={onPaymentMethodChange}
                      disabled={fieldsDisabled}
                    />
                    <PaymentMethodTile
                      method="stk"
                      selected={paymentMethod === "stk"}
                      recommended={upgradeQuote.recommendedPaymentMethod === "stk"}
                      title="M-Pesa STK"
                      description={`Push to ${customer.phone}`}
                      onSelect={onPaymentMethodChange}
                      disabled={fieldsDisabled}
                    />
                  </Flex>
                </Field.Root>
              ) : (
                <Text fontSize="xs" color="green.700" bg="green.50" px={2.5} py={1.5} borderRadius="md">
                  No additional payment required.
                </Text>
              )}
            </Stack>
          ) : null}
        </Box>
      ) : null}

      <Flex justify="flex-end" gap={2} pt={1}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={fieldsDisabled}>
          Cancel
        </Button>
        <Button
          type="button"
          colorPalette="brand"
          size="sm"
          loading={loading}
          disabled={confirmDisabled}
          onClick={() => setConfirmOpen(true)}
        >
          {isUpgrade && upgradeNeedsPayment
            ? paymentMethod === "invoice"
              ? "Review invoice"
              : paymentMethod === "stk"
                ? "Review STK"
                : "Review"
            : "Review change"}
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
      <Dialog.Header borderBottomWidth="1px" borderColor="gray.100" px={4} py={3} pr={12}>
        <Dialog.Title fontSize="md">
          {isUpgrade ? "Confirm package upgrade" : "Confirm package downgrade"}
        </Dialog.Title>
      </Dialog.Header>
      <Dialog.Body px={4} py={3}>
        <FormSubmitSummary
          description="Changes will sync to TISP and Zoho."
          items={summaryItems}
        />
      </Dialog.Body>
      <Dialog.Footer px={4} py={3} borderTopWidth="1px" borderColor="gray.100" gap={2}>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => setConfirmOpen(false)}>
          Back
        </Button>
        <Button colorPalette="brand" size="sm" loading={loading} onClick={onSubmit}>
          {isUpgrade && upgradeNeedsPayment
            ? paymentMethod === "invoice"
              ? "Create invoice"
              : paymentMethod === "stk"
                ? "Send STK"
                : "Confirm"
            : "Confirm"}
        </Button>
      </Dialog.Footer>
    </AppDialog>
    </>
  );
}
