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

function SettlementLine({
  label,
  value,
  muted,
  strong,
  negative,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <Flex justify="space-between" align="baseline" gap={3}>
      <Text
        fontSize={strong ? "sm" : "xs"}
        fontWeight={strong ? "semibold" : "normal"}
        color={muted ? "gray.500" : "gray.700"}
      >
        {label}
      </Text>
      <Text
        fontSize={strong ? "sm" : "xs"}
        fontWeight={strong ? "bold" : "medium"}
        color={negative ? "green.700" : strong ? "gray.900" : "gray.800"}
        fontVariantNumeric="tabular-nums"
        textAlign="right"
      >
        {value}
      </Text>
    </Flex>
  );
}

function PackageChangeSettlement({
  mode,
  quote,
}: {
  mode: "upgrade" | "downgrade";
  quote: UpgradeQuote;
}) {
  const isUpgrade = mode === "upgrade";
  const remainingCredit = quote.remainingCredit ?? 0;
  const creditAmount = quote.creditAmount ?? 0;
  const needsPayment = quote.paymentRequired;
  const showCreditLine = remainingCredit > 0;
  const resultLabel = needsPayment
    ? "Amount due"
    : creditAmount > 0
      ? "Credit"
      : "Amount due";
  const resultValue = needsPayment
    ? formatCurrency(quote.topUpAmount)
    : creditAmount > 0
      ? formatCurrency(creditAmount)
      : formatCurrency(0);

  return (
    <Box
      bg="white"
      borderRadius="md"
      borderWidth="1px"
      borderColor="gray.200"
      overflow="hidden"
      w="full"
    >
      <Flex
        px={3}
        py={2}
        bg="gray.50"
        borderBottomWidth="1px"
        borderColor="gray.100"
        align="center"
        justify="space-between"
        gap={2}
      >
        <Text fontSize="xs" fontWeight="semibold" color="gray.800">
          {isUpgrade ? "Payment breakdown" : "Credit breakdown"}
        </Text>
        {quote.daysRemainingInPeriod != null && quote.daysRemainingInPeriod > 0 ? (
          <Text fontSize="2xs" color="gray.500">
            {quote.daysRemainingInPeriod} day
            {quote.daysRemainingInPeriod === 1 ? "" : "s"} left on current plan
          </Text>
        ) : null}
      </Flex>

      <Box px={3} py={2.5}>
        <Flex gap={2} mb={3}>
          <Box flex="1" minW={0} bg="gray.50" borderRadius="md" px={2.5} py={2}>
            <Text fontSize="2xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
              From
            </Text>
            <Text fontSize="sm" fontWeight="semibold" color="gray.900" lineHeight="1.3">
              {quote.currentMbps} Mbps
            </Text>
            <Text fontSize="xs" color="gray.600">
              {formatCurrency(quote.currentPrice)}
            </Text>
          </Box>
          <Flex align="center" color="gray.400" flexShrink={0} aria-hidden>
            →
          </Flex>
          <Box flex="1" minW={0} bg="brand.50" borderRadius="md" px={2.5} py={2}>
            <Text fontSize="2xs" color="brand.700" textTransform="uppercase" letterSpacing="wide">
              To
            </Text>
            <Text fontSize="sm" fontWeight="semibold" color="brand.800" lineHeight="1.3">
              {quote.newMbps} Mbps
            </Text>
            <Text fontSize="xs" color="brand.700">
              {formatCurrency(quote.newPrice)}
            </Text>
          </Box>
        </Flex>

        <Stack
          gap={1.5}
          pt={2}
          borderTopWidth="1px"
          borderColor="gray.100"
        >
          <SettlementLine label="New package" value={formatCurrency(quote.newPrice)} />
          {showCreditLine ? (
            <SettlementLine
              label={
                quote.daysRemainingInPeriod != null
                  ? `Unused days credit (${quote.daysRemainingInPeriod}d)`
                  : "Unused days credit"
              }
              value={`− ${formatCurrency(remainingCredit)}`}
              negative
            />
          ) : null}
          {!isUpgrade && !showCreditLine && creditAmount > 0 ? (
            <SettlementLine
              label="Prorated price drop"
              value={`− ${formatCurrency(creditAmount)}`}
              negative
            />
          ) : null}
          <Box borderTopWidth="1px" borderColor="gray.200" pt={1.5} mt={0.5}>
            <SettlementLine
              label={resultLabel}
              value={resultValue}
              strong
              negative={!needsPayment && creditAmount > 0}
            />
          </Box>
        </Stack>

        {quote.dueDate ? (
          <Text fontSize="2xs" color="gray.500" mt={2}>
            Current period ends {formatDate(quote.dueDate)}
            {quote.daysUntilDue != null ? ` · ${quote.daysUntilDue}d remaining` : ""}
          </Text>
        ) : null}
      </Box>
    </Box>
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
  const needsPayment = Boolean(upgradeQuote?.paymentRequired);

  const confirmDisabled =
    dataLoading ||
    upgradeQuoteLoading ||
    cancellingPending ||
    hasPendingUpgrade ||
    !productId ||
    packages.length === 0 ||
    (!!productId && !upgradeQuote && !upgradeQuoteLoading && !hasPendingUpgrade) ||
    (paymentFrequency === "custom" &&
      (!customPeriodDays || Number(customPeriodDays) < 1)) ||
    (needsPayment && !paymentMethod);

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
  if (upgradeQuote) {
    if (isUpgrade) {
      summaryItems.push({
        label: "Top-up required",
        value: upgradeQuote.paymentRequired
          ? formatCurrency(upgradeQuote.topUpAmount)
          : "None",
      });
    } else {
      summaryItems.push({
        label: (upgradeQuote.creditAmount ?? 0) > 0 ? "Credit" : "Top-up",
        value:
          (upgradeQuote.creditAmount ?? 0) > 0
            ? formatCurrency(upgradeQuote.creditAmount ?? 0)
            : upgradeQuote.paymentRequired
              ? formatCurrency(upgradeQuote.topUpAmount)
              : "None",
      });
    }
    if (needsPayment && paymentMethod) {
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
                {isUpgrade
                  ? "No higher-priced packages for this billing frequency."
                  : "No lower-priced packages for this billing frequency."}
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
              {isUpgrade
                ? "No higher-priced packages for this billing frequency."
                : "No lower-priced packages for this billing frequency."}
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

      {productId ? (
        <Box w="full">
          {upgradeQuoteLoading ? (
            <Flex align="center" justify="center" gap={2} py={2}>
              <Spinner size="sm" color="brand.600" />
              <Text fontSize="xs" color="gray.500">
                {isUpgrade ? "Calculating top-up…" : "Calculating credit…"}
              </Text>
            </Flex>
          ) : upgradeQuote ? (
            <Stack gap={2}>
              <PackageChangeSettlement mode={mode} quote={upgradeQuote} />

              {needsPayment ? (
                <Field.Root required w="full">
                  <Field.Label fontSize="sm">Payment method</Field.Label>
                  <Flex gap={2} w="full" direction={{ base: "column", sm: "row" }}>
                    <PaymentMethodTile
                      method="invoice"
                      selected={paymentMethod === "invoice"}
                      recommended={upgradeQuote.recommendedPaymentMethod === "invoice"}
                      title="Zoho invoice"
                      description="Apply on payment received"
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
                <Text
                  fontSize="xs"
                  color="green.700"
                  bg="green.50"
                  px={2.5}
                  py={1.5}
                  borderRadius="md"
                >
                  {isUpgrade
                    ? "No additional payment required."
                    : (upgradeQuote.creditAmount ?? 0) > 0
                      ? "No payment required — unused period value is credited."
                      : "No payment required."}
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
          {needsPayment
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
          {needsPayment
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
