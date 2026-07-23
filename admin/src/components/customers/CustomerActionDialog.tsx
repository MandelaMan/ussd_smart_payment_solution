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
import {
  api,
  type ApartmentHistoryEntry,
  type ApartmentOccupancy,
  type Building,
  type Customer,
} from "../../lib/api";
import {
  getBuildingIpRules,
  validateIpForBuilding,
} from "../../lib/buildingIpRules";
import { embeddedFieldInputStyles } from "../../theme";
import { ModalShell } from "../ui/ModalShell";
import { SelectField } from "../ui/SelectField";
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
  buildings?: Building[];
  actionType: CustomerAction | null;
  actionProductId: string;
  newApartment: string;
  switchIpAddress: string;
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
  onSwitchIpChange: (value: string) => void;
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
      borderColor="border.muted"
    >
      <Text fontSize={compact ? "md" : "lg"} fontWeight="semibold" color="fg">
        {title}
      </Text>
      {subtitle ? (
        <Text fontSize="xs" color="fg.muted" mt={0.5} truncate title={subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </Box>
  );
}

function MoveApartmentForm({
  customer,
  building,
  newApartment,
  switchIpAddress,
  loading,
  onApartmentChange,
  onSwitchIpChange,
  onSubmit,
  onClose,
}: {
  customer: Customer;
  building: Building | undefined;
  newApartment: string;
  switchIpAddress: string;
  loading: boolean;
  onApartmentChange: (value: string) => void;
  onSwitchIpChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const [occupancy, setOccupancy] = useState<ApartmentOccupancy | null>(null);
  const [checking, setChecking] = useState(false);
  const [ipPrefix, setIpPrefix] = useState("");
  const [ipLastOctet, setIpLastOctet] = useState("");

  const ipRules = getBuildingIpRules(building);
  const needsIp = occupancy?.needsIpInput === true;

  useEffect(() => {
    const apt = newApartment.trim();
    if (!apt || !customer.buildingId) {
      setOccupancy(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = window.setTimeout(() => {
      api
        .checkApartmentOccupancy(customer.buildingId, apt, customer.id)
        .then((res) => {
          if (!cancelled) setOccupancy(res);
        })
        .catch(() => {
          if (!cancelled) setOccupancy(null);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [newApartment, customer.buildingId, customer.id]);

  useEffect(() => {
    const prefixes = ipRules?.prefixes || [];
    if (!prefixes.length) {
      setIpPrefix("");
      return;
    }
    if (!ipPrefix || !prefixes.includes(ipPrefix)) {
      setIpPrefix(prefixes[0]);
    }
  }, [ipRules?.prefixes, ipPrefix]);

  useEffect(() => {
    if (!needsIp) {
      setIpLastOctet("");
      onSwitchIpChange("");
      return;
    }
    const result = validateIpForBuilding(building, ipPrefix, ipLastOctet);
    onSwitchIpChange(result.ok ? result.ip : "");
  }, [needsIp, building, ipPrefix, ipLastOctet, onSwitchIpChange]);

  const previewIp =
    needsIp && ipLastOctet
      ? validateIpForBuilding(building, ipPrefix, ipLastOctet)
      : null;

  const apartmentOk =
    Boolean(newApartment.trim()) &&
    occupancy?.available === true &&
    newApartment.trim().toUpperCase() !==
      String(customer.apartmentNumber || "").toUpperCase();

  const ipOk = !needsIp || Boolean(switchIpAddress);
  const canSubmit = apartmentOk && ipOk && !checking && !loading;

  const previewNumber = (() => {
    const apt = newApartment.trim().toUpperCase();
    if (!apt || !building) return "";
    const code =
      customer.customerType === "B2B" ? building.b2bCode : building.c2bCode;
    return code ? `${code}-${apt}` : apt;
  })();

  return (
    <Stack gap={4}>
      <Text fontSize="sm" color="fg.muted">
        Move within <strong>{formatTitleCase(customer.buildingName)}</strong>.
        Customer number
        {building?.ipSetup === "STATIC" ? ", IP," : ""} and billing details will
        be updated for the new apartment.
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

      {checking && newApartment.trim() ? (
        <Text fontSize="xs" color="fg.muted">
          Checking apartment…
        </Text>
      ) : null}

      {occupancy && !occupancy.available && occupancy.tenant ? (
        <Text fontSize="sm" color="red.600">
          Apartment {occupancy.tenant.apartmentNumber} already has an active
          tenant: {occupancy.tenant.customerName} (
          {occupancy.tenant.customerNumber})
        </Text>
      ) : null}

      {occupancy?.available && occupancy.apartmentKnown && occupancy.lastIp ? (
        <Text fontSize="sm" color="green.700">
          Apartment exists — reusing previous IP {occupancy.lastIp}.
          {previewNumber ? ` New customer number: ${previewNumber}.` : null}
        </Text>
      ) : null}

      {occupancy?.available && needsIp && ipRules ? (
        <Field.Root required w="full">
          <Field.Label>IP address for new apartment</Field.Label>
          <Text fontSize="xs" color="fg.muted" mb={2}>
            This apartment is new (no prior occupancy). Select the static IP to
            assign.
          </Text>
          <Flex
            direction={{ base: "column", sm: "row" }}
            gap={3}
            align={{ sm: "stretch" }}
          >
            {ipRules.prefixes.length > 1 ? (
              <Box maxW={{ sm: "220px" }} w={{ base: "100%", sm: "auto" }} flexShrink={0}>
                <SelectField
                  fieldProps={{
                    value: ipPrefix,
                    onChange: (e) => setIpPrefix(e.target.value),
                    fontFamily: "mono",
                  }}
                >
                  {ipRules.prefixes.map((p) => (
                    <option key={p} value={p}>
                      {p}x
                    </option>
                  ))}
                </SelectField>
              </Box>
            ) : null}
            <Flex
              align="stretch"
              flex={1}
              minW={0}
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
              bg="bg.panel"
              boxShadow="sm"
              overflow="hidden"
              _focusWithin={{
                borderColor: "brand.500",
                boxShadow: "0 0 0 1px var(--chakra-colors-brand-500)",
              }}
            >
              <Flex
                align="center"
                px={3}
                fontSize="sm"
                color="fg.muted"
                fontFamily="mono"
                bg="bg.subtle"
                borderRightWidth="1px"
                borderColor="border"
                flexShrink={0}
              >
                {ipPrefix || "—"}
              </Flex>
              <Input
                type="number"
                min={1}
                max={254}
                value={ipLastOctet}
                onChange={(e) => setIpLastOctet(e.target.value)}
                placeholder="1–254"
                aria-label="Host number"
                flex={1}
                minW={0}
                {...embeddedFieldInputStyles}
              />
            </Flex>
          </Flex>
          <Field.HelperText>
            {previewIp?.ok
              ? `Assigned IP: ${previewIp.ip}`
              : "Enter a host number from 1 to 254."}
          </Field.HelperText>
        </Field.Root>
      ) : null}

      {occupancy?.available && previewNumber && !needsIp ? (
        <Text fontSize="xs" color="fg.muted">
          New customer number: {previewNumber}
        </Text>
      ) : null}

      <Flex justify="flex-end" gap={2}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          colorPalette="brand"
          loading={loading}
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          Confirm move
        </Button>
      </Flex>
    </Stack>
  );
}

export function CustomerActionDialog({
  customer,
  buildings = [],
  actionType,
  actionProductId,
  newApartment,
  switchIpAddress,
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
  onSwitchIpChange,
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
  if (actionType === "disconnect") title = "Disconnect customer";
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
          <MoveApartmentForm
            customer={customer}
            building={buildings.find((b) => b.id === customer.buildingId)}
            newApartment={newApartment}
            switchIpAddress={switchIpAddress}
            loading={loading}
            onApartmentChange={onApartmentChange}
            onSwitchIpChange={onSwitchIpChange}
            onSubmit={onSubmit}
            onClose={onClose}
          />
        ) : null}

        {actionType === "disconnect" ? (
          <Stack gap={4}>
            <Box bg="orange.50" borderRadius="md" px={3} py={3} fontSize="sm" color="orange.900">
              This will disconnect{" "}
              <strong>{formatTitleCase(customer?.fullName)}</strong> (
              {customer?.customerNumber}) on TISP by setting the due date to today. The account
              stays active here; service status becomes Suspended. Zoho billing is not changed.
            </Box>
            <Flex justify="flex-end" gap={2}>
              <Button variant="ghost" onClick={onClose}>
                Keep connected
              </Button>
              <Button colorPalette="orange" loading={loading} onClick={onSubmit}>
                Disconnect on TISP
              </Button>
            </Flex>
          </Stack>
        ) : null}

        {actionType === "cancel" ? (
          cancelStep === 1 ? (
            <Stack gap={4}>
              <Box bg="red.50" borderRadius="md" px={3} py={3} fontSize="sm" color="red.800">
                This will mark the subscription as cancelled. The customer record is kept for
                history. TISP due date is set to today, and C2B Zoho contacts are marked inactive
                (recurring billing stopped).
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
                database. TISP and Zoho accounts (if any) are not deleted or changed.
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
            <Text fontSize="sm" color="fg.muted" lineHeight="1.5">
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
