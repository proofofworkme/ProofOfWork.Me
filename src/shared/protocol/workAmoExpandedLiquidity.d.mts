export const WORK_AMO_EXPANDED_FACE_PROOFS: 250000;
export const WORK_AMO_FACE_PROOFS: readonly [25000, 250000];
export const WORK_AMO_LIQUIDITY_FEE_SATS: 5460;
export const WORK_AMO_LIQUIDITY_FEE_ADDRESS: "1GrrXUmBftWhGCF7XfVUQENY8Js6vUiueR";
export const WORK_AMO_LIQUIDITY_FEE_SCRIPT: "76a914adf79c55d637a7163c4ac03d771de50e3e5615f088ac";
export const WORK_AMO_LISTING_REGISTRY_SCRIPT: "76a914373fb7e4166289b3e09a82ac74c4d2c4dccdaa0288ac";
export function workAmoExpandedListFeeOutput(
  outputs: readonly { vout: number, amountSats: number | string | bigint, scriptPubKeyHex: string }[],
  positions: { registryVout: number, anchorVout: number },
): number | null;
