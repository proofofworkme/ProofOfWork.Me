import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { readActionReceipts } from "../../shared/wallet/actionRecovery";
import { canonicalWorkCapacityAddress } from "../../shared/work/canonicalWorkCapacity";
import { assertNoUnresolvedJobsWorkAcceptance, jobsWorkCapacityFromPayload } from "../jobs/jobsWorkCapacity";
import { BOOST_WORK_TOKEN_ID } from "./boostWorkComposer";

// An owner-directed tip is a debit, unlike a Boost's WORK self-signal. Use the
// existing Computer/Jobs evaluator including pending transfers and listings.
export const boostTipWorkCapacityFromPayload = jobsWorkCapacityFromPayload;

export function assertNoUnresolvedWorkTipDebit(storage: Storage, walletAddress: string, ownSignedTxid?: string) {
  if (ownSignedTxid !== undefined && !/^[0-9a-f]{64}$/u.test(ownSignedTxid)) {
    throw new Error("The current signed WORK tip is invalid.");
  }
  assertNoUnresolvedJobsWorkAcceptance(storage, walletAddress, ownSignedTxid);
  const owner = canonicalWorkCapacityAddress(walletAddress);
  for (const receipt of readActionReceipts(storage)) {
    if (receipt.txid === ownSignedTxid || receipt.network !== "livenet" ||
        canonicalWorkCapacityAddress(receipt.address) !== owner ||
        !["unknown", "pending"].includes(receipt.status)) continue;
    const fields = Object.fromEntries(receipt.fields);
    if (receipt.key === `credit-transfer:${BOOST_WORK_TOKEN_ID}` ||
        receipt.key.startsWith("boost-tip:") && fields.Currency === "WORK") {
      throw new Error("An earlier signed WORK debit is unknown or pending. Check Transaction recovery before spending more WORK.");
    }
  }
}

export async function fetchBoostTipWorkCapacity(walletAddress: string, ownSignedTxid?: string) {
  assertNoUnresolvedWorkTipDebit(localStorage, walletAddress, ownSignedTxid);
  const params = new URLSearchParams({ address: walletAddress, asset: BOOST_WORK_TOKEN_ID, wallet: "1", fresh: "1" });
  const payload = await fetchProofApiJson<unknown>(`/api/v1/token?${params}`, "livenet");
  assertNoUnresolvedWorkTipDebit(localStorage, walletAddress, ownSignedTxid);
  return boostTipWorkCapacityFromPayload(payload, walletAddress);
}
