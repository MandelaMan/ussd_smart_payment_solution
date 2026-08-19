/**
 * Buildings (via their POP) are either individual DSTV decoders or a shared
 * headend coax feed. Decoder one-time fees and IUC/serial only apply to decoder buildings.
 */

function resolveDstvSetup(source) {
  if (source == null) return "decoder";
  if (typeof source === "string") {
    const trimmed = source.trim();
    return trimmed || "decoder";
  }
  return (
    source.buildingDstvSetup ||
    source.building_dstv_setup ||
    source.dstvSetup ||
    source.dstv_setup ||
    "decoder"
  );
}

function buildingUsesDecoder(source) {
  return String(resolveDstvSetup(source)) === "decoder";
}

module.exports = {
  resolveDstvSetup,
  buildingUsesDecoder,
};
