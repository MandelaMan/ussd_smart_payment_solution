import type { Lead } from "./api";

export const LEAD_STATUS_OPTIONS: Array<{ value: Lead["status"]; label: string }> = [
  { value: "new", label: "New" },
  { value: "interested", label: "Interested — pending conversion" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "converted", label: "Converted" },
  { value: "closed", label: "Closed" },
];

export const LEAD_SOURCE_OPTIONS: Array<{ value: Lead["source"]; label: string }> = [
  { value: "signup", label: "Signup" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "web", label: "Website" },
  { value: "embed", label: "Embed" },
  { value: "email", label: "Email" },
];

export function leadStatusLabel(status: string): string {
  return LEAD_STATUS_OPTIONS.find((s) => s.value === status)?.label || status;
}

export function leadSourceLabel(source: string): string {
  return LEAD_SOURCE_OPTIONS.find((s) => s.value === source)?.label || source;
}

export type LeadSignupPrefill = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  apartmentNumber: string;
  buildingId: number | null;
  buildingName: string | null;
  productId: number | null;
  productName: string | null;
  paymentFrequency: string | null;
  categoryId: number | null;
  planId: number | null;
  dstvDecoderSerial: string | null;
  convertedCustomerId: number | null;
  status: Lead["status"];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asString(value: unknown): string {
  return String(value || "").trim();
}

export function parseLeadSignup(lead: Lead): LeadSignupPrefill {
  const meta = asRecord(lead.metadata);
  const signup = asRecord(meta?.signup);
  const name = asString(lead.name);
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = asString(signup?.firstName) || parts[0] || "";
  const lastName =
    asString(signup?.lastName) || (parts.length > 1 ? parts.slice(1).join(" ") : "");

  return {
    id: lead.id,
    firstName,
    lastName,
    phone: asString(lead.phone),
    email: asString(lead.email),
    apartmentNumber: asString(lead.apartmentNumber),
    buildingId: asNumber(lead.buildingId) || asNumber(signup?.buildingId),
    buildingName: asString(lead.buildingName || lead.buildingInterest) || null,
    productId: asNumber(signup?.productId),
    productName: asString(signup?.productName) || asString(lead.interest) || null,
    paymentFrequency: asString(signup?.paymentFrequency) || null,
    categoryId: asNumber(signup?.categoryId),
    planId: asNumber(signup?.planId),
    dstvDecoderSerial: asString(signup?.dstvDecoderSerial) || null,
    convertedCustomerId: lead.convertedCustomerId,
    status: lead.status,
  };
}

export function publicSignupUrl(): string {
  if (typeof window === "undefined") return "/signup";
  return `${window.location.origin}/signup`;
}
