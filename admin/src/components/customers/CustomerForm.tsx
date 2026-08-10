import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
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
  formatDateOnly,
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
import { startSyncCooldown } from "../../hooks/useSyncCooldown";
import {
  getBuildingIpRules,
  validateIpForBuilding,
} from "../../lib/buildingIpRules";
import {
  buildingToBillingAddress,
  isBillingAddressEmpty,
} from "../../lib/buildingBillingAddress";
import { buildCustomerNumberPreview } from "../../lib/customerNumber";
import { embeddedFieldInputStyles } from "../../theme";
import { FormSection } from "./FormSection";
import { AppDialog, NESTED_APP_DIALOG_Z_INDEX } from "../ui/AppDialog";
import { FormSubmitSummary, type FormSummaryItem } from "../ui/FormSubmitSummary";
import { formatCustomerPackageLabel } from "../../lib/formatText";
import { useAuth } from "../../lib/authContext";
import { canEditCustomerPackage } from "../../lib/rbac";
import { DateField } from "../ui/DateField";
import { TextStatus } from "../ui/TextStatus";
import { normalizeSubscriptionStatus } from "../../lib/customerStatus";
import { TISP_STANDARD_DUE_DATE } from "../../lib/tispConstants";

const PAYMENT_FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom period" },
];

/** Normalize API/TISP dates to YYYY-MM-DD for <input type="date">. */
function toDateInputValue(value: string | null | undefined): string {
  if (value == null) return "";
  const s = String(value).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3}[a-z]*)\s+(\d{4})/);
  if (m) {
    const months: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const mon = months[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
  }
  return "";
}

const PPOE_PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*_+-";

function generatePppoePassword(length = 7): string {
  let out = "";
  const bytes =
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint8Array(length))
      : Array.from({ length }, () => Math.floor(Math.random() * 256));
  for (let i = 0; i < length; i++) {
    out += PPOE_PASSWORD_CHARS[Number(bytes[i]) % PPOE_PASSWORD_CHARS.length];
  }
  return out;
}

function isValidPppoePassword(value: string): boolean {
  // Printable ASCII excluding space (letters, numbers, special characters).
  return /^[\x21-\x7E]{4,50}$/.test(value.trim());
}

const lockedPackageFieldProps = {
  readOnly: true,
  disabled: true,
  bg: "bg.subtle",
  color: "fg.muted",
  borderColor: "border",
  cursor: "not-allowed",
  opacity: 1,
  _disabled: {
    opacity: 1,
    bg: "bg.subtle",
    color: "fg.muted",
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
  const { user } = useAuth();
  const canEditPackage = canEditCustomerPackage(user);
  const isEdit = Boolean(customer);
  const isActive = !customer || customer.status === "active";
  const showPackageEditor = !isEdit || canEditPackage;
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
  const [billingAttention, setBillingAttention] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [billingStreet2, setBillingStreet2] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingState, setBillingState] = useState("");
  const [billingZip, setBillingZip] = useState("");
  const [billingCountry, setBillingCountry] = useState("Kenya");
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
  const [ppoeUsername, setPpoeUsername] = useState("");
  const [ppoePassword, setPpoePassword] = useState("");
  const [ppoeUsernameTouched, setPpoeUsernameTouched] = useState(false);
  const [trialPeriod, setTrialPeriod] = useState(false);
  /** Advance payment: false = No payment (default); true = already paid. */
  const [paymentAlreadyMade, setPaymentAlreadyMade] = useState(false);
  /** Advance payment channel when customer already paid: mpesa | paystack | bank */
  const [advancePaymentMethod, setAdvancePaymentMethod] = useState<
    "" | "mpesa" | "paystack" | "bank"
  >("");
  const [mpesaCode, setMpesaCode] = useState("");
  const [paystackReference, setPaystackReference] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [paymentCoversInternet, setPaymentCoversInternet] = useState(true);
  const [paymentCoversDecoder, setPaymentCoversDecoder] = useState(true);
  const [paymentStatusOpen, setPaymentStatusOpen] = useState(false);
  const [paymentStatusDraft, setPaymentStatusDraft] = useState<{
    method: "" | "mpesa" | "paystack" | "bank";
    mpesaCode: string;
    paystackReference: string;
    bankReference: string;
    coversInternet: boolean;
    coversDecoder: boolean;
  } | null>(null);
  const [createInitialInvoice, setCreateInitialInvoice] = useState(false);
  const [createRecurringInvoice, setCreateRecurringInvoice] = useState(false);
  const [updateZohoRecurring, setUpdateZohoRecurring] = useState(false);
  const [tispDueDate, setTispDueDate] = useState(TISP_STANDARD_DUE_DATE);
  const [onTisp, setOnTisp] = useState(false);
  const [onZoho, setOnZoho] = useState(false);
  const [zohoInactive, setZohoInactive] = useState(false);
  const [zohoInvoiceCount, setZohoInvoiceCount] = useState(0);
  const [zohoInvoicesInSync, setZohoInvoicesInSync] = useState(false);
  const [zohoPaymentsInSync, setZohoPaymentsInSync] = useState(true);
  const [zohoLastPaymentDate, setZohoLastPaymentDate] = useState<string | null>(null);
  const [dashboardLastPaymentDate, setDashboardLastPaymentDate] = useState<string | null>(null);
  const [hasActiveRecurring, setHasActiveRecurring] = useState(false);
  const [recurringStatus, setRecurringStatus] = useState<string | null>(null);
  const [nextRecurringDate, setNextRecurringDate] = useState<string | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
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
    if (!customer?.id || customer.status !== "active") {
      setOnTisp(false);
      setOnZoho(false);
      setZohoInactive(false);
      setTispDueDate(TISP_STANDARD_DUE_DATE);
      setZohoInvoiceCount(0);
      setZohoInvoicesInSync(false);
      setZohoPaymentsInSync(true);
      setZohoLastPaymentDate(null);
      setDashboardLastPaymentDate(customer?.lastPaymentDate || null);
      setHasActiveRecurring(false);
      setRecurringStatus(null);
      setNextRecurringDate(null);
      return;
    }

    // Optimistic local guess while live check runs.
    const localOnTisp =
      customer.tispSyncStatus === "synced" ||
      (Boolean(customer.subscriptionStatus) &&
        normalizeSubscriptionStatus(customer.subscriptionStatus) === "Active" &&
        customer.tispSyncStatus !== "failed");
    const localOnZoho =
      customer.customerType === "B2B" ||
      customer.zohoBillingStatus === "completed" ||
      Boolean(customer.zohoSignupInvoiceId);
    setOnTisp(localOnTisp);
    setOnZoho(localOnZoho);
    setZohoInactive(false);
    // Prefill with known due date — never overwrite with the cycle default while loading.
    setTispDueDate(
      toDateInputValue(customer.tispDueDate) || TISP_STANDARD_DUE_DATE
    );
    setDashboardLastPaymentDate(customer.lastPaymentDate || null);
    setCreateInitialInvoice(false);
    setCreateRecurringInvoice(false);
    setUpdateZohoRecurring(false);

    let cancelled = false;
    setIntegrationsLoading(true);
    api
      .getCustomerIntegrations(customer.id)
      .then((res) => {
        if (cancelled) return;
        setOnTisp(Boolean(res.onTisp));
        setOnZoho(Boolean(res.onZoho) || res.isB2B);
        setZohoInactive(Boolean(res.zohoInactive));
        setTispDueDate(
          toDateInputValue(res.tispDueDate) ||
            toDateInputValue(customer.tispDueDate) ||
            TISP_STANDARD_DUE_DATE
        );
        setZohoInvoiceCount(Number(res.invoiceCount) || 0);
        setZohoInvoicesInSync(Boolean(res.invoicesInSync));
        setZohoPaymentsInSync(res.paymentsInSync !== false);
        setZohoLastPaymentDate(res.zohoLastPaymentDate || null);
        setDashboardLastPaymentDate(
          res.lastPaymentDate || customer.lastPaymentDate || null
        );
        setHasActiveRecurring(Boolean(res.hasActiveRecurring));
        setRecurringStatus(res.recurringStatus || null);
        setNextRecurringDate(res.nextRecurringDate || null);
        // If recurring is missing on a linked C2B contact, offer setup by default.
        if (
          !res.isB2B &&
          res.onZoho &&
          !res.hasActiveRecurring &&
          String(res.recurringStatus || "") !== "agency_billing"
        ) {
          setUpdateZohoRecurring(true);
        }
      })
      .catch(() => {
        /* keep local guess */
      })
      .finally(() => {
        if (!cancelled) setIntegrationsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customer]);

  useEffect(() => {
    if (!customer || !buildings.length) return;

    setInitializingEdit(true);
    setFirstName(customer.firstName);
    setMiddleName(customer.middleName || "");
    setLastName(customer.lastName);
    setPhone(customer.phone);
    setEmail(customer.email || "");
    setBillingAttention(customer.billingAttention || "");
    setBillingAddress(customer.billingAddress || "");
    setBillingStreet2(customer.billingStreet2 || "");
    setBillingCity(customer.billingCity || "");
    setBillingState(customer.billingState || "");
    setBillingZip(customer.billingZip || "");
    setBillingCountry(customer.billingCountry || "Kenya");
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
    setPpoeUsername(customer.ppoeUsername || customer.customerNumber || "");
    setPpoePassword(customer.tispPassword || "");
    setPpoeUsernameTouched(true);
    setProductId(String(customer.productId));
    if (customer.planId) {
      setPlanId(String(customer.planId));
    }

    const building = buildings.find((b) => b.id === customer.buildingId);
    const { prefix, lastOctet } = parseIpFromAddress(customer.ipAddress, building);
    setIpPrefix(prefix);
    setIpLastOctet(lastOctet);
    setInitializingEdit(false);
  }, [customer, buildings]);

  useEffect(() => {
    if (!customer?.planId || !catalog.length) return;
    for (const cat of catalog) {
      if (cat.plans?.some((p) => p.id === customer.planId)) {
        setCategoryId(String(cat.id));
        setPlanId(String(customer.planId));
        break;
      }
    }
  }, [customer, catalog]);

  const buildingOptions = useMemo(
    () =>
      buildings.map((b) => ({
        value: String(b.id),
        label: b.name,
        description: `${b.popName || "POP"}${b.buildingCode ? ` · ${b.buildingCode}` : ""} · ${b.ipSetup} · C2B ${b.c2bCode} · B2B ${b.b2bCode}`,
        keywords: `${b.popName || ""} ${b.buildingCode || ""} ${b.c2bCode} ${b.b2bCode}`,
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

  const selectedAgency = useMemo(
    () => agencies.find((a) => String(a.id) === agencyId) ?? null,
    [agencies, agencyId]
  );

  const b2bAgencyEmail =
    selectedAgency?.email?.trim() || customer?.agencyEmail?.trim() || "";

  const b2bAgencyPhone =
    selectedAgency?.phone?.trim() || customer?.agencyPhone?.trim() || "";

  const hasUsablePhone = (value: string) => value.replace(/\D/g, "").length >= 9;

  const b2bUsesAgencyPhone =
    customerType === "B2B" && hasUsablePhone(b2bAgencyPhone);
  const b2bUsesAgencyEmail =
    customerType === "B2B" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b2bAgencyEmail);

  const selectedCategory = catalog.find((c) => String(c.id) === categoryId);
  const isDstvOnly = selectedCategory?.code === "dstv_only";

  useEffect(() => {
    if (!isDstvOnly || !selectedCategory?.plans?.length) return;
    const firstPlan = selectedCategory.plans[0];
    if (!planId || !selectedCategory.plans.some((p) => String(p.id) === planId)) {
      setPlanId(String(firstPlan.id));
      setProductId("");
    }
  }, [isDstvOnly, selectedCategory, planId]);

  useEffect(() => {
    if (isEdit && !canEditPackage) return;
    if (!buildingId || !planId) {
      setPackages([]);
      if (!isEdit) setProductId("");
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
        if (!isEdit) setProductId("");
      })
      .finally(() => setPackagesLoading(false));
  }, [buildingId, paymentFrequency, categoryId, planId, isEdit, canEditPackage]);

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
  const isPpoe = selectedBuilding?.ipSetup === "PPOE";

  const previewCustomerNumber = useMemo(
    () =>
      buildCustomerNumberPreview(
        selectedBuilding,
        customerType,
        apartmentNumber
      ),
    [selectedBuilding, apartmentNumber, customerType]
  );

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

  // Create: default PPPoE username to customer number; regenerate password when POP changes.
  useEffect(() => {
    if (isEdit) return;
    if (!isPpoe) {
      setPpoeUsername("");
      setPpoePassword("");
      setPpoeUsernameTouched(false);
      return;
    }
    if (!ppoeUsernameTouched && previewCustomerNumber) {
      setPpoeUsername(previewCustomerNumber);
    }
  }, [isEdit, isPpoe, previewCustomerNumber, ppoeUsernameTouched]);

  useEffect(() => {
    if (isEdit || !isPpoe) return;
    setPpoePassword(generatePppoePassword());
  }, [isEdit, isPpoe, buildingId]);

  const selectedPackage = showPackageEditor
    ? packages.find((p) => String(p.id) === productId) || null
    : null;
  const buildingRequiresDecoderSerial = selectedBuilding
    ? selectedBuilding.dstvSetup === "decoder"
    : false;
  const packageHasDstv = Boolean(
    isEdit && !canEditPackage
      ? customer?.hasDstv
      : selectedCategory?.hasDstv || selectedPackage?.hasDstv || customer?.hasDstv
  );
  /** Show IUC/serial only for DSTV packages in decoder buildings (hidden for headend). */
  const showDstvSerialField = Boolean(packageHasDstv && buildingRequiresDecoderSerial);
  const requiresDstvSerial = showDstvSerialField;
  const packageAmount =
    isEdit && !canEditPackage
      ? customer?.packagePrice
      : paymentFrequency === "custom" && selectedPackage && customPeriodDays
        ? Math.round((selectedPackage.monthlyPrice * Number(customPeriodDays)) / 30)
        : selectedPackage?.price ?? (isEdit ? customer?.packagePrice : undefined);
  const decoderFee =
    packageHasDstv &&
    (selectedCategory?.requiresDecoderFee || selectedPackage?.hasDstv)
      ? selectedCategory?.decoderFeeAmount ||
        customer?.decoderFeeAmount ||
        2900
      : 0;
  const displayPrice =
    packageAmount == null
      ? undefined
      : !isEdit
        ? packageAmount + decoderFee
        : packageAmount;

  const previewCode = buildCustomerNumberPreview(
    buildings.find((x) => String(x.id) === buildingId),
    customerType,
    apartmentNumber
  );

  const previewIpResult = validateIpForBuilding(selectedBuilding, ipPrefix, ipLastOctet);
  const previewIp = previewIpResult.ok ? previewIpResult.ip : null;

  const fieldsDisabled =
    submitting ||
    confirmOpen ||
    paymentStatusOpen ||
    initializingEdit ||
    lookupsLoading;

  function clearAdvancePaymentFields() {
    setAdvancePaymentMethod("");
    setMpesaCode("");
    setPaystackReference("");
    setBankReference("");
    setPaymentCoversInternet(true);
    setPaymentCoversDecoder(true);
  }

  function billingFieldsMatchBuilding(building: Building | undefined): boolean {
    const mapped = buildingToBillingAddress(building);
    if (!mapped) return false;
    return (
      billingAttention.trim() === mapped.billingAttention &&
      billingAddress.trim() === mapped.billingAddress &&
      billingStreet2.trim() === mapped.billingStreet2 &&
      billingCity.trim() === mapped.billingCity &&
      billingState.trim() === mapped.billingState &&
      billingZip.trim() === mapped.billingZip &&
      (billingCountry.trim() || "Kenya") === (mapped.billingCountry || "Kenya")
    );
  }

  function applyBuildingBillingAddress(building: Building | undefined) {
    const mapped = buildingToBillingAddress(building);
    if (!mapped) return false;
    setBillingAttention(mapped.billingAttention);
    setBillingAddress(mapped.billingAddress);
    setBillingStreet2(mapped.billingStreet2);
    setBillingCity(mapped.billingCity);
    setBillingState(mapped.billingState);
    setBillingZip(mapped.billingZip);
    setBillingCountry(mapped.billingCountry || "Kenya");
    return true;
  }

  function onBuildingChange(nextBuildingId: string) {
    const previousBuilding = buildings.find((b) => String(b.id) === buildingId);
    const nextBuilding = buildings.find((b) => String(b.id) === nextBuildingId);
    const shouldFill =
      isBillingAddressEmpty({
        billingAttention,
        billingAddress,
        billingStreet2,
        billingCity,
        billingState,
        billingZip,
        billingCountry,
      }) || billingFieldsMatchBuilding(previousBuilding);

    setBuildingId(nextBuildingId);
    setPaymentFrequency("monthly");
    setCategoryId("");
    setPlanId("");
    setProductId("");

    if (shouldFill) {
      applyBuildingBillingAddress(nextBuilding);
    }
  }

  function paymentStatusSummaryLabel(): string {
    if (!paymentAlreadyMade) return "No payment";
    const covers: string[] = [];
    if (paymentCoversInternet) covers.push("Internet");
    if (packageHasDstv && paymentCoversDecoder) covers.push("decoder");
    const coverSuffix = covers.length ? ` · ${covers.join(" + ")}` : "";
    if (advancePaymentMethod === "mpesa") {
      return `Paid · M-Pesa ${mpesaCode.trim().toUpperCase() || "—"}${coverSuffix}`;
    }
    if (advancePaymentMethod === "paystack") {
      return `Paid · Paystack ${paystackReference.trim() || "—"}${coverSuffix}`;
    }
    if (advancePaymentMethod === "bank") {
      return bankReference.trim()
        ? `Paid · Bank transfer (${bankReference.trim()})${coverSuffix}`
        : `Paid · Bank transfer${coverSuffix}`;
    }
    return `Paid${coverSuffix}`;
  }

  function openPaymentStatusModal() {
    setPaymentStatusDraft({
      method: advancePaymentMethod,
      mpesaCode,
      paystackReference,
      bankReference,
      coversInternet: paymentCoversInternet,
      coversDecoder: packageHasDstv ? paymentCoversDecoder : false,
    });
    setPaymentStatusOpen(true);
  }

  function closePaymentStatusModal(commit: boolean) {
    if (commit && paymentStatusDraft) {
      const {
        method,
        mpesaCode: code,
        paystackReference: paystack,
        bankReference: bank,
        coversInternet,
        coversDecoder,
      } = paymentStatusDraft;
      if (!method) {
        toaster.create({
          title: "Payment method required",
          description: "Select M-Pesa, Paystack, or Direct Bank.",
          type: "error",
        });
        return;
      }
      if (method === "mpesa" && !/^[A-Z0-9]{8,15}$/i.test(code.trim())) {
        toaster.create({
          title: "M-Pesa receipt code required",
          description: "Enter the M-Pesa confirmation code (8–15 letters/numbers).",
          type: "error",
        });
        return;
      }
      if (method === "paystack" && !paystack.trim()) {
        toaster.create({
          title: "Paystack reference required",
          type: "error",
        });
        return;
      }
      if (!coversInternet && !(packageHasDstv && coversDecoder)) {
        toaster.create({
          title: "What did the payment cover?",
          description: packageHasDstv
            ? "Check Internet/package and/or DSTV decoder for this plan."
            : "Check Internet/package — payment must cover the selected plan.",
          type: "error",
        });
        return;
      }
      setPaymentAlreadyMade(true);
      setAdvancePaymentMethod(method);
      setMpesaCode(method === "mpesa" ? code.trim().toUpperCase() : "");
      setPaystackReference(method === "paystack" ? paystack.trim() : "");
      setBankReference(method === "bank" ? bank.trim() : "");
      setPaymentCoversInternet(coversInternet);
      setPaymentCoversDecoder(packageHasDstv ? coversDecoder : false);
      setTrialPeriod(false);
    } else if (!paymentAlreadyMade) {
      // Cancelled before completing — stay on No payment
      clearAdvancePaymentFields();
    }
    setPaymentStatusOpen(false);
    setPaymentStatusDraft(null);
  }

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
      {
        label: "Phone",
        value:
          phone.trim() ||
          (customerType === "B2B" && b2bAgencyPhone ? `${b2bAgencyPhone} (agency)` : "—"),
      },
      {
        label: "Email",
        value:
          email.trim() ||
          (customerType === "B2B" && b2bAgencyEmail ? `${b2bAgencyEmail} (agency)` : "—"),
      },
      {
        label: "Billing address",
        value:
          [billingAddress, billingCity, billingCountry]
            .map((s) => s.trim())
            .filter(Boolean)
            .join(", ") || "—",
      },
      {
        label: "Building",
        value: selectedBuilding?.name || customer?.buildingName || "—",
      },
      { label: "Apartment", value: apartmentNumber.trim() || "—" },
    ];

    if (selectedPackage) {
      const dstvOnlyPkg =
        selectedCategory?.code === "dstv_only" ||
        Number(selectedPackage.mbps || 0) <= 0;
      items.push({
        label: "Package",
        value: dstvOnlyPkg
          ? "DSTV Only"
          : `${selectedPackage.planName || selectedPackage.name} · ${selectedPackage.mbps} Mbps`,
      });
    } else if (isEdit && customer) {
      items.push({
        label: "Package",
        value: formatCustomerPackageLabel(customer.productName, customer.productMbps),
      });
    }
    if (displayPrice != null) {
      items.push({
        label: !isEdit && decoderFee > 0 ? "First invoice" : "Package price",
        value:
          !isEdit && decoderFee > 0
            ? `${formatCurrency(displayPrice)} (pkg ${formatCurrency(packageAmount)} + decoder ${formatCurrency(decoderFee)})`
            : formatCurrency(displayPrice),
      });
    }

    items.push({ label: "Billing frequency", value: freqLabel });
    if (!isEdit && trialPeriod) {
      items.push({
        label: "Trial period",
        value: "30 days — first invoice after trial",
      });
    }
    if (!isEdit && customerType === "C2B" && !trialPeriod) {
      items.push({
        label: "Advance payment",
        value: paymentStatusSummaryLabel(),
      });
      if (
        paymentAlreadyMade &&
        packageHasDstv &&
        paymentCoversInternet &&
        !paymentCoversDecoder
      ) {
        items.push({
          label: "Separate decoder invoice",
          value: `${formatCurrency(decoderFee || 2900)} — unpaid, emailed to customer`,
        });
      } else if (
        paymentAlreadyMade &&
        packageHasDstv &&
        !paymentCoversInternet &&
        paymentCoversDecoder
      ) {
        items.push({
          label: "Separate package invoice",
          value: `${formatCurrency(packageAmount || 0)} — unpaid, emailed to customer`,
        });
      } else if (paymentAlreadyMade && paymentCoversInternet) {
        items.push({
          label: "Package covered",
          value: `${formatCurrency(packageAmount || 0)} — marked paid from reference`,
        });
      }
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
    if (isPpoe && ppoeUsername.trim()) {
      items.push({ label: "PPPoE username", value: ppoeUsername.trim().toUpperCase() });
    }
    if (isPpoe && ppoePassword.trim()) {
      items.push({ label: "PPPoE password", value: ppoePassword.trim() });
    }
    if (showDstvSerialField && dstvDecoderSerial.trim()) {
      items.push({ label: "DSTV IUC/Serial", value: dstvDecoderSerial.trim().toUpperCase() });
    }

    if (isEdit && isActive) {
      items.push({
        label: "TISP",
        value: isDstvOnly
          ? "Not applicable (DSTV Only — Zoho only)"
          : onTisp
            ? tispDueDate
              ? `Update · due ${tispDueDate}`
              : "Update existing"
            : tispDueDate
              ? `Create · due ${tispDueDate}`
              : "Create (due date required)",
      });
      if (customerType === "C2B") {
        if (!onZoho) {
          items.push({
            label: "Zoho Books",
            value: [
              "Create contact",
              createInitialInvoice ? "initial invoice" : null,
              createRecurringInvoice ? "recurring" : null,
            ]
              .filter(Boolean)
              .join(" · "),
          });
        } else {
          items.push({
            label: "Zoho Books",
            value: [
              zohoInactive ? "Reactivate inactive contact" : "Update contact",
              createInitialInvoice ? "signup invoice" : null,
              hasActiveRecurring
                ? updateZohoRecurring
                  ? "refresh recurring"
                  : "recurring OK"
                : updateZohoRecurring
                  ? "set up recurring"
                  : "recurring missing",
              zohoInvoicesInSync ? "invoices synced" : "invoices missing",
              zohoPaymentsInSync ? "payments synced" : "payments out of sync",
            ]
              .filter(Boolean)
              .join(" · "),
          });
        }
      }
    }

    return items;
  }, [
    agencies,
    agencyId,
    apartmentNumber,
    b2bAgencyEmail,
    b2bAgencyPhone,
    billingAddress,
    billingCity,
    billingCountry,
    customer,
    customer?.buildingName,
    customer?.customerNumber,
    customer?.packagePrice,
    customer?.productMbps,
    customer?.productName,
    customerType,
    customPeriodDays,
    decoderFee,
    displayPrice,
    dstvDecoderSerial,
    email,
    firstName,
    isEdit,
    isPpoe,
    isVatExempt,
    lastName,
    middleName,
    paymentFrequency,
    phone,
    packageAmount,
    ppoePassword,
    ppoeUsername,
    previewCode,
    previewIp,
    requiresDstvSerial,
    showDstvSerialField,
    selectedBuilding?.name,
    selectedPackage,
    selectedCategory?.code,
    isDstvOnly,
    trialPeriod,
    paymentAlreadyMade,
    paymentCoversInternet,
    paymentCoversDecoder,
    packageHasDstv,
    decoderFee,
    advancePaymentMethod,
    mpesaCode,
    paystackReference,
    bankReference,
    isActive,
    onTisp,
    onZoho,
    tispDueDate,
    createInitialInvoice,
    createRecurringInvoice,
    updateZohoRecurring,
    hasActiveRecurring,
    zohoInvoicesInSync,
    zohoInvoiceCount,
    zohoPaymentsInSync,
    zohoInactive,
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
    if (isActive && (!isEdit || canEditPackage) && !productId) {
      toaster.create({ title: "Select a package", type: "error" });
      return false;
    }
    if (customerType === "B2B" && !agencyId) {
      toaster.create({ title: "Select an agency for B2B customers", type: "error" });
      return false;
    }
    const effectivePhone =
      phone.trim() || (customerType === "B2B" ? b2bAgencyPhone : "");
    if (!hasUsablePhone(effectivePhone)) {
      toaster.create({ title: "Phone is required", type: "error" });
      return false;
    }
    const effectiveEmail =
      email.trim() || (customerType === "B2B" ? b2bAgencyEmail : "");
    if (!effectiveEmail) {
      toaster.create({ title: "Email is required", type: "error" });
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(effectiveEmail)) {
      toaster.create({ title: "Enter a valid email address", type: "error" });
      return false;
    }
    if (requiresDstvSerial && !dstvDecoderSerial.trim()) {
      toaster.create({
        title: "DSTV decoder IUC/Serial required",
        description: "Enter the decoder IUC/serial number for DSTV packages in decoder buildings.",
        type: "error",
      });
      return false;
    }
    if (isPpoe) {
      if (!ppoeUsername.trim()) {
        toaster.create({ title: "PPPoE username is required", type: "error" });
        return false;
      }
      if (!ppoePassword.trim()) {
        toaster.create({ title: "PPPoE password is required", type: "error" });
        return false;
      }
      const passwordUnchanged =
        isEdit && ppoePassword === (customer?.tispPassword || "");
      if (!passwordUnchanged && !isValidPppoePassword(ppoePassword)) {
        toaster.create({
          title: "Invalid PPPoE password",
          description: "Use 4–50 characters: letters, numbers, and special characters (no spaces).",
          type: "error",
        });
        return false;
      }
    }
    if (isEdit && isActive && !isDstvOnly && !onTisp && !tispDueDate.trim()) {
      toaster.create({
        title: "TISP due date required",
        description: "Enter the customer due date to create them on TISP.",
        type: "error",
      });
      return false;
    }
    if (!isEdit && customerType === "C2B" && !trialPeriod) {
      if (paymentAlreadyMade) {
        if (!advancePaymentMethod) {
          toaster.create({
            title: "Payment method required",
            description: "Select how the customer paid (M-Pesa, Paystack, or Direct Bank).",
            type: "error",
          });
          openPaymentStatusModal();
          return false;
        }
        if (
          advancePaymentMethod === "mpesa" &&
          !/^[A-Z0-9]{8,15}$/i.test(mpesaCode.trim())
        ) {
          toaster.create({
            title: "M-Pesa receipt code required",
            description: "Enter the M-Pesa confirmation code (8–15 letters/numbers).",
            type: "error",
          });
          openPaymentStatusModal();
          return false;
        }
        if (
          advancePaymentMethod === "paystack" &&
          !paystackReference.trim()
        ) {
          toaster.create({
            title: "Paystack reference required",
            type: "error",
          });
          openPaymentStatusModal();
          return false;
        }
        if (
          !paymentCoversInternet &&
          !(packageHasDstv && paymentCoversDecoder)
        ) {
          toaster.create({
            title: "What did the payment cover?",
            description: packageHasDstv
              ? "Check Internet/package and/or DSTV decoder for this plan."
              : "Check Internet/package — payment must cover the selected plan.",
            type: "error",
          });
          openPaymentStatusModal();
          return false;
        }
      }
    }
    if (!isEdit && trialPeriod && paymentAlreadyMade) {
      toaster.create({
        title: "Cannot combine trial and advance payment",
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
          billingAttention: billingAttention.trim() || undefined,
          billingAddress: billingAddress.trim() || undefined,
          billingStreet2: billingStreet2.trim() || undefined,
          billingCity: billingCity.trim() || undefined,
          billingState: billingState.trim() || undefined,
          billingZip: billingZip.trim() || undefined,
          billingCountry:
            billingAddress.trim() ||
            billingCity.trim() ||
            billingAttention.trim() ||
            billingStreet2.trim() ||
            billingState.trim() ||
            billingZip.trim()
              ? billingCountry.trim() || "Kenya"
              : undefined,
          ipAddress: ipResult.ip || undefined,
          isVatExempt,
          customerType,
          agencyId: customerType === "B2B" ? Number(agencyId) : undefined,
          apartmentNumber: isActive ? apartmentNumber : undefined,
          // Explicitly clear serial when building is not decoder.
          dstvDecoderSerial: !buildingRequiresDecoderSerial
            ? null
            : requiresDstvSerial
              ? dstvDecoderSerial.trim().toUpperCase()
              : dstvDecoderSerial.trim()
                ? dstvDecoderSerial.trim().toUpperCase()
                : undefined,
          ...(isPpoe
            ? {
                ppoeUsername: ppoeUsername.trim().toUpperCase(),
                ppoePassword: ppoePassword.trim(),
              }
            : {}),
          ...(canEditPackage && isActive
            ? {
                paymentFrequency: paymentFrequency as Customer["paymentFrequency"],
                customPeriodDays:
                  paymentFrequency === "custom"
                    ? Number(customPeriodDays)
                    : undefined,
                productId: Number(productId),
              }
            : {}),
          ...(isActive && customerType === "C2B"
            ? {
                createInitialInvoice: createInitialInvoice || undefined,
                createRecurringInvoice: createRecurringInvoice || undefined,
                updateZohoRecurring: updateZohoRecurring || undefined,
                tispDueDate: tispDueDate.trim() || undefined,
              }
            : isActive
              ? { tispDueDate: tispDueDate.trim() || undefined }
              : {}),
        });

        if (res.tisp && !res.tisp.ok) {
          toaster.create({
            title: "Customer updated",
            description: `TISP sync failed: ${res.tisp.error}`,
            type: "warning",
            duration: 10000,
          });
        } else if (res.zoho && res.zoho.ok === false) {
          toaster.create({
            title: "Customer updated",
            description: `Zoho sync failed: ${res.zoho.error}`,
            type: "warning",
            duration: 10000,
          });
        } else {
          const dueHint =
            res.customer?.tispDueDate ||
            (typeof res.tisp?.dueDate === "string" ? res.tisp.dueDate : null);
          const zohoParts: string[] = [];
          if (res.zoho?.created) zohoParts.push("Zoho contact created");
          else if (res.zoho?.updated || res.zoho?.contactUpdated) {
            zohoParts.push("Zoho contact updated");
          }
          if (res.zoho?.invoice?.created) zohoParts.push("invoice sent");
          else if (res.zoho?.invoice?.reused) zohoParts.push("invoice emailed");
          if (res.zoho?.recurring?.created) zohoParts.push("recurring created");
          else if (res.zoho?.recurring?.updated) zohoParts.push("recurring updated");
          toaster.create({
            title: "Customer updated",
            description:
              zohoParts.length > 0
                ? `${zohoParts.join(" · ")}${dueHint ? ` · TISP due ${String(dueHint).slice(0, 10)}` : ""}`
                : dueHint
                  ? `Saved and synced. TISP due date: ${String(dueHint).slice(0, 10)}.`
                  : "Saved and synced to TISP and Zoho where applicable.",
            type: "success",
          });
        }
        if (res.customer?.tispDueDate || res.tisp?.dueDate) {
          setTispDueDate(
            toDateInputValue(res.customer?.tispDueDate) ||
              toDateInputValue(
                typeof res.tisp?.dueDate === "string" ? res.tisp.dueDate : null
              ) ||
              tispDueDate
          );
        }
        if (res.tisp?.ok && (res.tisp.created || res.tisp.updated)) {
          setOnTisp(true);
        }
        if (res.zoho?.ok && (res.zoho.created || res.zoho.updated)) {
          setOnZoho(true);
          setZohoInactive(false);
        }
        // Update syncs TISP/Zoho on the server and starts a cooldown — keep the
        // refresh button in sync so the first press is not a silent 429 miss.
        startSyncCooldown(customer.id);
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
        billingAttention: billingAttention.trim() || undefined,
        billingAddress: billingAddress.trim() || undefined,
        billingStreet2: billingStreet2.trim() || undefined,
        billingCity: billingCity.trim() || undefined,
        billingState: billingState.trim() || undefined,
        billingZip: billingZip.trim() || undefined,
        billingCountry:
          billingAddress.trim() ||
          billingCity.trim() ||
          billingAttention.trim() ||
          billingStreet2.trim() ||
          billingState.trim() ||
          billingZip.trim()
            ? billingCountry.trim() || "Kenya"
            : undefined,
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
        ...(isPpoe
          ? {
              ppoeUsername: ppoeUsername.trim().toUpperCase(),
              ppoePassword: ppoePassword.trim(),
            }
          : {}),
        trialPeriod: trialPeriod || undefined,
        paymentAlreadyMade:
          customerType === "C2B" && paymentAlreadyMade === true ? true : undefined,
        paymentMethod:
          customerType === "C2B" &&
          paymentAlreadyMade === true &&
          advancePaymentMethod
            ? advancePaymentMethod
            : undefined,
        mpesaCode:
          customerType === "C2B" &&
          paymentAlreadyMade === true &&
          advancePaymentMethod === "mpesa"
            ? mpesaCode.trim().toUpperCase()
            : undefined,
        paystackReference:
          customerType === "C2B" &&
          paymentAlreadyMade === true &&
          advancePaymentMethod === "paystack"
            ? paystackReference.trim()
            : undefined,
        bankReference:
          customerType === "C2B" &&
          paymentAlreadyMade === true &&
          advancePaymentMethod === "bank"
            ? bankReference.trim() || undefined
            : undefined,
        paymentCoversInternet:
          customerType === "C2B" && paymentAlreadyMade === true
            ? paymentCoversInternet
            : undefined,
        paymentCoversDecoder:
          customerType === "C2B" &&
          paymentAlreadyMade === true &&
          packageHasDstv
            ? paymentCoversDecoder
            : undefined,
      });

      if (!res.tisp.ok) {
        toaster.create({
          title: `Customer ${res.customer.customerNumber} saved locally`,
          description: `TISP registration failed: ${res.tisp.error}`,
          type: "warning",
          duration: 12000,
        });
      } else if (res.zoho && res.zoho.ok === false) {
        toaster.create({
          title: `Customer ${res.customer.customerNumber} created`,
          description: `Zoho billing setup failed: ${res.zoho.error}`,
          type: "warning",
          duration: 12000,
        });
      } else if (res.zoho?.billingSkipped) {
        toaster.create({
          title: "Customer created",
          description: `${res.customer.customerNumber} — linked existing Zoho contact. Signup invoice and recurring were skipped; enable them when editing the customer if needed.`,
          type: "success",
          duration: 12000,
        });
      } else if (res.zoho?.invoice?.paid) {
        const refLabel =
          res.zoho.invoice.mpesaCode ||
          res.zoho.invoice.paymentReference ||
          (advancePaymentMethod === "mpesa"
            ? mpesaCode.trim().toUpperCase()
            : advancePaymentMethod === "paystack"
              ? paystackReference.trim()
              : bankReference.trim() || "bank transfer");
        const matchNote =
          res.zoho.invoice.paymentMatch === true
            ? " · amount MATCHES package"
            : res.zoho.invoice.paymentMatch === false
              ? " · amount MISMATCH vs package (see invoice notes)"
              : "";
        const outstanding = res.zoho?.outstandingInvoice;
        const outstandingNote =
          outstanding?.created && outstanding.invoiceNumber
            ? outstanding.decoderOnly
              ? ` · separate decoder invoice ${outstanding.invoiceNumber} issued`
              : outstanding.packageOnly
                ? ` · separate package invoice ${outstanding.invoiceNumber} issued`
                : outstanding.balanceOnly
                  ? ` · separate balance invoice ${outstanding.invoiceNumber} issued`
                  : ` · separate invoice ${outstanding.invoiceNumber} issued`
            : outstanding?.error
              ? ` · separate invoice failed: ${outstanding.error}`
              : "";
        toaster.create({
          title: "Customer created",
          description: `${res.customer.customerNumber} — ${
            res.zoho.invoice.paymentAttached
              ? "Zoho payment attached"
              : "signup invoice marked paid"
          } (ref ${refLabel})${matchNote}${outstandingNote}${
            res.zoho.invoice.receiptEmailed || res.zoho.invoice.emailed
              ? " · receipt emailed"
              : ""
          }${
            res.zoho.recurring?.created || res.zoho.recurring?.updated
              ? " · recurring set up"
              : ""
          }`.trim(),
          type:
            res.zoho.invoice.paymentMatch === false || outstanding?.error
              ? "warning"
              : "success",
          duration: 14000,
        });
      } else if (res.zoho?.invoice?.paymentError) {
        toaster.create({
          title: `Customer ${res.customer.customerNumber} created`,
          description: `Signup invoice created but payment reconciliation failed: ${res.zoho.invoice.paymentError}. Mark the invoice paid from Billing if needed.`,
          type: "warning",
          duration: 14000,
        });
      } else {
        const invoiceBits = [];
        if (res.zoho?.invoice?.invoiceNumber) {
          invoiceBits.push(`invoice ${res.zoho.invoice.invoiceNumber}`);
        }
        if (res.zoho?.invoice?.emailed) {
          invoiceBits.push("emailed to customer");
        } else if (
          !trialPeriod &&
          customerType === "C2B" &&
          res.zoho?.invoice?.created
        ) {
          invoiceBits.push("invoice created");
        }
        if (res.zoho?.recurring?.created || res.zoho?.recurring?.updated) {
          invoiceBits.push("recurring set up");
        }
        toaster.create({
          title: "Customer created",
          description: trialPeriod
            ? `${res.customer.customerNumber} — 30-day trial, billing starts after trial${
                res.zoho?.recurring?.created || res.zoho?.recurring?.updated
                  ? " · recurring set up"
                  : ""
              }`
            : invoiceBits.length
              ? `${res.customer.customerNumber} — ${invoiceBits.join(" · ")}`
              : res.customer.customerNumber,
          type: "success",
          duration: 10000,
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
    <form onSubmit={handleSubmit} autoComplete="off">
      <Stack gap={4}>
        <FormSection
          title="Location"
          sideBySide
        >
          <Field.Root required w="full">
            <Field.Label>Building</Field.Label>
            {isEdit ? (
              <Input
                value={selectedBuilding?.name || customer?.buildingName || ""}
                readOnly
                bg="bg.subtle"
              />
            ) : (
              <SearchableSelect
                value={buildingId}
                disabled={fieldsDisabled}
                isLoading={lookupsLoading}
                onChange={onBuildingChange}
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
              onChange={(e) => setApartmentNumber(e.target.value.toUpperCase())}
              placeholder="e.g. S444"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              readOnly={!isActive}
              disabled={fieldsDisabled}
              bg={!isActive ? "gray.50" : undefined}
            />
            {isActive && occupancyChecking && apartmentNumber.trim() && buildingId ? (
              <Text fontSize="xs" color="fg.muted" mt={1}>
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

        <FormSection title="Package & billing">
          {isEdit && customer && !showPackageEditor ? (
            <>
              <Field.Root opacity={0.92}>
                <Field.Label color="fg.muted">Current package</Field.Label>
                <Input
                  {...lockedPackageFieldProps}
                  value={formatCustomerPackageLabel(customer.productName, customer.productMbps)}
                />
              </Field.Root>
              <Field.Root opacity={0.92}>
                <Field.Label color="fg.muted">Price</Field.Label>
                <Input
                  {...lockedPackageFieldProps}
                  value={formatCurrency(customer.packagePrice)}
                />
              </Field.Root>
              <Field.Root opacity={0.92}>
                <Field.Label color="fg.muted">Payment frequency</Field.Label>
                <Input {...lockedPackageFieldProps} value={editFrequencyLabel} />
              </Field.Root>
              {showDstvSerialField && (
                <Field.Root required={requiresDstvSerial} gridColumn={{ md: "span 2" }}>
                  <Field.Label>DSTV decoder IUC/Serial number</Field.Label>
                  <Input
                    value={dstvDecoderSerial}
                    onChange={(e) => setDstvDecoderSerial(e.target.value.toUpperCase())}
                    placeholder="e.g. H7G4K2M9P1"
                    fontFamily="mono"
                    readOnly={!isActive}
                    disabled={fieldsDisabled}
                    bg={!isActive ? "gray.50" : undefined}
                  />
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
          <Field.Root required={!isDstvOnly}>
            <Field.Label>Plan</Field.Label>
            <SelectField
              disabled={fieldsDisabled || !categoryId || !isActive || isDstvOnly}
              fieldProps={{
                value: planId,
                onChange: (e) => {
                  setPlanId(e.target.value);
                  setProductId("");
                },
                bg: isDstvOnly ? "bg.subtle" : undefined,
              }}
            >
              <option value="">
                {!categoryId
                  ? "Select a category first"
                  : isDstvOnly
                    ? "DSTV Only"
                    : "Select plan"}
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
              disabled={
                fieldsDisabled ||
                !buildingId ||
                (!isDstvOnly && !planId) ||
                !isActive
              }
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
                  : !planId && !isDstvOnly
                    ? "Select category and plan first"
                    : packages.length === 0
                      ? "No price set for this building — add it under Packages"
                      : "Select price"}
              </option>
              {packages.map((p) => (
                <option key={p.id} value={p.id} title={p.name}>
                  {isDstvOnly
                    ? formatCurrency(p.price)
                    : `${p.mbps} Mbps · ${formatCurrency(p.price)}${
                        p.hasDstv ? " · +DSTV" : ""
                      }`}
                </option>
              ))}
            </SelectField>
          </Field.Root>
          {isEdit &&
            canEditPackage &&
            customer &&
            selectedPackage &&
            (Number(selectedPackage.price) !== Number(customer.packagePrice || 0) ||
              Boolean(customer.hasDstv) !== Boolean(selectedPackage.hasDstv)) && (
            <Box gridColumn={{ md: "span 2" }} bg="red.50" borderRadius="md" px={3} py={2}>
              <Text fontSize="sm" color="red.800" fontWeight="medium">
                Use{" "}
                {Number(selectedPackage.price) > Number(customer.packagePrice || 0) ||
                (!customer.hasDstv && Boolean(selectedPackage.hasDstv))
                  ? "Upgrade Package"
                  : "Downgrade Package"}{" "}
                — do not save this change here
              </Text>
              <Text fontSize="xs" color="red.700" mt={0.5}>
                Editing the package on this form does not update Zoho invoices. Price
                or DSTV changes must go through Upgrade/Downgrade so the customer is
                billed correctly (including the one-time decoder fee when DSTV is
                added).
              </Text>
            </Box>
          )}
          {showDstvSerialField && (
            <Field.Root required={requiresDstvSerial} gridColumn={{ md: "span 2" }}>
              <Field.Label>DSTV decoder IUC/Serial number</Field.Label>
              <Input
                value={dstvDecoderSerial}
                onChange={(e) => setDstvDecoderSerial(e.target.value.toUpperCase())}
                placeholder="e.g. H7G4K2M9P1"
                fontFamily="mono"
                readOnly={!isActive}
                disabled={fieldsDisabled}
                bg={!isActive ? "gray.50" : undefined}
              />
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
            </Field.Root>
          )}
          <Field.Root
            gridColumn={
              !isEdit && customerType === "C2B" && !trialPeriod
                ? undefined
                : { md: "span 2" }
            }
          >
            <Field.Label>Trial period</Field.Label>
            <SelectField
              disabled={
                fieldsDisabled ||
                !isActive ||
                isEdit ||
                paymentAlreadyMade
              }
              fieldProps={{
                value: trialPeriod ? "yes" : "no",
                onChange: (e) => {
                  const on = e.target.value === "yes";
                  setTrialPeriod(on);
                  if (on) {
                    setPaymentAlreadyMade(false);
                    clearAdvancePaymentFields();
                  }
                },
              }}
            >
              <option value="no">No trial</option>
              <option value="yes">30-day trial</option>
            </SelectField>
          </Field.Root>
          {!isEdit && customerType === "C2B" && !trialPeriod ? (
            <Field.Root>
              <Field.Label>Has the customer already paid?</Field.Label>
              <SelectField
                disabled={fieldsDisabled || !isActive}
                fieldProps={{
                  value:
                    paymentAlreadyMade || paymentStatusOpen ? "yes" : "no",
                  onChange: (e) => {
                    if (e.target.value === "yes") {
                      openPaymentStatusModal();
                    } else {
                      setPaymentAlreadyMade(false);
                      clearAdvancePaymentFields();
                    }
                  },
                }}
              >
                <option value="no">No payment</option>
                <option value="yes">Yes — already paid</option>
              </SelectField>
              {paymentAlreadyMade ? (
                <Flex mt={2} align="center" gap={2} flexWrap="wrap">
                  <Text fontSize="sm" color="fg.muted" fontFamily="mono">
                    {paymentStatusSummaryLabel()}
                  </Text>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="brand"
                    disabled={fieldsDisabled || !isActive}
                    onClick={() => openPaymentStatusModal()}
                  >
                    Edit details
                  </Button>
                </Flex>
              ) : null}
            </Field.Root>
          ) : null}
            </>
          )}
        </FormSection>

        {isEdit && isActive && !isDstvOnly ? (
          <FormSection title="TISP">
            <Box gridColumn={{ md: "span 2" }}>
              <Flex align="center" gap={2}>
                <Text fontSize="sm" color="fg.muted">
                  Status
                </Text>
                <TextStatus
                  status={
                    integrationsLoading ? "Pending" : onTisp ? "Synced" : "Failed"
                  }
                />
                <Text fontSize="xs" color="fg.muted">
                  {integrationsLoading
                    ? "Checking…"
                    : onTisp
                      ? "Linked"
                      : "Not on TISP"}
                </Text>
              </Flex>
            </Box>

            <Field.Root required={!onTisp} gridColumn={{ md: "span 2" }}>
              <Field.Label>
                {onTisp ? "Due date (optional update)" : "Due date"}
              </Field.Label>
              <DateField
                value={tispDueDate}
                onChange={setTispDueDate}
                disabled={fieldsDisabled || integrationsLoading}
                placeholder="Select due date"
              />
              {!onTisp ? (
                <Field.HelperText>
                  Required to create on TISP (default {TISP_STANDARD_DUE_DATE}).
                </Field.HelperText>
              ) : null}
            </Field.Root>
          </FormSection>
        ) : null}

        {isEdit && isActive && isDstvOnly ? (
          <FormSection title="TISP">
            <Box gridColumn={{ md: "span 2" }}>
              <Text fontSize="sm" color="fg.muted">
                DSTV Only customers are not added on TISP (no bandwidth). Billing is handled in Zoho Books.
              </Text>
            </Box>
          </FormSection>
        ) : null}

        {isEdit && isActive ? (
          <FormSection title="Zoho Books">
            <Box gridColumn={{ md: "span 2" }}>
              {customerType === "B2B" ? (
                <Text fontSize="sm" color="fg.muted">
                  Billed via agency Zoho contact.
                </Text>
              ) : (
                <Stack gap={2}>
                  <Flex align="center" gap={2} flexWrap="wrap">
                    <Text fontSize="sm" color="fg.muted" minW="5.5rem">
                      Contact
                    </Text>
                    <TextStatus
                      status={
                        integrationsLoading
                          ? "Pending"
                          : !onZoho
                            ? "Failed"
                            : zohoInactive
                              ? "Suspended"
                              : "Synced"
                      }
                    />
                    <Text fontSize="xs" color="fg.muted">
                      {integrationsLoading
                        ? "Checking…"
                        : !onZoho
                          ? "Missing"
                          : zohoInactive
                            ? "Found — inactive on Zoho"
                            : "Linked"}
                    </Text>
                  </Flex>
                  {zohoInactive && onZoho && !integrationsLoading ? (
                    <Text fontSize="sm" color="orange.600">
                      This contact exists in Zoho but is inactive. Saving will reactivate it
                      and update their details.
                    </Text>
                  ) : null}
                  <Flex align="center" gap={2} flexWrap="wrap">
                    <Text fontSize="sm" color="fg.muted" minW="5.5rem">
                      Invoices
                    </Text>
                    <TextStatus
                      status={
                        integrationsLoading
                          ? "Pending"
                          : !onZoho
                            ? "Unknown"
                            : zohoInvoicesInSync
                              ? "Synced"
                              : "Failed"
                      }
                    />
                    <Text fontSize="xs" color="fg.muted">
                      {integrationsLoading
                        ? "Checking…"
                        : !onZoho
                          ? "N/A"
                          : zohoInvoicesInSync
                            ? `${zohoInvoiceCount} on file`
                            : "None found"}
                    </Text>
                  </Flex>
                  <Flex align="center" gap={2} flexWrap="wrap">
                    <Text fontSize="sm" color="fg.muted" minW="5.5rem">
                      Last payment
                    </Text>
                    <TextStatus
                      status={
                        integrationsLoading
                          ? "Pending"
                          : !onZoho
                            ? "Unknown"
                            : zohoPaymentsInSync
                              ? "Synced"
                              : "Failed"
                      }
                    />
                    {!integrationsLoading && onZoho ? (
                      <Text fontSize="xs" color="fg.muted">
                        {zohoLastPaymentDate || dashboardLastPaymentDate
                          ? formatDateOnly(
                              zohoLastPaymentDate || dashboardLastPaymentDate
                            )
                          : "—"}
                        {zohoPaymentsInSync ? " (Zoho)" : " · aligning to Zoho…"}
                      </Text>
                    ) : null}
                  </Flex>
                  <Flex align="center" gap={2} flexWrap="wrap">
                    <Text fontSize="sm" color="fg.muted" minW="5.5rem">
                      Recurring
                    </Text>
                    <TextStatus
                      status={
                        integrationsLoading
                          ? "Pending"
                          : !onZoho
                            ? "Unknown"
                            : hasActiveRecurring
                              ? "Active"
                              : "Failed"
                      }
                    />
                    <Text fontSize="xs" color="fg.muted">
                      {integrationsLoading
                        ? "Checking…"
                        : !onZoho
                          ? "N/A"
                          : hasActiveRecurring
                            ? nextRecurringDate
                              ? `Next ${formatDateOnly(nextRecurringDate)}`
                              : "Profile active"
                            : recurringStatus && recurringStatus !== "missing"
                              ? recurringStatus
                              : "Not set"}
                    </Text>
                  </Flex>
                </Stack>
              )}
            </Box>

            {customerType === "C2B" && !onZoho ? (
              <>
                <Field.Root>
                  <Field.Label>Initial invoice</Field.Label>
                  <SelectField
                    disabled={fieldsDisabled || integrationsLoading}
                    fieldProps={{
                      value: createInitialInvoice ? "yes" : "no",
                      onChange: (e) =>
                        setCreateInitialInvoice(e.target.value === "yes"),
                    }}
                  >
                    <option value="no">No — create contact only</option>
                    <option value="yes">Yes — create signup invoice</option>
                  </SelectField>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Recurring invoice</Field.Label>
                  <SelectField
                    disabled={fieldsDisabled || integrationsLoading}
                    fieldProps={{
                      value: createRecurringInvoice ? "yes" : "no",
                      onChange: (e) =>
                        setCreateRecurringInvoice(e.target.value === "yes"),
                    }}
                  >
                    <option value="no">No — skip for now</option>
                    <option value="yes">Yes — create recurring profile</option>
                  </SelectField>
                </Field.Root>
              </>
            ) : null}

            {customerType === "C2B" && onZoho ? (
              <Field.Root gridColumn={{ md: "span 2" }}>
                <Field.Label>Create signup invoice</Field.Label>
                <SelectField
                  disabled={fieldsDisabled || integrationsLoading}
                  fieldProps={{
                    value: createInitialInvoice ? "yes" : "no",
                    onChange: (e) =>
                      setCreateInitialInvoice(e.target.value === "yes"),
                  }}
                >
                  <option value="no">No — leave billing as-is</option>
                  <option value="yes">Yes — create signup invoice on save</option>
                </SelectField>
                <Field.HelperText>
                  Use when this customer was already in Zoho at signup and the
                  initial invoice was skipped.
                  {zohoInvoiceCount > 0
                    ? ` (${zohoInvoiceCount} invoice${zohoInvoiceCount === 1 ? "" : "s"} already on Zoho)`
                    : null}
                </Field.HelperText>
              </Field.Root>
            ) : null}

            {customerType === "C2B" && onZoho && !hasActiveRecurring ? (
              <Field.Root gridColumn={{ md: "span 2" }}>
                <Field.Label>Set up recurring invoice</Field.Label>
                <SelectField
                  disabled={fieldsDisabled || integrationsLoading}
                  fieldProps={{
                    value: updateZohoRecurring ? "yes" : "no",
                    onChange: (e) =>
                      setUpdateZohoRecurring(e.target.value === "yes"),
                  }}
                >
                  <option value="no">No — leave without recurring</option>
                  <option value="yes">Yes — create recurring profile on save</option>
                </SelectField>
                <Field.HelperText>
                  Use when this customer was already in Zoho at signup and
                  recurring billing was skipped.
                </Field.HelperText>
              </Field.Root>
            ) : null}

            {customerType === "C2B" && onZoho && hasActiveRecurring ? (
              <Field.Root gridColumn={{ md: "span 2" }}>
                <Field.Label>Update recurring invoice</Field.Label>
                <SelectField
                  disabled={fieldsDisabled || integrationsLoading}
                  fieldProps={{
                    value: updateZohoRecurring ? "yes" : "no",
                    onChange: (e) =>
                      setUpdateZohoRecurring(e.target.value === "yes"),
                  }}
                >
                  <option value="no">No — leave recurring as-is</option>
                  <option value="yes">Yes — sync to current package and frequency</option>
                </SelectField>
              </Field.Root>
            ) : null}
          </FormSection>
        ) : null}

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
          <Field.Root required={!b2bUsesAgencyPhone}>
            <Field.Label>Phone</Field.Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={
                customerType === "B2B" && b2bAgencyPhone
                  ? b2bAgencyPhone
                  : "07xx xxx xxx"
              }
              disabled={fieldsDisabled}
            />
            {b2bUsesAgencyPhone ? (
              <Field.HelperText>Leave blank to use agency phone</Field.HelperText>
            ) : null}
          </Field.Root>
          <Field.Root required={!b2bUsesAgencyEmail}>
            <Field.Label>Email</Field.Label>
            <Input
              type={b2bUsesAgencyEmail ? "text" : "email"}
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={
                customerType === "B2B" && b2bAgencyEmail
                  ? b2bAgencyEmail
                  : "name@example.com"
              }
              disabled={fieldsDisabled}
            />
            {b2bUsesAgencyEmail ? (
              <Field.HelperText>Leave blank to use agency email</Field.HelperText>
            ) : null}
          </Field.Root>
        </FormSection>

        <FormSection title="Billing address">
          <Field.Root>
            <Field.Label>Attention</Field.Label>
            <Input
              value={billingAttention}
              onChange={(e) => setBillingAttention(e.target.value)}
              placeholder="Billing contact name"
              disabled={fieldsDisabled}
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Street address</Field.Label>
            <Input
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              placeholder="Street / building"
              disabled={fieldsDisabled}
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Street 2</Field.Label>
            <Input
              value={billingStreet2}
              onChange={(e) => setBillingStreet2(e.target.value)}
              placeholder="Apartment, suite, PO Box"
              disabled={fieldsDisabled}
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>City</Field.Label>
            <Input
              value={billingCity}
              onChange={(e) => setBillingCity(e.target.value)}
              placeholder="Nairobi"
              disabled={fieldsDisabled}
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>State / County</Field.Label>
            <Input
              value={billingState}
              onChange={(e) => setBillingState(e.target.value)}
              placeholder="Nairobi"
              disabled={fieldsDisabled}
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>ZIP / Postal code</Field.Label>
            <Input
              value={billingZip}
              onChange={(e) => setBillingZip(e.target.value)}
              placeholder="00100"
              disabled={fieldsDisabled}
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Country</Field.Label>
            <Input
              value={billingCountry}
              onChange={(e) => setBillingCountry(e.target.value)}
              placeholder="Kenya"
              disabled={fieldsDisabled}
              autoComplete="off"
            />
          </Field.Root>
        </FormSection>

        <FormSection title="Account type">
          <Field.Root required>
            <Field.Label>Customer type</Field.Label>
            <SelectField
              disabled={fieldsDisabled || isEdit}
              fieldProps={{
                value: customerType,
                onChange: (e) => {
                  const next = e.target.value as "C2B" | "B2B";
                  setCustomerType(next);
                  if (next === "B2B") {
                    setPaymentAlreadyMade(false);
                    clearAdvancePaymentFields();
                  }
                },
              }}
            >
              <option value="C2B">C2B — invoice to customer</option>
              <option value="B2B">B2B — invoice to agency</option>
            </SelectField>
            {isEdit ? (
              <Field.HelperText>
                Use Convert to C2B/B2B from the customer menu.
              </Field.HelperText>
            ) : null}
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
          <FormSection title="Network">
            {needsIp && ipRules ? (
              <Box gridColumn={{ md: "span 2" }}>
                <Field.Root required>
                  <Field.Label>IP address</Field.Label>
                  <Flex
                    direction={{ base: "column", sm: "row" }}
                    gap={3}
                    align={{ sm: "stretch" }}
                  >
                    {ipRules.prefixes.length > 1 ? (
                      <Box maxW={{ sm: "220px" }} w={{ base: "100%", sm: "auto" }} flexShrink={0}>
                        <SelectField
                          disabled={fieldsDisabled}
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
                        disabled={fieldsDisabled}
                        {...embeddedFieldInputStyles}
                      />
                    </Flex>
                  </Flex>
                </Field.Root>
              </Box>
            ) : null}
            {isPpoe ? (
              <Field.Root required>
                <Field.Label>PPPoE username</Field.Label>
                <Input
                  value={ppoeUsername}
                  onChange={(e) => {
                    setPpoeUsernameTouched(true);
                    setPpoeUsername(e.target.value.toUpperCase());
                  }}
                  placeholder={previewCustomerNumber || "e.g. SKY-302"}
                  fontFamily="mono"
                  readOnly={!isActive}
                  disabled={fieldsDisabled}
                  bg={!isActive ? "gray.50" : undefined}
                />
              </Field.Root>
            ) : null}
            {isPpoe ? (
              <Field.Root required>
                <Field.Label>PPPoE password</Field.Label>
                <Flex gap={2} align="stretch">
                  <Input
                    value={ppoePassword}
                    onChange={(e) => setPpoePassword(e.target.value)}
                    placeholder="7-letter password"
                    fontFamily="mono"
                    readOnly={!isActive}
                    disabled={fieldsDisabled}
                    bg={!isActive ? "gray.50" : undefined}
                    flex={1}
                  />
                  {isActive ? (
                    <Button
                      type="button"
                      variant="outline"
                      flexShrink={0}
                      disabled={fieldsDisabled}
                      onClick={() => setPpoePassword(generatePppoePassword())}
                    >
                      Regenerate
                    </Button>
                  ) : null}
                </Flex>
              </Field.Root>
            ) : null}
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
      <Dialog.Header borderBottomWidth="1px" borderColor="border.muted" px={5} py={4} pr={12}>
        <Dialog.Title fontSize="lg">
          {isEdit ? "Confirm customer update" : "Confirm new customer"}
        </Dialog.Title>
      </Dialog.Header>
      <Dialog.Body px={5} py={4}>
        <FormSubmitSummary
          description={
            isEdit
              ? undefined
              : trialPeriod
                ? "Creates with a 30-day trial — no signup invoice."
                : paymentAlreadyMade === true
                  ? packageHasDstv &&
                    paymentCoversInternet &&
                    !paymentCoversDecoder
                    ? `Creates the customer, marks the Internet invoice paid (${formatCurrency(packageAmount || 0)}), and issues a separate unpaid DSTV decoder invoice (${formatCurrency(decoderFee || 2900)}) to the customer.`
                    : packageHasDstv &&
                        !paymentCoversInternet &&
                        paymentCoversDecoder
                      ? `Creates the customer, marks the decoder invoice paid (${formatCurrency(decoderFee || 2900)}), and issues a separate unpaid Internet/package invoice (${formatCurrency(packageAmount || 0)}).`
                      : `Creates the customer, marks the package invoice paid (${formatCurrency(
                          (paymentCoversInternet ? Number(packageAmount || 0) : 0) +
                            (packageHasDstv && paymentCoversDecoder
                              ? Number(decoderFee || 2900)
                              : 0)
                        )} from the payment reference). If the payment is short of the plan total, a separate balance invoice is issued.`
                  : customerType === "C2B"
                    ? "Creates the customer, issues a signup invoice in Zoho Books, and emails it to the customer."
                    : undefined
          }
          items={summaryItems}
        />
        {!isEdit && paymentAlreadyMade ? (
          <Box
            mt={4}
            px={3}
            py={2.5}
            bg="orange.50"
            border="1px solid"
            borderColor="orange.200"
            borderRadius="md"
          >
            <Text fontSize="sm" fontWeight="semibold" color="orange.900">
              {packageHasDstv &&
              paymentCoversInternet &&
              !paymentCoversDecoder
                ? "Confirm: Internet paid only — decoder billed separately"
                : packageHasDstv &&
                    !paymentCoversInternet &&
                    paymentCoversDecoder
                  ? "Confirm: Decoder paid only — package billed separately"
                  : "Confirm advance payment against this package"}
            </Text>
            <Text fontSize="xs" color="orange.800" mt={1}>
              {packageHasDstv &&
              paymentCoversInternet &&
              !paymentCoversDecoder
                ? `This customer is on a DSTV package but payment covers Internet only. We will mark the package invoice paid and create a separate unpaid decoder invoice for ${formatCurrency(decoderFee || 2900)} (emailed to the customer).`
                : packageHasDstv &&
                    !paymentCoversInternet &&
                    paymentCoversDecoder
                  ? `Payment covers the DSTV decoder only. We will mark the decoder invoice paid and create a separate unpaid Internet/package invoice for ${formatCurrency(packageAmount || 0)}.`
                  : `Selected plan: ${formatCurrency(packageAmount || 0)}${
                      packageHasDstv && paymentCoversDecoder
                        ? ` + decoder ${formatCurrency(decoderFee || 2900)}`
                        : ""
                    }. We will create the Zoho invoice from this package, attach the payment reference, and mark it paid. Any shortfall vs the plan total gets a separate unpaid balance invoice.`}
            </Text>
          </Box>
        ) : null}
        {submitting ? (
          <Text fontSize="sm" color="brand.700" mt={4}>
            Saving and syncing…
          </Text>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer px={5} py={4} borderTopWidth="1px" borderColor="border.muted" gap={2}>
        <Button variant="ghost" disabled={submitting} onClick={() => setConfirmOpen(false)}>
          Back to edit
        </Button>
        <Button
          colorPalette="brand"
          loading={submitting}
          onClick={() => void executeSubmit()}
        >
          {isEdit
            ? "Confirm update"
            : paymentAlreadyMade
              ? packageHasDstv &&
                ((paymentCoversInternet && !paymentCoversDecoder) ||
                  (!paymentCoversInternet && paymentCoversDecoder))
                ? "Confirm — create with separate invoice"
                : "Confirm — create & mark paid"
              : "Confirm create"}
        </Button>
      </Dialog.Footer>
    </AppDialog>
  );

  const paymentStatusDialog = (
    <AppDialog
      open={paymentStatusOpen}
      onOpenChange={(details) => {
        if (!details.open) closePaymentStatusModal(false);
      }}
      maxW="sm"
      zIndex={embedded ? NESTED_APP_DIALOG_Z_INDEX : undefined}
      showCloseButton
    >
      <Dialog.Header borderBottomWidth="1px" borderColor="border.muted" px={5} py={3.5} pr={12}>
        <Dialog.Title fontSize="lg">Select Advanced payment method</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body px={5} py={4} flex="none">
        <Stack gap={3}>
          <Field.Root required>
            <Field.Label>Payment method</Field.Label>
            <SelectField
              fieldProps={{
                value: paymentStatusDraft?.method || "",
                onChange: (e) => {
                  const method = e.target.value as
                    | ""
                    | "mpesa"
                    | "paystack"
                    | "bank";
                  setPaymentStatusDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          method,
                          mpesaCode: method === "mpesa" ? prev.mpesaCode : "",
                          paystackReference:
                            method === "paystack" ? prev.paystackReference : "",
                          bankReference:
                            method === "bank" ? prev.bankReference : "",
                        }
                      : prev
                  );
                },
              }}
            >
              <option value="">Select payment method…</option>
              <option value="mpesa">M-Pesa</option>
              <option value="paystack">Paystack</option>
              <option value="bank">Direct Bank</option>
            </SelectField>
          </Field.Root>

          {paymentStatusDraft?.method === "mpesa" ? (
            <Field.Root required>
              <Field.Label>Payment REFERENCE# (M-Pesa code)</Field.Label>
              <Input
                value={paymentStatusDraft.mpesaCode}
                onChange={(e) =>
                  setPaymentStatusDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          mpesaCode: e.target.value
                            .toUpperCase()
                            .replace(/\s+/g, ""),
                        }
                      : prev
                  )
                }
                placeholder="e.g. UH39A1LI2Y"
                fontFamily="mono"
                autoComplete="off"
              />
            </Field.Root>
          ) : null}

          {paymentStatusDraft?.method === "paystack" ? (
            <Field.Root required>
              <Field.Label>Paystack / Zoho payment REFERENCE#</Field.Label>
              <Input
                value={paymentStatusDraft.paystackReference}
                onChange={(e) =>
                  setPaymentStatusDraft((prev) =>
                    prev
                      ? { ...prev, paystackReference: e.target.value }
                      : prev
                  )
                }
                placeholder="Paystack transaction or Zoho reference"
                fontFamily="mono"
                autoComplete="off"
              />
            </Field.Root>
          ) : null}

          {paymentStatusDraft?.method === "bank" ? (
            <Field.Root>
              <Field.Label>Bank transfer reference (optional)</Field.Label>
              <Input
                value={paymentStatusDraft.bankReference}
                onChange={(e) =>
                  setPaymentStatusDraft((prev) =>
                    prev
                      ? { ...prev, bankReference: e.target.value }
                      : prev
                  )
                }
                placeholder="Bank slip / transfer reference"
                autoComplete="off"
              />
            </Field.Root>
          ) : null}

          {paymentStatusDraft?.method ? (
            <Box
              bg="orange.50"
              border="1px solid"
              borderColor="orange.100"
              borderRadius="md"
              px={3}
              py={2.5}
            >
              <Stack gap={2}>
                <Checkbox.Root
                  checked={paymentStatusDraft.coversInternet}
                  onCheckedChange={(details) =>
                    setPaymentStatusDraft((prev) =>
                      prev
                        ? { ...prev, coversInternet: details.checked === true }
                        : prev
                    )
                  }
                  gap={2}
                  alignItems="flex-start"
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control mt={0.5} />
                  <Box flex="1" minW={0}>
                    <Text fontSize="sm" fontWeight="medium">
                      Internet / package
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      {packageAmount != null
                        ? formatCurrency(packageAmount)
                        : "—"}
                    </Text>
                  </Box>
                </Checkbox.Root>
                {packageHasDstv ? (
                  <Checkbox.Root
                    checked={paymentStatusDraft.coversDecoder}
                    onCheckedChange={(details) =>
                      setPaymentStatusDraft((prev) =>
                        prev
                          ? { ...prev, coversDecoder: details.checked === true }
                          : prev
                      )
                    }
                    gap={2}
                    alignItems="flex-start"
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control mt={0.5} />
                    <Box flex="1" minW={0}>
                      <Text fontSize="sm" fontWeight="medium">
                        DSTV decoder
                      </Text>
                      <Text fontSize="xs" color="fg.muted">
                        {formatCurrency(decoderFee || 2900)}
                      </Text>
                    </Box>
                  </Checkbox.Root>
                ) : null}
              </Stack>
              {(paymentStatusDraft.coversInternet ||
                (packageHasDstv && paymentStatusDraft.coversDecoder)) && (
                <Text fontSize="xs" color="orange.900" mt={2} fontWeight="medium">
                  Invoice total:{" "}
                  {formatCurrency(
                    (paymentStatusDraft.coversInternet
                      ? Number(packageAmount || 0)
                      : 0) +
                      (packageHasDstv && paymentStatusDraft.coversDecoder
                        ? Number(decoderFee || 2900)
                        : 0)
                  )}
                </Text>
              )}
            </Box>
          ) : null}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer px={5} py={3} borderTopWidth="1px" borderColor="border.muted" gap={2}>
        <Button variant="ghost" onClick={() => closePaymentStatusModal(false)}>
          Cancel
        </Button>
        <Button
          colorPalette="brand"
          onClick={() => closePaymentStatusModal(true)}
        >
          Save
        </Button>
      </Dialog.Footer>
    </AppDialog>
  );

  if (embedded) {
    return (
      <>
        {formBody}
        {paymentStatusDialog}
        {confirmDialog}
      </>
    );
  }

  return (
    <>
    <Stack gap={4} pb={{ base: 10, md: 12 }}>
      <Flex justify="space-between" align="start" gap={4} wrap="wrap">
        <Box>
          <Button asChild variant="ghost" size="sm" mb={2} px={0}>
            <Link to="/customers">
              <FiArrowLeft />
              Back to customers
            </Link>
          </Button>
          <Heading size="lg">New customer</Heading>
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
                {!isEdit && decoderFee > 0 && (
                  <Text as="span" fontSize="xs" display="block" color="brand.600">
                    first invoice incl. {formatCurrency(decoderFee)} decoder
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

      {formBody}
    </Stack>
    {paymentStatusDialog}
    {confirmDialog}
    </>
  );
}
