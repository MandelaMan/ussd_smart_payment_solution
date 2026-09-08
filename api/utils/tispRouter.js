function namesMatch(a, b) {
  return (
    String(a || "").trim().localeCompare(String(b || "").trim(), undefined, {
      sensitivity: "accent",
    }) === 0
  );
}

/**
 * TISP Router is the POP name (e.g. Azalea), never the building name.
 * Building names win over leftover POP rows seeded from buildings
 * (Brookside Terraces POP → Azalea). Same-named POP+building (Enaki) stays Enaki.
 */
function pickTispRouterPopName(candidate, { pops = [], buildings = [] } = {}) {
  const raw = String(candidate || "").trim();
  if (!raw) return "";
  const building = buildings.find((b) =>
    namesMatch(b.name || b.buildingName, raw)
  );
  const fromBuilding = building?.popName || building?.pop_name;
  if (fromBuilding) return String(fromBuilding).trim();
  const pop = pops.find((p) => namesMatch(p.name || p.popName, raw));
  if (pop) return String(pop.name || pop.popName).trim();
  return raw;
}

module.exports = { pickTispRouterPopName, namesMatch };
