import * as bitcoin from "bitcoinjs-lib";
import { Buffer } from "buffer";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { inspectPreparedPayment } from "../../shared/wallet/paymentReview";
import type { ActionReview } from "../../shared/components/ActionTransactionReview";
import { assertActiveWalletAddress, buildBoostPaymentPsbt, ensureWalletNetwork, fetchReservedAmoAnchorOutpoints,
  scriptForAddress, type BoostPaymentPsbt, type BoostSpentOutpoint } from "../boost/boostWallet";
import { boostListingAnchorOutpoints, type BoostFeedPayload } from "../boost/boostProtocol";
import { fetchCodeRepository } from "./codeApi";
import type { CodePlan } from "./codeProtocol";
import { assertCodeRegistryReservations, assertCodeCreditReservations, type CodeReservationPayload } from "./codeReservations";

export type PreparedCode = { plan: CodePlan; address: string; network: BitcoinNetwork; payment: BoostPaymentPsbt; review: ActionReview };
export function sameCodeAddress(left: string, right: string, network: BitcoinNetwork) {
  if (!left || !right) return false;
  try { return Buffer.from(scriptForAddress(left, network, "Wallet")).equals(Buffer.from(scriptForAddress(right, network, "Owner"))); }
  catch { return false; }
}
const creditScopes = ["", "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8", "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562", "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d"];
type ListingPayload = CodeReservationPayload;
function listingAnchors(payload: ListingPayload, address: string, network: BitcoinNetwork) {
  if (!Array.isArray(payload.listings) || payload.collectionHasMore?.listings === true) throw new Error("Complete AMO listing evidence is unavailable. No transaction was prepared.");
  return payload.listings.filter(item => sameCodeAddress(String(item.sellerAddress ?? ""), address, network)).map(item => {
    const auth = item.saleAuthorization && typeof item.saleAuthorization === "object" ? item.saleAuthorization as Record<string, unknown> : {};
    const txid = String(auth.anchorTxid ?? item.listingId ?? "");
    const vout = Number(auth.anchorVout ?? auth.saleTicketVout ?? item.anchorVout ?? 2);
    if (!/^[a-f0-9]{64}$/iu.test(txid) || !Number.isSafeInteger(vout) || vout < 0) throw new Error("An AMO anchor could not be verified. Refresh before preparing Code.");
    return { txid: txid.toLowerCase(), vout };
  });
}
export async function codeReservedAnchors(address: string, network: BitcoinNetwork) {
  const registryRead = fetchProofApiJson<ListingPayload>("/api/v1/registry?fresh=1", network);
  const boostRead = fetchProofApiJson<BoostFeedPayload>("/api/v1/boost?listings=1&fresh=1", network);
  const creditReads = network === "livenet" ? creditScopes.map(asset => fetchProofApiJson<ListingPayload>(`/api/v1/token?${new URLSearchParams({ address, asset, wallet: "1", fresh: "1" })}`, network)) : [];
  const [registry, boost, ...credits] = await Promise.all([registryRead, boostRead, ...creditReads]);
  assertCodeRegistryReservations(registry);
  if ((registry.network && registry.network !== network) || !Array.isArray(registry.records) || registry.coverage?.complete === false ||
    boost.complete !== true || !Array.isArray(boost.items) || boost.hasMore === true || (boost.network && boost.network !== network)) {
    throw new Error("Fresh, complete AMO reservation evidence is unavailable. No transaction was prepared.");
  }
  for (const credit of credits) {
    assertCodeCreditReservations(credit);
    if (credit.authoritativeWallet !== true || credit.walletScoped !== true || !credit.source || (credit.network && credit.network !== network)) {
      throw new Error("Fresh wallet credit reservations are unavailable. No transaction was prepared.");
    }
  }
  const additional: BoostSpentOutpoint[] = [
    ...listingAnchors(registry, address, network), ...credits.flatMap(payload => listingAnchors(payload, address, network)),
    ...boostListingAnchorOutpoints(boost.items.filter(item => sameCodeAddress(item.listing?.sellerAddress ?? item.currentOwnerAddress ?? item.authorAddress, address, network))),
  ];
  // Reuse the shared reservation helper after strict reads; the verified union
  // survives the helper's best-effort fallback and covers Boost ticket anchors.
  return fetchReservedAmoAnchorOutpoints(address, network, additional);
}
export async function verifyCodeAuthority(plan: CodePlan, address: string, network: BitcoinNetwork, assertCurrent: () => void) {
  assertCurrent();
  const wallet = window.unisat;
  if (!wallet || !address || network !== "livenet") throw new Error("Connect your mainnet UniSat wallet before publishing Code.");
  await ensureWalletNetwork(wallet, network, address);
  await assertActiveWalletAddress(wallet, address);
  if (plan.draft.kind !== "repo") {
    const latest = await fetchCodeRepository(network, plan.draft.repo, { fresh: true });
    if (!sameCodeAddress(latest.repository.ownerAddress, address, network)) throw new Error("Only this repository's creating wallet can commit source.");
    if (latest.repository.headTxid !== plan.draft.parent) throw new Error("The confirmed main head changed. Refresh, inspect the latest source, and prepare a new commit.");
    const existing = latest.files.find(file => file.path === plan.draft.path);
    if (plan.draft.kind === "delete" && !existing) throw new Error("This source file no longer exists at the confirmed main head.");
    if (plan.draft.kind === "put" && latest.files.some(file => file.path !== plan.draft.path && (file.path.startsWith(`${plan.draft.path}/`) || plan.draft.path.startsWith(`${file.path}/`)))) {
      throw new Error("This path conflicts with an existing file or directory. Choose a different path.");
    }
  }
  assertCurrent();
}
export async function prepareCodeTransaction(plan: CodePlan, address: string, network: BitcoinNetwork, assertCurrent: () => void) {
  if (!Number.isFinite(plan.draft.feeRate) || plan.draft.feeRate < 0.1) throw new Error("Choose a miner fee of at least 0.1 proofs/vB.");
  await verifyCodeAuthority(plan, address, network, assertCurrent);
  const excludeOutpoints = await codeReservedAnchors(address, network);
  assertCurrent();
  const payment = await buildBoostPaymentPsbt({ excludeOutpoints, feeRate: plan.draft.feeRate, fromAddress: address, network,
    payments: [{ address, amountSats: 546 }], protocolPayloads: plan.payloads });
  const evidence = inspectPreparedPayment({ psbtHex: payment.psbtHex, network: bitcoin.networks.bitcoin,
    paymentCount: 1, registryPaymentCount: 0, feeSats: payment.feeSats, changeSats: payment.changeSats });
  if (JSON.stringify(evidence.records) !== JSON.stringify(plan.payloads)) throw new Error("Prepared source records differ from the reviewed source.");
  await verifyCodeAuthority(plan, address, network, assertCurrent);
  const review: ActionReview = { title: plan.draft.kind === "repo" ? "Create public repository" : "Publish source commit", networkLabel: "Mainnet",
    fields: [["Creating wallet", address], ...plan.fields], evidence, feeRate: String(plan.draft.feeRate), dustFeeProofs: String(payment.dustFeeSats),
    paymentLabels: ["546 proofs returned to your wallet"], walletSpendProofs: evidence.feeProofs,
    explanation: "The repository and exact source are public and permanent. The 546-proof self-payment is the ordinary Mail envelope and is counted once. Only the miner fee is spent. Confirmed main history follows signed parent references; competing edits remain inspectable." };
  return { plan, address, network, payment, review } satisfies PreparedCode;
}
export async function verifyCodeFunding(prepared: PreparedCode) {
  const [utxos, reserved] = await Promise.all([
    fetchProofApiJson<Array<{ txid: string; vout: number; status?: { confirmed?: boolean } }>>(`/api/v1/address/${encodeURIComponent(prepared.address)}/utxo?fresh=1`, prepared.network),
    codeReservedAnchors(prepared.address, prepared.network),
  ]);
  if (!Array.isArray(utxos)) throw new Error("Fresh confirmed funding evidence is unavailable.");
  const available = new Set(utxos.filter(item => item.status?.confirmed === true).map(item => `${item.txid}:${item.vout}`));
  const exclusions = new Set(reserved.map(item => `${item.txid}:${item.vout}`));
  if (prepared.review.evidence!.inputs.some(item => !available.has(item.outpoint) || exclusions.has(item.outpoint))) {
    throw new Error("Reviewed funding changed or became reserved by AMO. Prepare a new transaction review.");
  }
}
