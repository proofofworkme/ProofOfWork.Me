import { readActionReceipts } from "../wallet/actionRecovery";

export const WORK_BATCH_RECEIPT_MARKER = "WORK batch v1";
export function assertNoUnresolvedWorkBatch(storage: Storage, walletAddress: string, ownSignedTxid?: string) {
  if (ownSignedTxid !== undefined && !/^[0-9a-f]{64}$/u.test(ownSignedTxid)) throw new Error("The signed batch transaction is invalid.");
  const canonical = (value: string) => /^(bc1|tb1|bcrt1)/iu.test(value) && (value === value.toLowerCase() || value === value.toUpperCase()) ? value.toLowerCase() : value;
  const owner = canonical(walletAddress.trim());
  for (const receipt of readActionReceipts(storage)) {
    if (receipt.txid === ownSignedTxid || receipt.network !== "livenet" || canonical(receipt.address.trim()) !== owner ||
        !["unknown", "pending"].includes(receipt.status)) continue;
    if (receipt.fields.some(([name, value]) => name === "Transfer mode" && value === WORK_BATCH_RECEIPT_MARKER)) {
      throw new Error("An earlier WORK batch is unknown or pending. Check Transaction recovery before spending more WORK. The full batch remains protected.");
    }
  }
}
