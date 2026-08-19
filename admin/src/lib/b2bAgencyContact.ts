/** Skynest B2B houses were bulk-created on TISP as first/middle/last = "user". */
export const SKYNEST_PLACEHOLDER_PERSON_NAME = "user";

function isPlaceholderUserPersonName(value: string | null | undefined): boolean {
  return String(value || "").trim().toLowerCase() === SKYNEST_PLACEHOLDER_PERSON_NAME;
}

export function isPlaceholderUserFullName(customer: {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}): boolean {
  return (
    isPlaceholderUserPersonName(customer.firstName) &&
    isPlaceholderUserPersonName(customer.middleName) &&
    isPlaceholderUserPersonName(customer.lastName)
  );
}

export function isSkynestLocation(customer: {
  buildingName?: string | null;
  popName?: string | null;
  customerNumber?: string | null;
  c2bCode?: string | null;
  b2bCode?: string | null;
}): boolean {
  const building = String(customer.buildingName || "").trim().toLowerCase();
  const pop = String(customer.popName || "").trim().toLowerCase();
  const number = String(customer.customerNumber || "").trim().toUpperCase();
  const c2b = String(customer.c2bCode || "").trim().toUpperCase();
  const b2b = String(customer.b2bCode || "").trim().toUpperCase();
  return (
    building.includes("skynest") ||
    pop.includes("skynest") ||
    number.startsWith("SKY-") ||
    number.startsWith("SKYB-") ||
    c2b === "SKY" ||
    b2b === "SKYB"
  );
}

export function shouldUseAgencyContactForSkynestPlaceholder(customer: {
  customerType?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  buildingName?: string | null;
  popName?: string | null;
  customerNumber?: string | null;
  c2bCode?: string | null;
  b2bCode?: string | null;
}): boolean {
  return (
    String(customer.customerType || "").toUpperCase() === "B2B" &&
    isSkynestLocation(customer) &&
    isPlaceholderUserFullName(customer)
  );
}
