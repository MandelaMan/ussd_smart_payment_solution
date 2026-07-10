import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Heading,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { FiArrowLeft } from "react-icons/fi";
import {
  api,
  formatCurrency,
  type Agency,
  type ApartmentOccupancy,
  type Building,
  type Customer,
  type PackageCategory,
  type Product,
} from "../../lib/api";
import { toaster } from "../ui/toaster";
import { SelectField } from "../ui/SelectField";
import { SearchableSelect } from "../ui/SearchableSelect";
import {
  getBuildingIpRules,
  ipRulesHint,
  validateIpForBuilding,
} from "../../lib/buildingIpRules";
import { embeddedFieldInputStyles } from "../../theme";
import { FormSection } from "./FormSection";
import { AppDialog, NESTED_APP_DIALOG_Z_INDEX } from "../ui/AppDialog";
import { FormSubmitSummary, type FormSummaryItem } from "../ui/FormSubmitSummary";
import { formatCustomerPackageLabel } from "../../lib/formatText";

const PAYMENT_FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom period" },
];

const lockedPackageFieldProps = {
  readOnly: true,
  disabled: true,
  bg: "gray.50",
  color: "gray.600",
  borderColor: "gray.200",
  cursor: "not-allowed",
  opacity: 1,
  _disabled: {
    opacity: 1,
    bg: "gray.50",
    color: "gray.600",
    cursor: "not-allowed",
  },
} as const;

function parseIpFromAddress(ipAddress: string | null, building?: Building) {
  if (!ipAddress || !building) return { prefix: "", lastOctet: "" };
  const rules = getBuildingIpRules(building);
  for (const prefix of rules?.prefixes || []) {
    if (ipAddress.startsWith(prefix)) {
      return { prefix, lastOctet: ipAddress.slice(prefix.length) };
    }
  }
  const parts = ipAddress.split(".");
  if (parts.length === 4) {
    return {
      prefix: `${parts[0]}.${parts[1]}.${parts[2]}.`,
      lastOctet: parts[3],
    };
  }
  return { prefix: "", lastOctet: "" };
}

type Props = {
  customer?: Customer | null;
  embedded?: boolean;
  onCreated?: (customer: Customer) => void;
  onUpdated?: (
    customer: Customer,
    tisp?: { ok: boolean; error?: string }
  ) => void;
  onCancel?: () => void;
};

export function CustomerForm({
  customer,
  embedded = false,
  onCreated,
  onUpdated,
  onCancel,
}: Props) {
  const isEdit = Boolean(customer);
  const isActive = !customer || customer.status === "active";
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [catalog, setCatalog] = useState<PackageCategory[]>([]);
  const [packages, setPackages] = useState<Product[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [ipPrefix, setIpPrefix] = useState("");
  const [ipLastOctet, setIpLastOctet] = useState("");
  const [isVatExempt, setIsVatExempt] = useState(false);
  const [customerType, setCustomerType] = useState<"C2B" | "B2B">("C2B");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [paymentFrequency, setPaymentFrequency] = useState("monthly");
  const [customPeriodDays, setCustomPeriodDays] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [planId, setPlanId] = useState("");
  const [productId, setProductId] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [dstvDecoderSerial, setDstvDecoderSerial] = useState("");
  const [trialPeriod, setTrialPeriod] = useState(false);
  const [occupancy, setOccupancy] = useState<ApartmentOccupancy | null>(null);
  const [occupancyChecking, setOccupancyChecking] = useState(false);
  const [initializingEdit, setInitializingEdit] = useState(isEdit);
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [packagesLoading, setPackagesLoading] = useState(false);

  useEffect(() => {
    setLookupsLoading(true);
    Promise.all([
      api.listBuildings({ limit: "100" }),
      api.listAgencies({ limit: "100" }),
      api.getPackageCatalog(),
    ])
      .then(([b, a, c]) => {
        setBuildings(b.buildings);
        setAgencies(a.agencies);
        setCatalog(c.categories);
      })
      .catch(() => {})
      .finally(() => setLookupsLoading(false));
  }, []);

  useEffect(() => {
    if (!customer || !buildings.length) return;

    setInitializingEdit(true);
    setFirstName(customer.firstName);
    setMiddleName(customer.middleName || "");
    setLastName(customer.lastName);
    setPhone(customer.phone);
    setEmail(customer.email || "");
    setIsVatExempt(customer.isVatExempt);
    setCustomerType(customer.customerType);
    setApartmentNumber(customer.apartmentNumber);
    setPaymentFrequency(customer.paymentFrequency);
    setCustomPeriodDays(
      customer.customPeriodDays != null ? String(customer.customPeriodDays) : ""
    );
    setBuildingId(String(customer.buildingId));
    setAgencyId(customer.agencyId ? String(customer.agencyId) : "");
    setDstvDecoderSerial(customer.dstvDecoderSerial || "");

    const building = buildings.find((b) => b.id === customer.buildingId);
    const { prefix, lastOctet } = parseIpFromAddress(customer.ipAddress, building);
    setIpPrefix(prefix);
    setIpLastOctet(lastOctet);
    setInitializingEdit(false);
  }, [customer, buildings]);

  const buildingOptions = useMemo(
    () =>
      buildings.map((b) => ({
        value: String(b.id),
        label: b.name,
        description: `${b.ipSetup} · C2B ${b.c2bCode} · B2B ${b.b2bCode}`,
        keywords: `${b.c2bCode} ${b.b2bCode}`,
      })),
    [buildings]
  );

  const agencyOptions = useMemo(
    () =>
      agencies.map((a) => ({
        value: String(a.id),
        label: a.name,
        description: [a.contactPerson, a.email, a.phone].filter(Boolean).join(" · ") || undefined,
      })),
    [agencies]
  );

  const selectedCategory = catalog.find((c) => String(c.id) === categoryId);

  useEffect(() => {
    if (isEdit) return;
    if (!buildingId || !planId) {
      setPackages([]);
      setProductId("");
      setPackagesLoading(false);
      return;
    }
    const freq = paymentFrequency === "custom" ? "monthly" : paymentFrequency;
    const params: Record<string, string> = {
      buildingId,
      paymentFrequency: freq,
      activeOnly: "true",
      unpaginated: "true",
    };
    if (categoryId) params.categoryId = categoryId;
    params.planId = planId;
    setPackagesLoading(true);
    api
      .listProducts(params)
      .then((res) => {
        setPackages(res.products);
        setProductId((prev) =>
          prev && res.products.some((p) => String(p.id) === prev) ? prev : ""
        );
      })
      .catch(() => {
        setPackages([]);
        setProductId("");
      })
      .finally(() => setPackagesLoading(false));
  }, [buildingId, paymentFrequency, categoryId, planId, isEdit]);

  useEffect(() => {
    const apt = apartmentNumber.trim();
    if (!buildingId || !apt) {
      setOccupancy(null);
      return;
    }

    setOccupancyChecking(true);
    const timer = window.setTimeout(() => {
      api
        .checkApartmentOccupancy(
          Number(buildingId),
          apt,
          isEdit ? customer?.id : undefined
        )
        .then(setOccupancy)
        .catch(() => setOccupancy(null))
        .finally(() => setOccupancyChecking(false));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [buildingId, apartmentNumber, isEdit, customer?.id]);

  const selectedBuilding = buildings.find((b) => String(b.id) === buildingId);
  const ipRules = getBuildingIpRules(selectedBuilding);
  const needsIp = ipRules?.ipSetup === "STATIC";

  useEffect(() => {
    if (!selectedBuilding) {
      setIpPrefix("");
      setIpLastOctet("");
      return;
    }
    const rules = getBuildingIpRules(selectedBuilding);
    if (rules?.ipSetup === "STATIC" && rules.prefixes.length > 0) {
      setIpPrefix((prev) =>
        prev && rules.prefixes.includes(prev) ? prev : rules.prefixes[0]
      );
    } else {
      setIpPrefix("");
      setIpLastOctet("");
    }
  }, [selectedBuilding?.id]);

  const selectedPackage = isEdit
    ? null
    : packages.find((p) => String(p.id) === productId);
  const requiresDstvSerial = Boolean(
    isEdit
      ? customer?.hasDstv
      : selectedCategory?.hasDstv || selectedPackage?.hasDstv
  );
  const packageAmount = isEdit
    ? customer?.packagePrice
    : paymentFrequency === "custom" && selectedPackage && customPeriodDays
      ? Math.round((selectedPackage.monthlyPrice * Number(customPeriodDays)) / 30)
      : selectedPackage?.price;
  const decoderFee =
    selectedCategory?.requiresDecoderFee
      ? selectedCategory.decoderFeeAmount || 2900
      : 0;
  const displayPrice =
    packageAmount != null ? packageAmount + decoderFee : undefined;

  const previewCode = (() => {
    const b = buildings.find((x) => String(x.id) === buildingId);
    if (!b || !apartmentNumber) return "";
    const code = customerType === "B2B" ? b.b2bCode : b.c2bCode;
    return `${code}-${apartmentNumber.trim().toUpperCase()}`;
  })();

  const previewIpResult = validateIpForBuilding(selectedBuilding, ipPrefix, ipLastOctet);
  const previewIp = previewIpResult.ok ? previewIpResult.ip : null;

  const fieldsDisabled = submitting || confirmOpen || initializingEdit || lookupsLoading;

  const summaryItems = useMemo((): FormSummaryItem[] => {
    const agency = agencies.find((a) => String(a.id) === agencyId);
    const freqLabel =
      paymentFrequency === "custom" && customPeriodDays
        ? `Custom (${customPeriodDays} days)`
        : PAYMENT_FREQUENCIES.find((f) => f.value === paymentFrequency)?.label ||
          paymentFrequency;

    const items: FormSummaryItem[] = [
      {
        label: "Customer number",
        value: previewCode || customer?.customerNumber || "—",
      },
      {
        label: "Name",
        value: [firstName, middleName, lastName].filter(Boolean).join(" ").trim() || "—",
      },
      { label: "Phone", value: phone || "—" },
      { label: "Email", value: email.trim() || "—" },
      {
        label: "Building",
        value: selectedBuilding?.name || customer?.buildingName || "—",
      },
      { label: "Apartment", value: apartmentNumber.trim() || "—" },
    ];

    if (selectedPackage) {
      items.push({
        label: "Package",
        value: `${selectedPackage.planName || selectedPackage.name} · ${selectedPackage.mbps} Mbps`,
      });
    } else if (isEdit && customer) {
      items.push({
        label: "Package",
        value: formatCustomerPackageLabel(customer.productName, customer.productMbps),
      });
    }
    if (displayPrice != null) {
      items.push({ label: "Price", value: formatCurrency(displayPrice) });
    }

    items.push({ label: "Billing frequency", value: freqLabel });
    if (!isEdit && trialPeriod) {
      items.push({
        label: "Trial period",
        value: "30 days — first invoice after trial",
      });
    }
    items.push({
      label: "Customer type",
      value:
        customerType === "B2B"
          ? agency
            ? `B2B — ${agency.name}`
            : "B2B"
          : "C2B",
    });
    items.push({ label: "VAT exempt", value: isVatExempt ? "Yes" : "No" });

    if (previewIp) items.push({ label: "IP address", value: previewIp });
    if (requiresDstvSerial && dstvDecoderSerial.trim()) {
      items.push({ label: "DSTV serial", value: dstvDecoderSerial.trim().toUpperCase() });
    }

    return items;
  }, [
    agencies,
    agencyId,
    apartmentNumber,
    customer,
    customer?.buildingName,
    customer?.customerNumber,
    customer?.packagePrice,
    customer?.productMbps,
    customer?.productName,
    customerType,
    customPeriodDays,
    displayPrice,
    dstvDecoderSerial,
    email,
    firstName,
    isEdit,
    isVatExempt,
    lastName,
    middleName,
    paymentFrequency,
    phone,
    previewCode,
    previewIp,
    requiresDstvSerial,
    selectedBuilding?.name,
    selectedPackage,
    trialPeriod,
  ]);

  function validateForm() {
    const ipResult = validateIpForBuilding(selectedBuilding, ipPrefix, ipLastOctet);
    if (!ipResult.ok) {
      toaster.create({ title: ipResult.error, type: "error" });
      return false;
    }
    if (
      isActive &&
      occupancy &&
      !occupancy.available &&
      occupancy.tenant
    ) {
      toaster.create({
        title: "Apartment already occupied",
        description: `${occupancy.tenant.customerName} (${occupancy.tenant.customerNumber}) is the current tenant.`,
        type: "error",
      });
      return false;
    }
    if (isActive && !isEdit && !productId) {
      toaster.create({ title: "Select a package", type: "error" });
      return false;
    }
    if (customerType === "B2B" && !agencyId) {
      toaster.create({ title: "Select an agency for B2B customers", type: "error" });
      return false;
    }
    if (!email.trim()) {
      toaster.create({ title: "Email is required", type: "error" });
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toaster.create({ title: "Enter a valid email address", type: "error" });
      return false;
    }
    if (requiresDstvSerial && !dstvDecoderSerial.trim()) {
      toaster.create({
        title: "DSTV decoder serial required",
        description: "Enter the decoder serial number for DSTV packages.",
        type: "error",
      });
      return false;
    }
    return true;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;
    setConfirmOpen(true);
  }

  async function executeSubmit() {
    const ipResult = validateIpForBuilding(selectedBuilding, ipPrefix, ipLastOctet);
    if (!ipResult.ok) return;

    setSubmitting(true);
    try {
      if (isEdit && customer) {
        const res = await api.updateCustomer(customer.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          middleName: middleName.trim() || undefined,
          phone,
          email: email.trim().toLowerCase(),
          ipAddress: ipResult.ip || undefined,
          isVatExempt,
          customerType,
          agencyId: customerType === "B2B" ? Number(agencyId) : undefined,
          apartmentNumber: isActive ? apartmentNumber : undefined,
          dstvDecoderSerial: requiresDstvSerial
            ? dstvDecoderSerial.trim().toUpperCase()
            : dstvDecoderSerial.trim()
              ? dstvDecoderSerial.trim().toUpperCase()
              : undefined,
        });

        if (res.tisp && !res.tisp.ok) {
          toaster.create({
            title: "Customer updated",
            description: `TISP sync failed: ${res.tisp.error}`,
            type: "warning",
            duration: 10000,
          });
        }
        onUpdated?.(res.customer, res.tisp);
        setConfirmOpen(false);
        return;
      }

      const res = await api.createCustomer({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim() || undefined,
        phone,
        email: email.trim().toLowerCase(),
        ipAddress: ipResult.ip || undefined,
        isVatExempt,
        customerType,
        apartmentNumber,
        paymentFrequency,
        customPeriodDays:
          paymentFrequency === "custom" ? Number(customPeriodDays) : undefined,
        buildingId: Number(buildingId),
        productId: Number(productId),
        agencyId: customerType === "B2B" ? Number(agencyId) : undefined,
        dstvDecoderSerial: requiresDstvSerial
          ? dstvDecoderSerial.trim().toUpperCase()
          : undefined,
        trialPeriod: trialPeriod || undefined,
      });

      if (!res.tisp.ok) {
        toaster.create({
          title: `Customer ${res.customer.customerNumber} saved locally`,
          description: `TISP registration failed: ${res.tisp.error}`,
          type: "warning",
          duration: 12000,
        });
      } else {
        toaster.create({
          title: "Customer created",
          description: trialPeriod
            ? `${res.customer.customerNumber} — 30-day trial, billing starts after trial`
            : res.customer.customerNumber,
          type: "success",
        });
      }
      onCreated?.(res.customer);
      setConfirmOpen(false);
    } catch (err) {
      toaster.create({
        title:
          err instanceof Error
            ? err.message
            : isEdit
              ? "Failed to update customer"
              : "Failed to create customer",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const editFrequencyLabel =
    customer?.paymentFrequency === "custom" && customer.customPeriodDays
      ? `Custom (${customer.customPeriodDays} days)`
      : PAYMENT_FREQUENCIES.find((f) => f.value === customer?.paymentFrequency)?.label ||
        customer?.paymentFrequency ||
        "";

  const formBody = (
    <form onSubmit={handleSubmit}>
      <Stack gap={4}>
        <FormSection
          title="Location"
          description={
            isEdit
              ? "Building is fixed. Apartment changes update the customer number."
              : "Building and apartment determine the customer number and IP rules."
          }
          sideBySide
        >
          <Field.Root required w="full">
            <Field.Label>Building</Field.Label>
            {isEdit ? (
              <Input
                value={selectedBuilding?.name || customer?.buildingName || ""}
                readOnly
                bg="gray.50"
              />
            ) : (
              <SearchableSelect
                value={buildingId}
                disabled={fieldsDisabled}
                isLoading={lookupsLoading}
                onChange={(nextBuildingId) => {
                  setBuildingId(nextBuildingId);
                  setPaymentFrequency("monthly");
                  setCategoryId("");
                  setPlanId("");
                  setProductId("");
                }}
                options={buildingOptions}
                placeholder="Select building"
                searchPlaceholder="Search buildings…"
                emptyLabel="No buildings match your search"
              />
            )}
          </Field.Root>
          <Field.Root required w="full">
            <Field.Label>Apartment number</Field.Label>
            <Input
              w="full"
              value={apartmentNumber}
              onChange={(e) => setApartmentNumber(e.target.value)}
              placeholder="e.g. S444"
              readOnly={!isActive}
              disabled={fieldsDisabled}
              bg={!isActive ? "gray.50" : undefined}
            />
            {isActive && occupancyChecking && apartmentNumber.trim() && buildingId ? (
              <Text fontSize="xs" color="gray.500" mt={1}>
                Checking apartment availability…
              </Text>
            ) : isActive && occupancy && !occupancy.available && occupancy.tenant ? (
              <Text fontSize="xs" color="red.600" mt={1}>
                Apartment {occupancy.tenant.apartmentNumber} already has an active tenant:{" "}
                {occupancy.tenant.customerName} ({occupancy.tenant.customerNumber})
              </Text>
            ) : isActive && occupancy?.available && apartmentNumber.trim() && buildingId ? (
              <Text fontSize="xs" color="green.600" mt={1}>
                Apartment is available
              </Text>
            ) : null}
          </Field.Root>
        </FormSection>

        <FormSection
          title="Package & billing"
          description={
            isEdit
              ? "Package and billing changes use Upgrade, Downgrade, or Update frequency in customer actions."
              : "Choose category, plan, billing frequency, and building price."
          }
        >
          {isEdit && customer ? (
            <>
              <Field.Root opacity={0.92}>
                <Field.Label color="gray.500">Current package</Field.Label>
                <Input
                  {...lockedPackageFieldProps}
                  value={formatCustomerPackageLabel(customer.productName, customer.productMbps)}
                />
              </Field.Root>
              <Field.Root opacity={0.92}>
                <Field.Label color="gray.500">Price</Field.Label>
                <Input
                  {...lockedPackageFieldProps}
                  value={formatCurrency(customer.packagePrice)}
                />
              </Field.Root>
              <Field.Root opacity={0.92}>
                <Field.Label color="gray.500">Payment frequency</Field.Label>
                <Input {...lockedPackageFieldProps} value={editFrequencyLabel} />
              </Field.Root>
              {customer.hasDstv && (
                <Box gridColumn={{ md: "span 2" }} bg="blue.50" borderRadius="md" px={3} py={2}>
                  <Text fontSize="sm" color="blue.800">
                    TV package included — use Upgrade or Downgrade to change the internet/TV plan.
                  </Text>
                </Box>
              )}
              {requiresDstvSerial && (
                <Field.Root required gridColumn={{ md: "span 2" }}>
                  <Field.Label>DSTV decoder serial number</Field.Label>
                  <Input
                    value={dstvDecoderSerial}
                    onChange={(e) => setDstvDecoderSerial(e.target.value.toUpperCase())}
                    placeholder="e.g. H7G4K2M9P1"
                    fontFamily="mono"
                    readOnly={!isActive}
                    disabled={fieldsDisabled}
                    bg={!isActive ? "gray.50" : undefined}
                  />
                  <Field.HelperText>
                    Update the decoder serial here. Changing the TV package requires Upgrade or
                    Downgrade.
                  </Field.HelperText>
                </Field.Root>
              )}
            </>
          ) : (
            <>
          <Field.Root required>
            <Field.Label>Payment frequency</Field.Label>
            <SelectField
              disabled={fieldsDisabled || !isActive}
              fieldProps={{
                value: paymentFrequency,
                onChange: (e) => setPaymentFrequency(e.target.value),
              }}
            >
              {PAYMENT_FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </SelectField>
          </Field.Root>
          <Field.Root required>
            <Field.Label>Category</Field.Label>
            <SelectField
              disabled={fieldsDisabled || !buildingId || !isActive}
              isLoading={lookupsLoading}
              fieldProps={{
                value: categoryId,
                onChange: (e) => {
                  setCategoryId(e.target.value);
                  setPlanId("");
                  setProductId("");
                },
              }}
            >
              <option value="">
                {!buildingId ? "Select a building first" : "Select category"}
              </option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          </Field.Root>
          <Field.Root required>
            <Field.Label>Plan</Field.Label>
            <SelectField
              disabled={fieldsDisabled || !categoryId || !isActive}
              fieldProps={{
                value: planId,
                onChange: (e) => {
                  setPlanId(e.target.value);
                  setProductId("");
                },
              }}
            >
              <option value="">
                {!categoryId ? "Select a category first" : "Select plan"}
              </option>
              {(selectedCategory?.plans || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
          </Field.Root>
          <Field.Root required>
            <Field.Label>Building price</Field.Label>
            <SelectField
              disabled={fieldsDisabled || !buildingId || !planId || !isActive}
              isLoading={packagesLoading}
              fieldProps={{
                value: productId,
                onChange: (e) => setProductId(e.target.value),
              }}
            >
              <option value="">
                {packagesLoading
                  ? "Loading prices…"
                  : !buildingId
                  ? "Select a building first"
                  : !planId
                    ? "Select category and plan first"
                    : packages.length === 0
                      ? "No price set for this building — add it under Packages"
                      : "Select price"}
              </option>
              {packages.map((p) => (
                <option key={p.id} value={p.id} title={p.name}>
                  {p.mbps} Mbps · {formatCurrency(p.price)}
                </option>
              ))}
            </SelectField>
          </Field.Root>
          {selectedCategory?.requiresDecoderFee && (
            <Box gridColumn={{ md: "span 2" }} bg="orange.50" borderRadius="md" px={3} py={2}>
              <Text fontSize="sm" color="orange.800">
                A one-off decoder payment of {formatCurrency(decoderFee)} applies for this
                category.
              </Text>
            </Box>
          )}
          {requiresDstvSerial && (
            <Field.Root required gridColumn={{ md: "span 2" }}>
              <Field.Label>DSTV decoder serial number</Field.Label>
              <Input
                value={dstvDecoderSerial}
                onChange={(e) => setDstvDecoderSerial(e.target.value.toUpperCase())}
                placeholder="e.g. H7G4K2M9P1"
                fontFamily="mono"
                readOnly={!isActive}
                disabled={fieldsDisabled}
                bg={!isActive ? "gray.50" : undefined}
              />
              <Field.HelperText>
                Required for DSTV packages. Must be unique across all customers. Found on the
                decoder label or activation card.
              </Field.HelperText>
            </Field.Root>
          )}
          {paymentFrequency === "custom" && (
            <Field.Root required gridColumn={{ md: "span 2" }}>
              <Field.Label>Custom period (days)</Field.Label>
              <Input
                type="number"
                min={1}
                value={customPeriodDays}
                onChange={(e) => setCustomPeriodDays(e.target.value)}
                placeholder="e.g. 30"
                readOnly={!isActive}
                disabled={fieldsDisabled}
                bg={!isActive ? "gray.50" : undefined}
              />
              <Field.HelperText>
                Package price is calculated from the monthly base (monthly price × days ÷ 30).
              </Field.HelperText>
            </Field.Root>
          )}
          <Field.Root gridColumn={{ md: "span 2" }}>
            <Field.Label>Trial period</Field.Label>
            <SelectField
              disabled={fieldsDisabled || !isActive}
              fieldProps={{
                value: trialPeriod ? "yes" : "no",
                onChange: (e) => setTrialPeriod(e.target.value === "yes"),
              }}
            >
              <option value="no">No — issue signup invoice immediately</option>
              <option value="yes">Yes — 30-day free trial, bill after trial</option>
            </SelectField>
            <Field.HelperText>
              When enabled, no signup invoice is sent. A recurring invoice is scheduled to
              start 30 days after creation.
            </Field.HelperText>
          </Field.Root>
            </>
          )}
        </FormSection>

        <FormSection title="Contact details">
          <Field.Root required>
            <Field.Label>First name</Field.Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={fieldsDisabled} />
          </Field.Root>
          <Field.Root>
            <Field.Label>Middle name</Field.Label>
            <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} disabled={fieldsDisabled} />
          </Field.Root>
          <Field.Root required>
            <Field.Label>Last name</Field.Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={fieldsDisabled} />
          </Field.Root>
          <Field.Root required>
            <Field.Label>Phone</Field.Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" disabled={fieldsDisabled} />
          </Field.Root>
          <Field.Root required>
            <Field.Label>Email</Field.Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              disabled={fieldsDisabled}
            />
          </Field.Root>
        </FormSection>

        <FormSection title="Account type">
          <Field.Root required>
            <Field.Label>Customer type</Field.Label>
            <SelectField
              disabled={fieldsDisabled}
              fieldProps={{
                value: customerType,
                onChange: (e) => setCustomerType(e.target.value as "C2B" | "B2B"),
              }}
            >
              <option value="C2B">C2B — invoice to customer</option>
              <option value="B2B">B2B — invoice to agency</option>
            </SelectField>
          </Field.Root>
          <Field.Root required>
            <Field.Label>VAT exempt</Field.Label>
            <SelectField
              disabled={fieldsDisabled}
              fieldProps={{
                value: isVatExempt ? "yes" : "no",
                onChange: (e) => setIsVatExempt(e.target.value === "yes"),
              }}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </SelectField>
          </Field.Root>
          {customerType === "B2B" && (
            <Box gridColumn={{ md: "span 2" }}>
              <Field.Root required>
                <Field.Label>Agency</Field.Label>
                <SearchableSelect
                  value={agencyId}
                  onChange={setAgencyId}
                  disabled={fieldsDisabled}
                  isLoading={lookupsLoading}
                  options={agencyOptions}
                  placeholder="Select agency"
                  searchPlaceholder="Search agencies…"
                  emptyLabel="No agencies match your search"
                />
              </Field.Root>
            </Box>
          )}
        </FormSection>

        {selectedBuilding && (
          <FormSection
            title="Network"
            description={
              needsIp
                ? "Enter only the last octet — subnet is fixed per building."
                : `${selectedBuilding.name} uses PPOE — no static IP required.`
            }
          >
            {needsIp && ipRules ? (
              <>
                {ipRules.prefixes.length > 1 ? (
                  <Field.Root required>
                    <Field.Label>Subnet</Field.Label>
                    <SelectField disabled={fieldsDisabled} fieldProps={{ value: ipPrefix, onChange: (e) => setIpPrefix(e.target.value) }}>
                      {ipRules.prefixes.map((p) => (
                        <option key={p} value={p}>{p}x</option>
                      ))}
                    </SelectField>
                  </Field.Root>
                ) : (
                  <Field.Root>
                    <Field.Label>Subnet</Field.Label>
                    <Input value={ipPrefix} readOnly bg="white" fontFamily="mono" />
                  </Field.Root>
                )}
                <Field.Root required>
                  <Field.Label>Host (1–254)</Field.Label>
                  <Flex
                    align="stretch"
                    borderWidth="1px"
                    borderColor="gray.200"
                    borderRadius="md"
                    bg="white"
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
                      color="gray.600"
                      fontFamily="mono"
                      bg="gray.50"
                      borderRightWidth="1px"
                      borderColor="gray.200"
                      flexShrink={0}
                    >
                      {ipPrefix}
                    </Flex>
                    <Input
                      type="number"
                      min={1}
                      max={254}
                      value={ipLastOctet}
                      onChange={(e) => setIpLastOctet(e.target.value)}
                      placeholder="e.g. 42"
                      flex={1}
                      minW={0}
                      disabled={fieldsDisabled}
                      {...embeddedFieldInputStyles}
                    />
                  </Flex>
                  <Field.HelperText>{ipRulesHint(selectedBuilding)}</Field.HelperText>
                </Field.Root>
              </>
            ) : (
              <Box gridColumn={{ md: "span 2" }}>
                <Text fontSize="sm" color="gray.600">
                  {isEdit
                    ? "This building uses PPOE — IP is managed automatically."
                    : "A PPOE password will be generated automatically on create."}
                </Text>
              </Box>
            )}
          </FormSection>
        )}

        <Flex gap={2} justify="flex-end">
          {embedded ? (
            <Button variant="ghost" type="button" onClick={onCancel} disabled={fieldsDisabled}>
              Cancel
            </Button>
          ) : (
            <Button asChild variant="ghost" disabled={fieldsDisabled}>
              <Link to="/customers">Cancel</Link>
            </Button>
          )}
          <Button
            type="submit"
            colorPalette="brand"
            loading={submitting}
            disabled={initializingEdit}
          >
            {isEdit ? "Review changes" : "Review & create"}
          </Button>
        </Flex>
      </Stack>
    </form>
  );

  const confirmDialog = (
    <AppDialog
      open={confirmOpen}
      onOpenChange={(details) => {
        if (!submitting) setConfirmOpen(details.open);
      }}
      maxW="lg"
      zIndex={embedded ? NESTED_APP_DIALOG_Z_INDEX : undefined}
    >
      <Dialog.Header borderBottomWidth="1px" borderColor="gray.100" px={5} py={4} pr={12}>
        <Dialog.Title fontSize="lg">
          {isEdit ? "Confirm customer update" : "Confirm new customer"}
        </Dialog.Title>
      </Dialog.Header>
      <Dialog.Body px={5} py={4}>
        <FormSubmitSummary
          description={
            isEdit
              ? "These details will be saved and synced to TISP and Zoho."
              : trialPeriod
                ? "A customer record will be created with a 30-day trial. No signup invoice — billing starts after the trial via a recurring profile."
                : "A customer record will be created and synced to TISP and Zoho."
          }
          items={summaryItems}
        />
        {submitting ? (
          <Text fontSize="sm" color="brand.700" mt={4}>
            Saving and syncing…
          </Text>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer px={5} py={4} borderTopWidth="1px" borderColor="gray.100" gap={2}>
        <Button variant="ghost" disabled={submitting} onClick={() => setConfirmOpen(false)}>
          Back to edit
        </Button>
        <Button
          colorPalette="brand"
          loading={submitting}
          onClick={() => void executeSubmit()}
        >
          {isEdit ? "Confirm update" : "Confirm create"}
        </Button>
      </Dialog.Footer>
    </AppDialog>
  );

  if (embedded) {
    return (
      <>
        {formBody}
        {confirmDialog}
      </>
    );
  }

  return (
    <>
    <Stack gap={4}>
      <Flex justify="space-between" align="start" gap={4} wrap="wrap">
        <Box>
          <Button asChild variant="ghost" size="sm" mb={2} px={0}>
            <Link to="/customers">
              <FiArrowLeft />
              Back to customers
            </Link>
          </Button>
          <Heading size="lg">New customer</Heading>
          <Text fontSize="sm" color="gray.500" mt={1}>
            Complete each section — building and billing choices filter available packages.
          </Text>
        </Box>
        {previewCode && (
          <Box
            bg="linear-gradient(135deg, brand.50, azure.400/20)"
            px={4}
            py={3}
            borderRadius="lg"
            border="1px solid"
            borderColor="brand.100"
            minW="240px"
          >
            <Text fontSize="xs" color="brand.700" fontWeight="medium">
              Preview
            </Text>
            <Text fontSize="lg" color="brand.900" fontWeight="bold" mt={1}>
              {previewCode}
            </Text>
            {displayPrice != null && (
              <Text fontSize="sm" color="brand.700" mt={0.5}>
                {formatCurrency(displayPrice)}
                {decoderFee > 0 && (
                  <Text as="span" fontSize="xs" display="block" color="brand.600">
                    incl. {formatCurrency(decoderFee)} decoder fee
                  </Text>
                )}
              </Text>
            )}
            {previewIp && (
              <Text fontSize="xs" color="brand.600" mt={0.5} fontFamily="mono">
                {previewIp}
              </Text>
            )}
          </Box>
        )}
      </Flex>

      <Box bg="white" borderRadius="xl" border="1px solid" borderColor="gray.100" p={5}>
        {formBody}
      </Box>
    </Stack>
    {confirmDialog}
    </>
  );
}
