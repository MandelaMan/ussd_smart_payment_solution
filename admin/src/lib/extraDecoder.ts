export const EXTRA_DECODER_UNIT_FEE = 3500;
export const MAX_EXTRA_DECODER_COUNT = 10;

export function normalizeExtraDecoderCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_EXTRA_DECODER_COUNT, Math.floor(n));
}

export function extraDecoderFee(extraCount: unknown): number {
  return normalizeExtraDecoderCount(extraCount) * EXTRA_DECODER_UNIT_FEE;
}

/** Included decoder plus extras — used for the one-time 2900 charge. */
export function decodersOwnedCount(extraCount: unknown): number {
  return normalizeExtraDecoderCount(extraCount) + 1;
}

export function decoderSignupFee(
  extraCount: unknown,
  unitFee = 2900
): number {
  const unit = Number(unitFee);
  const fee = Number.isFinite(unit) && unit > 0 ? unit : 2900;
  return decodersOwnedCount(extraCount) * fee;
}
