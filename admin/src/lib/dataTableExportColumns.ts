import type {
  AdminUser,
  Agency,
  ApartmentHistoryEntry,
  ApiCallLog,
  BillingCommunicationCandidate,
  Building,
  Customer,
  Product,
  ReconciliationCustomerRow,
  UnifiedTransaction,
  UnmatchedMpesaPayment,
} from "./api";
import { formatCurrency, formatDate, formatDateOnly } from "./api";
import { displayCustomerStatus } from "./customerStatus";
import { formatTitleCase } from "./formatText";
import type { ExportColumn } from "./tableExport";

export const buildingExportColumns: ExportColumn<Building>[] = [
  { header: "Name", value: (row) => row.name },
  { header: "POP", value: (row) => row.popName },
  { header: "Building Code", value: (row) => row.buildingCode },
  { header: "C2B Code", value: (row) => row.c2bCode },
  { header: "B2B Code", value: (row) => row.b2bCode },
  { header: "IP Setup", value: (row) => row.ipSetup },
  { header: "DSTV Setup", value: (row) => row.dstvSetup },
  { header: "Street", value: (row) => row.addressStreet },
  { header: "Street 2", value: (row) => row.addressStreet2 },
  { header: "PO Box", value: (row) => row.addressPoBox },
  { header: "City", value: (row) => row.addressCity },
  { header: "State", value: (row) => row.addressState },
  { header: "ZIP", value: (row) => row.addressZip },
  { header: "Country", value: (row) => row.addressCountry },
  { header: "IP Prefixes", value: (row) => (row.ipPrefixes || []).join("; ") },
  { header: "Created", value: (row) => (row.createdAt ? formatDate(row.createdAt) : "") },
];

export const productExportColumns: ExportColumn<Product>[] = [
  { header: "Category", value: (row) => row.categoryName },
  { header: "Plan", value: (row) => row.planName },
  { header: "Building", value: (row) => row.buildingName },
  { header: "Mbps", value: (row) => row.mbps },
  { header: "Extra Mbps", value: (row) => row.extraBandwidth },
  { header: "Price", value: (row) => row.price },
  { header: "Frequency", value: (row) => row.paymentFrequency },
  { header: "Active", value: (row) => (row.isActive ? "Yes" : "No") },
];

export const agencyExportColumns: ExportColumn<Agency>[] = [
  { header: "Name", value: (row) => row.name },
  { header: "Contact", value: (row) => row.contactPerson },
  { header: "Phone", value: (row) => row.phone },
  { header: "Email", value: (row) => row.email },
  { header: "Discount %", value: (row) => row.discountPercent },
  { header: "Active Customers", value: (row) => row.activeCustomers },
];

export const userExportColumns: ExportColumn<AdminUser>[] = [
  { header: "Name", value: (row) => row.name },
  { header: "Email", value: (row) => row.email },
  { header: "Role", value: (row) => row.role },
  { header: "Active", value: (row) => (row.is_active ? "Yes" : "No") },
  { header: "Created", value: (row) => formatDate(row.created_at) },
];

export const logExportColumns: ExportColumn<ApiCallLog>[] = [
  { header: "Service", value: (row) => row.service },
  { header: "Endpoint", value: (row) => row.endpoint },
  { header: "Status", value: (row) => row.status },
  { header: "Customer", value: (row) => row.customerNumber },
  { header: "Created", value: (row) => formatDate(row.createdAt) },
];

export const apartmentHistoryExportColumns: ExportColumn<ApartmentHistoryEntry>[] = [
  { header: "Building", value: (row) => row.buildingName },
  { header: "Apartment", value: (row) => row.apartmentNumber },
  { header: "Customer", value: (row) => row.customerName },
  { header: "Customer Number", value: (row) => row.customerNumber },
  { header: "Reason", value: (row) => row.reason },
  { header: "Moved In", value: (row) => formatDateOnly(row.movedInAt) },
  { header: "Moved Out", value: (row) => formatDateOnly(row.movedOutAt) },
];

export const transactionExportColumns: ExportColumn<UnifiedTransaction>[] = [
  { header: "Source", value: (row) => row.source },
  { header: "Customer", value: (row) => row.customerRef },
  { header: "Reference", value: (row) => row.referenceId },
  { header: "Amount", value: (row) => row.amount },
  { header: "Status", value: (row) => row.status },
  { header: "Channel", value: (row) => row.channel },
  { header: "Created", value: (row) => formatDate(row.createdAt) },
];

export const unmatchedMpesaExportColumns: ExportColumn<UnmatchedMpesaPayment>[] = [
  { header: "Receipt", value: (row) => row.referenceId },
  { header: "Customer", value: (row) => row.customerName || row.accountReference },
  { header: "Account Ref", value: (row) => row.accountReference },
  { header: "Phone", value: (row) => row.phone },
  { header: "Amount", value: (row) => row.amount },
  { header: "Channel", value: (row) => row.channel },
  { header: "Paid At", value: (row) => (row.paidAt ? formatDate(String(row.paidAt)) : "") },
];

export const billingCommunicationExportColumns: ExportColumn<BillingCommunicationCandidate>[] = [
  { header: "Customer", value: (row) => row.customerName },
  { header: "Customer Number", value: (row) => row.customerNumber },
  { header: "Email", value: (row) => row.email },
  { header: "Status", value: (row) => row.primaryStatus },
  { header: "Outstanding", value: (row) => row.outstandingBalance },
  { header: "Last Sent", value: (row) => (row.lastSentAt ? formatDate(row.lastSentAt) : "") },
];

export const reconciliationCustomerExportColumns: ExportColumn<ReconciliationCustomerRow>[] = [
  { header: "Customer Number", value: (row) => row.customerNumber },
  { header: "Customer Name", value: (row) => row.customerName },
  { header: "Building", value: (row) => row.buildingName },
  { header: "Package", value: (row) => row.productName },
  { header: "Primary Status", value: (row) => row.primaryStatus },
  {
    header: "Outstanding",
    value: (row) => row.metrics?.outstandingBalance ?? 0,
  },
  {
    header: "Expected Amount",
    value: (row) => row.metrics?.expectedAmount ?? 0,
  },
  {
    header: "Billing Frequency",
    value: (row) => row.metrics?.billingFrequency ?? "",
  },
  {
    header: "Service Status",
    value: (row) => row.metrics?.subscriptionStatus ?? "",
  },
];

export const customerListExportColumns = (
  hidePricing: boolean
): ExportColumn<Customer>[] => [
  { header: "Type", value: (row) => row.customerType },
  { header: "Customer Number", value: (row) => row.customerNumber },
  { header: "Name", value: (row) => row.fullName },
  { header: "Building", value: (row) => row.buildingName },
  { header: "Apartment", value: (row) => row.apartmentNumber },
  { header: "Package", value: (row) => formatTitleCase(row.productName) },
  { header: "Mbps", value: (row) => row.productMbps },
  { header: "Frequency", value: (row) => row.paymentFrequency },
  {
    header: "Status",
    value: (row) => displayCustomerStatus(row),
  },
  ...(hidePricing
    ? []
    : [{ header: "Price", value: (row: Customer) => formatCurrency(row.packagePrice) }]),
  {
    header: "Due date",
    value: (row) => (row.tispDueDate ? formatDateOnly(row.tispDueDate) : ""),
  },
];
