/**
 * Per-building static IP prefix rules. Prefixes are stored on the building record;
 * legacy name-based rules remain as fallback for unmigrated rows.
 */
const LEGACY_BUILDING_IP_RULES = {
  Enaki: {
    ipSetup: "STATIC",
    prefixes: [
      "10.10.10.",
      "10.11.10.",
      "10.11.11.",
      "10.12.10.",
      "41.79.10.",
    ],
  },
  Colosseum: {
    ipSetup: "STATIC",
    prefixes: ["172.168.1."],
  },
  Azalea: {
    ipSetup: "PPOE",
    prefixes: [],
  },
  Skynest: {
    ipSetup: "STATIC",
    prefixes: ["192.168.88.", "192.168.89."],
  },
};

function parsePrefixes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getBuildingIpRules(building) {
  if (!building) return null;

  const ipSetup = building.ip_setup || building.ipSetup;
  const prefixes = parsePrefixes(building.ip_prefixes ?? building.ipPrefixes);

  if (ipSetup) {
    return { ipSetup, prefixes };
  }

  if (building.name && LEGACY_BUILDING_IP_RULES[building.name]) {
    return LEGACY_BUILDING_IP_RULES[building.name];
  }

  return null;
}

function isValidLastOctet(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 254;
}

function buildIpAddress(prefix, lastOctet) {
  if (!prefix || !isValidLastOctet(lastOctet)) return null;
  const trimmed = String(prefix).trim();
  const withDot = trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  return `${withDot}${Number(lastOctet)}`;
}

function validateIpForBuilding(building, ipAddress) {
  const rules = getBuildingIpRules(building);
  if (!rules) {
    return { ok: true, ip: ipAddress || null };
  }

  if (rules.ipSetup === "PPOE") {
    if (ipAddress) {
      return {
        ok: false,
        error: `${building.name} uses PPOE — no static IP should be assigned`,
      };
    }
    return { ok: true, ip: null };
  }

  const ip = String(ipAddress || "").trim();
  if (!ip) {
    return {
      ok: false,
      error: `IP address is required for ${building.name}`,
    };
  }

  if (!rules.prefixes.length) {
    return {
      ok: false,
      error: `${building.name} has no IP prefixes configured`,
    };
  }

  const matched = rules.prefixes.some((prefix) => {
    if (!ip.startsWith(prefix)) return false;
    const lastOctet = ip.slice(prefix.length);
    return isValidLastOctet(lastOctet) && String(Number(lastOctet)) === lastOctet;
  });

  if (!matched) {
    const allowed = rules.prefixes.map((p) => `${p}x`).join(" or ");
    return {
      ok: false,
      error: `Invalid IP for ${building.name}. Use ${allowed} (x = 1–254)`,
    };
  }

  return { ok: true, ip };
}

function normalizeIpPrefix(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  const withDot = trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  const octets = withDot.slice(0, -1).split(".");
  if (octets.length !== 3) {
    throw new Error(
      `Invalid IP prefix "${raw}". Use three octets, e.g. 10.12.10 or 10.12.10.`
    );
  }

  for (const octet of octets) {
    const n = Number(octet);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error(`Invalid octet in prefix "${raw}"`);
    }
  }

  return withDot;
}

function normalizeIpPrefixes(prefixes) {
  if (!Array.isArray(prefixes)) return [];
  const out = [];
  for (const p of prefixes) {
    const normalized = normalizeIpPrefix(p);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

module.exports = {
  LEGACY_BUILDING_IP_RULES,
  getBuildingIpRules,
  isValidLastOctet,
  buildIpAddress,
  validateIpForBuilding,
  normalizeIpPrefix,
  normalizeIpPrefixes,
};
