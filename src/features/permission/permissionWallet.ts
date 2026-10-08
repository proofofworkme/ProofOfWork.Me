import * as bitcoin from "bitcoinjs-lib";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { inspectPreparedPayment } from "../../shared/wallet/paymentReview";
import type { ActionReview } from "../../shared/components/ActionTransactionReview";
import { assertActiveWalletAddress, assertMainnetP2pkhWallet, buildBoostPaymentPsbt, ensureWalletNetwork, scriptForAddress, type BoostPaymentPsbt } from "../boost/boostWallet";
import { codeReservedAnchors, sameCodeAddress } from "../code/codeWallet";
import { fetchPermission, fetchPermissions, permissionPublicationReady } from "./permissionApi";
import { PERMISSION_ACTION_LABELS, type PermissionPlan } from "./permissionProtocol";

export { sameCodeAddress as samePermissionAddress };
export type PreparedPermission = { plan: PermissionPlan; address: string; network: BitcoinNetwork; payment: BoostPaymentPsbt; review: ActionReview };
export async function verifyPermissionAuthority(plan: PermissionPlan, address: string, network: BitcoinNetwork, assertCurrent: () => void) {
  assertCurrent();
  const wallet = window.unisat;
  if (!wallet || !address || network !== "livenet") throw new Error("Connect your mainnet UniSat wallet before publishing permissions.");
  assertMainnetP2pkhWallet(address, network);
  await ensureWalletNetwork(wallet, network, address); await assertActiveWalletAddress(wallet, address);
  if (!wallet.getAccounts || !sameCodeAddress((await wallet.getAccounts())[0] ?? "", address, network)) throw new Error("The active UniSat P2PKH wallet could not be verified. Prepare a new Permission review.");
  for (const recipient of plan.policy?.allowedRecipients ?? []) scriptForAddress(recipient, network, "Permitted recipient");
  if (plan.draft.action === "grant") {
    const inventory = await fetchPermissions(network, { address, fresh: true });
    if (!permissionPublicationReady(inventory)) throw new Error(inventory.admission.reason || "Permission publication is closed until confirmed discovery and activation are ready.");
  } else {
    const history = await fetchPermission(network, plan.draft.grant, { fresh: true, requireComplete: true });
    const latest = history.currentPermission ?? history.permission;
    if (!permissionPublicationReady(history)) throw new Error(history.admission.reason || "Current confirmed Permission history and activation are unavailable.");
    if (!sameCodeAddress(latest.walletAddress, address, network)) throw new Error("Only the original authorizing wallet can replace or revoke this permission.");
    if (latest.rootTxid !== plan.draft.grant || latest.headTxid !== plan.draft.parent || latest.status !== "active") throw new Error("The permission's current confirmed state changed. Refresh and prepare a new review.");
  }
  assertCurrent();
}
export async function preparePermissionTransaction(plan: PermissionPlan, address: string, network: BitcoinNetwork, assertCurrent: () => void): Promise<PreparedPermission> {
  if (!Number.isFinite(plan.draft.feeRate) || plan.draft.feeRate < 0.1) throw new Error("Choose a miner fee of at least 0.1 proofs/vB.");
  await verifyPermissionAuthority(plan, address, network, assertCurrent);
  const excludeOutpoints = await codeReservedAnchors(address, network); assertCurrent();
  const payment = await buildBoostPaymentPsbt({ excludeOutpoints, feeRate: plan.draft.feeRate, fromAddress: address, network,
    payments: [{ address, amountSats: 546 }], protocolPayloads: plan.payloads, requireP2pkhAllInputs: true });
  const evidence = inspectPreparedPayment({ psbtHex: payment.psbtHex, network: bitcoin.networks.bitcoin, paymentCount: 1, registryPaymentCount: 0, feeSats: payment.feeSats, changeSats: payment.changeSats });
  const recipient = evidence.outputs.find(output => output.kind === "payment");
  if (!recipient || !sameCodeAddress(recipient.address, address, network) || recipient.proofs !== "546" || JSON.stringify(evidence.records) !== JSON.stringify(plan.payloads)) throw new Error("Prepared permission record or self-payment differs from the reviewed intent.");
  await verifyPermissionAuthority(plan, address, network, assertCurrent);
  const review: ActionReview = { title: PERMISSION_ACTION_LABELS[plan.draft.action], networkLabel: "Mainnet", fields: [["Authorizing and permitted wallet", address], ...plan.fields],
    evidence, feeRate: String(plan.draft.feeRate), dustFeeProofs: String(payment.dustFeeSats), paymentLabels: ["546 proofs returned to your authorizing wallet"], walletSpendProofs: evidence.feeProofs,
    explanation: plan.draft.action === "revoke" ? "This public record stops new authorization after confirmation and verified replay. It preserves permission history and cannot cancel signatures already released. Autonomous signing remains closed."
      : "The public permission is permanently bound to this input-authorizing wallet. The 546-proof ordinary Mail self-payment is counted once; only the miner fee is spent. No password or secret is published. Publishing this grant does not open autonomous signing." };
  return { plan, address, network, payment, review };
}
export async function verifyPermissionFunding(prepared: PreparedPermission) {
  const [utxos, reserved] = await Promise.all([
    fetchProofApiJson<Array<{ txid: string; vout: number; status?: { confirmed?: boolean } }>>(`/api/v1/address/${encodeURIComponent(prepared.address)}/utxo?fresh=1`, prepared.network),
    codeReservedAnchors(prepared.address, prepared.network),
  ]);
  if (!Array.isArray(utxos)) throw new Error("Fresh confirmed funding evidence is unavailable.");
  const available = new Set(utxos.filter(item => item.status?.confirmed === true).map(item => `${item.txid}:${item.vout}`));
  const exclusions = new Set(reserved.map(item => `${item.txid}:${item.vout}`));
  if (!prepared.review.evidence || prepared.review.evidence.inputs.some(item => !available.has(item.outpoint) || exclusions.has(item.outpoint))) throw new Error("Reviewed funding changed or became reserved by AMO. Prepare a new permission review.");
}
