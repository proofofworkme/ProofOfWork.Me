export const OWNER_OUTPUT_COMMITMENT_MODEL: "owner-signed-all-outputs-v1";
export const OWNER_OUTPUT_COMMITMENT_MAX_TX_BYTES: number;
export const OWNER_OUTPUT_COMMITMENT_MAX_INPUTS: number;
export const OWNER_OUTPUT_COMMITMENT_MAX_OUTPUTS: number;
export type OwnerOutputCommitmentPrevout = {
  txid: string; vout: number; scriptPubKeyHex: string; valueSats: number | string | bigint;
};
export type OwnerOutputCommitmentEvidence = {
  rawTransactionHex: string; txid?: string; prevouts: OwnerOutputCommitmentPrevout[];
};
export type OwnerOutputCommitmentOptions = {
  ownerAddress: string; network?: "livenet" | "testnet" | "regtest";
  requireAllInputsCommitted?: boolean; allowAnyoneCanPay?: boolean;
};
export type OwnerOutputCommitmentInput = {
  inputIndex: number; hashType: number; spendPath: "p2pkh" | "p2wpkh" | "p2sh-p2wpkh" | "p2tr";
  commitsAllOutputs: boolean; anyoneCanPay: boolean;
};
export type OwnerOutputCommitmentResult = {
  valid: boolean; reason: string | null; txid: string | null;
  inputAddresses: (string | null)[];
  outputs: { vout: number; scriptPubKeyHex: string; valueSats: string; address: string | null }[];
  commitments: OwnerOutputCommitmentInput[];
};
/** Pure proof verifier; spent-output evidence must come from an independent trusted source. */
export function verifyOwnerOutputCommitment(evidence: unknown, options: OwnerOutputCommitmentOptions): OwnerOutputCommitmentResult;
