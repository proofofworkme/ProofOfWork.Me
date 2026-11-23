export const WORK_AMO_EXPANDED_FACE_PROOFS = 250_000;
export const WORK_AMO_FACE_PROOFS = Object.freeze([25_000, WORK_AMO_EXPANDED_FACE_PROOFS]);
export const WORK_AMO_LIQUIDITY_FEE_SATS = 5_460;
export const WORK_AMO_LIQUIDITY_FEE_ADDRESS = "1GrrXUmBftWhGCF7XfVUQENY8Js6vUiueR";
export const WORK_AMO_LIQUIDITY_FEE_SCRIPT = "76a914adf79c55d637a7163c4ac03d771de50e3e5615f088ac";
export const WORK_AMO_LISTING_REGISTRY_SCRIPT = "76a914373fb7e4166289b3e09a82ac74c4d2c4dccdaa0288ac";

export function workAmoExpandedListFeeOutput(outputs, { registryVout, anchorVout }) {
  if (!Array.isArray(outputs) || !Number.isSafeInteger(registryVout) ||
      registryVout < 0 || anchorVout !== 2 || registryVout === anchorVout) return null;
  const registry = outputs.find(output => output.vout === registryVout);
  if (registry?.scriptPubKeyHex !== WORK_AMO_LISTING_REGISTRY_SCRIPT ||
      String(registry.amountSats) !== "546") return null;
  const fees = outputs.filter(output => output.scriptPubKeyHex === WORK_AMO_LIQUIDITY_FEE_SCRIPT &&
    String(output.amountSats) === String(WORK_AMO_LIQUIDITY_FEE_SATS) &&
    Number.isSafeInteger(output.vout) && output.vout >= 0 &&
    output.vout !== registryVout && output.vout !== anchorVout);
  return fees.length === 1 ? fees[0].vout : null;
}
