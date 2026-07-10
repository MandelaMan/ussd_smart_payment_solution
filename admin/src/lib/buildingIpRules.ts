import type { Building } from "./api";

export function getBuildingIpRules(building: Building | undefined) {
  if (!building) return null;
  return {
    ipSetup: building.ipSetup,
    prefixes: building.ipPrefixes ?? [],
  };
}

export function isValidLastOctet(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 254;
}

export function buildIpAddress(prefix: string, lastOctet: string) {
  if (!prefix || !isValidLastOctet(lastOctet)) return "";
  const trimmed = prefix.trim();
  const withDot = trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  return `${withDot}${Number(lastOctet)}`;
}

export function validateIpForBuilding(
  building: Building | undefined,
  prefix: string,
  lastOctet: string
): { ok: true; ip: string } | { ok: false; error: string } {
  if (!building) {
    return { ok: false, error: "Select a building first" };
  }

  const rules = getBuildingIpRules(building);
  if (!rules) {
    return { ok: true, ip: "" };
  }

  if (rules.ipSetup === "PPOE") {
    return { ok: true, ip: "" };
  }

  if (!rules.prefixes.length) {
    return { ok: false, error: `${building.name} has no IP prefixes configured` };
  }

  if (!prefix || !rules.prefixes.includes(prefix)) {
    return { ok: false, error: "Select a valid IP prefix for this building" };
  }

  if (!isValidLastOctet(lastOctet)) {
    return { ok: false, error: "Enter the last octet (1–254)" };
  }

  return { ok: true, ip: buildIpAddress(prefix, lastOctet) };
}

export function ipRulesHint(building: Building | undefined) {
  const rules = getBuildingIpRules(building);
  if (!rules) return "";
  if (rules.ipSetup === "PPOE") return "PPOE building — no static IP needed";
  if (!rules.prefixes.length) return "No IP prefixes configured";
  return rules.prefixes.map((p) => `${p}x`).join(" or ");
}
