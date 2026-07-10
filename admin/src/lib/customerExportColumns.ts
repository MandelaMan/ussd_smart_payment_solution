import type { ExportColumnOption } from "./tableExport";

/** Matches api/controllers/customers.controller.js CUSTOMER_EXPORT_COLUMNS keys. */
export const CUSTOMER_EXPORT_COLUMN_OPTIONS: ExportColumnOption[] = [
  { key: "customerNumber", label: "Customer #", required: true },
  { key: "fullName", label: "Name", required: true },
  { key: "customerType", label: "Type", required: true },
  { key: "apartmentNumber", label: "Apartment", required: true },
  { key: "subscriptionStatus", label: "Status", required: true },
  { key: "buildingName", label: "Building" },
  { key: "productName", label: "Package" },
  { key: "paymentFrequency", label: "Billing" },
  { key: "packagePrice", label: "Price" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "status", label: "Account" },
  { key: "createdAt", label: "Created" },
];
