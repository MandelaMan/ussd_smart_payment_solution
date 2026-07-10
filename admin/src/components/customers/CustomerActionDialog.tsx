import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Field,
  Flex,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { formatTitleCase } from "../../lib/formatText";
import { type ApartmentHistoryEntry, type Customer } from "../../lib/api";
import { ModalShell } from "../ui/ModalShell";
import {
  ApartmentHistoryTimeline,
  ApartmentHistoryTimelineSkeleton,
} from "../apartments/ApartmentHistoryTimeline";
import { PackageChangeForm } from "./PackageChangeForm";
import { PaymentFrequencyForm } from "./PaymentFrequencyForm";
import type { CustomerAction } from "./CustomerActionMenu";
import type { Product, PendingUpgrade, UpgradePaymentMethod, UpgradeQuote } from "../../lib/api";

type Props = {
  customer: Customer | null;
  actionType: CustomerAction | null;
  actionProductId: string;
  newApartment: string;
  cancelNotes: string;
  actionPackages: Product[];
  apartmentHistory: ApartmentHistoryEntry[];
  upgradeQuote: UpgradeQuote | null;
  upgradeQuoteLoading: boolean;
  pendingUpgrade?: PendingUpgrade | null;
  cancellingPendingUpgrade?: boolean;
  upgradePaymentMethod: UpgradePaymentMethod | "";
  actionPaymentFrequency: Customer["paymentFrequency"];
  actionCustomPeriodDays: string;
  billingPreviewProduct: Product | null;
  loading: boolean;
  dataLoading: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onProductChange: (id: string) => void;
  onPaymentFrequencyChange: (frequency: Customer["paymentFrequency"]) => void;
  onCustomPeriodDaysChange: (value: string) => void;
  onPaymentMethodChange: (method: UpgradePaymentMethod) => void;
  onCancelPendingUpgrade?: () => void;
  onApartmentChange: (value: string) => void;
  onNotesChange: (value: string) => void;
};

function ModalHeader({
  title,
  subtitle,
  compact,
}: {
  title: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <Box
      px={compact ? 4 : 5}
      pt={compact ? 3.5 : 5}
      pb={compact ? 2.5 : 4}
      pr={compact ? 12 : 14}
      borderBottomWidth="1px"
      borderColor="gray.100"
    >
      <Text fontSize={compact ? "md" : "lg"} fontWeight="semibold" color="gray.900">
        {title}
      </Text>
      {subtitle ? (
        <Text fontSize="xs" color="gray.500" mt={0.5} truncate title={subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </Box>
  );
}

export function CustomerActionDialog({
  customer,
  actionType,
  actionProductId,
  newApartment,
  cancelNotes,
  actionPackages,
  apartmentHistory,
  upgradeQuote,
  upgradeQuoteLoading,
  pendingUpgrade,
  cancellingPendingUpgrade,
  upgradePaymentMethod,
  actionPaymentFrequency,
  actionCustomPeriodDays,
  billingPreviewProduct,
  loading,
  dataLoading,
  onClose,
  onSubmit,
  onProductChange,
  onPaymentFrequencyChange,
  onCustomPeriodDaysChange,
  onPaymentMethodChange,
  onCancelPendingUpgrade,
  onApartmentChange,
  onNotesChange,
}: Props) {
  const [cancelStep, setCancelStep] = useState<1 | 2>(1);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);

  useEffect(() => {
    setCancelStep(1);
    setDeleteStep(1);
  }, [actionType, customer?.id]);

  if (!actionType) return null;

  const subtitle =
    customer && actionType !== "history"
      ? `${formatTitleCase(customer.fullName)} · ${customer.customerNumber}`
      : undefined;

  let title = "";
  if (actionType === "upgrade") title = "Upgrade package";
  if (actionType === "downgrade") title = "Downgrade package";
  if (actionType === "changePaymentFrequency") title = "Update frequency";
  if (actionType === "switch") title = "Move apartment";
  if (actionType === "cancel") title = "Cancel subscription";
  if (actionType === "deletePermanent") title = "Delete customer permanently";
  if (actionType === "history") {
    title = `Apartment history — ${customer?.apartmentNumber ?? ""}`;
  }

  const isPackageChange = actionType === "upgrade" || actionType === "downgrade";
  const isBillingChange = actionType === "changePaymentFrequency";

  return (
    <ModalShell
      open
      onClose={onClose}
      maxW={
        actionType === "history"
          ? "56rem"
          : isPackageChange || isBillingChange
            ? "36rem"
            : "32rem"
      }
    >
      <ModalHeader title={title} subtitle={subtitle} compact={isPackageChange || isBillingChange} />

      <Box
        px={isPackageChange || isBillingChange ? 4 : 5}
        py={isPackageChange || isBillingChange ? 3 : 5}
        w="full"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(actionType === "upgrade" || actionType === "downgrade") && customer ? (
          <PackageChangeForm
            mode={actionType}
            customer={customer}
            packages={actionPackages}
            productId={actionProductId}
            paymentFrequency={actionPaymentFrequency}
            customPeriodDays={actionCustomPeriodDays}
            upgradeQuote={upgradeQuote}
            upgradeQuoteLoading={upgradeQuoteLoading}
            pendingUpgrade={pendingUpgrade}
            cancellingPending={cancellingPendingUpgrade}
            paymentMethod={upgradePaymentMethod}
            loading={loading}
            dataLoading={dataLoading}
            onProductChange={onProductChange}
            onPaymentFrequencyChange={onPaymentFrequencyChange}
            onCustomPeriodDaysChange={onCustomPeriodDaysChange}
            onPaymentMethodChange={onPaymentMethodChange}
            onCancelPendingUpgrade={onCancelPendingUpgrade}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        ) : null}

        {actionType === "changePaymentFrequency" && customer ? (
          <PaymentFrequencyForm
            customer={customer}
            paymentFrequency={actionPaymentFrequency}
            customPeriodDays={actionCustomPeriodDays}
            previewProduct={billingPreviewProduct}
            loading={loading}
            dataLoading={dataLoading}
            onPaymentFrequencyChange={onPaymentFrequencyChange}
            onCustomPeriodDaysChange={onCustomPeriodDaysChange}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        ) : null}

        {actionType === "switch" && customer ? (
          <Stack gap={4}>
            <Text fontSize="sm" color="gray.600">
              Move within <strong>{formatTitleCase(customer.buildingName)}</strong>. Customer number and IP
              rules will be recalculated for the new apartment.
            </Text>
            <Field.Root required w="full">
              <Field.Label>New apartment number</Field.Label>
              <Input
                value={newApartment}
                onChange={(e) => onApartmentChange(e.target.value.toUpperCase())}
                placeholder="e.g. S445"
              />
              <Field.HelperText>Current: {customer.apartmentNumber}</Field.HelperText>
            </Field.Root>
            <Flex justify="flex-end" gap={2}>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorPalette="brand"
                loading={loading}
                disabled={!newApartment.trim()}
                onClick={onSubmit}
              >
                Confirm
              </Button>
            </Flex>
          </Stack>
        ) : null}

        {actionType === "cancel" ? (
          cancelStep === 1 ? (
            <Stack gap={4}>
              <Box bg="red.50" borderRadius="md" px={3} py={3} fontSize="sm" color="red.800">
                This will mark the subscription as cancelled. The customer record is kept for
                history but will no longer be active.
              </Box>
              <Field.Root w="full">
                <Field.Label>Notes (optional)</Field.Label>
                <Input
                  value={cancelNotes}
                  onChange={(e) => onNotesChange(e.target.value)}
                  placeholder="Reason for cancellation"
                />
              </Field.Root>
              <Flex justify="flex-end" gap={2}>
                <Button variant="ghost" onClick={onClose}>
                  Keep subscription
                </Button>
                <Button colorPalette="red" onClick={() => setCancelStep(2)}>
                  Continue
                </Button>
              </Flex>
            </Stack>
          ) : (
            <Stack gap={4}>
              <Box bg="red.50" borderRadius="md" px={3} py={3} fontSize="sm" color="red.800">
                Are you sure you want to cancel{" "}
                <strong>{formatTitleCase(customer?.fullName)}</strong> ({customer?.customerNumber})?
                This cannot be undone from here.
              </Box>
              <Flex justify="flex-end" gap={2}>
                <Button variant="ghost" onClick={() => setCancelStep(1)}>
                  Go back
                </Button>
                <Button colorPalette="red" loading={loading} onClick={onSubmit}>
                  Yes, cancel subscription
                </Button>
              </Flex>
            </Stack>
          )
        ) : null}

        {actionType === "deletePermanent" ? (
          deleteStep === 1 ? (
            <Stack gap={4}>
              <Box bg="red.50" borderRadius="md" px={3} py={3} fontSize="sm" color="red.800">
                This permanently removes the customer and all related records from the admin
                database. It is only allowed when the customer has no account on TISP or Zoho.
              </Box>
              <Flex justify="flex-end" gap={2}>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button colorPalette="red" onClick={() => setDeleteStep(2)}>
                  Continue
                </Button>
              </Flex>
            </Stack>
          ) : (
            <Stack gap={4}>
              <Box bg="red.50" borderRadius="md" px={3} py={3} fontSize="sm" color="red.800">
                Are you sure you want to permanently delete{" "}
                <strong>{formatTitleCase(customer?.fullName)}</strong> ({customer?.customerNumber}
                )? This cannot be undone.
              </Box>
              <Flex justify="flex-end" gap={2}>
                <Button variant="ghost" onClick={() => setDeleteStep(1)}>
                  Go back
                </Button>
                <Button colorPalette="red" loading={loading} onClick={onSubmit}>
                  Yes, delete permanently
                </Button>
              </Flex>
            </Stack>
          )
        ) : null}

        {actionType === "history" ? (
          <Stack gap={4}>
            <Text fontSize="sm" color="gray.600" lineHeight="1.5">
              Occupancy timeline for apartment{" "}
              <strong>{customer?.apartmentNumber}</strong>
              {customer?.buildingName ? (
                <>
                  {" "}
                  in <strong>{formatTitleCase(customer.buildingName)}</strong>
                </>
              ) : null}
              . Oldest period on the left, most recent on the right.
            </Text>

            {dataLoading ? (
              <ApartmentHistoryTimelineSkeleton steps={4} />
            ) : (
              <ApartmentHistoryTimeline
                entries={apartmentHistory}
                highlightCustomerId={customer?.id}
                emptyMessage={`No occupancy history for apartment ${customer?.apartmentNumber ?? ""}`}
              />
            )}

            <Flex justify="flex-end">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </Flex>
          </Stack>
        ) : null}
      </Box>
    </ModalShell>
  );
}
