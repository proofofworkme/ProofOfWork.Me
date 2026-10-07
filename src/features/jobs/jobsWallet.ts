import * as bitcoin from "bitcoinjs-lib";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { inspectPreparedPayment } from "../../shared/wallet/paymentReview";
import type { ActionReview } from "../../shared/components/ActionTransactionReview";
import { assertActiveWalletAddress, buildBoostPaymentPsbt, ensureWalletNetwork, type BoostPaymentPsbt } from "../boost/boostWallet";
import { codeReservedAnchors, sameCodeAddress } from "../code/codeWallet";
import { fetchJob, fetchJobs, exactProofs, type JobDetail } from "./jobsApi";
import { JOB_ACTION_LABELS, type JobsPlan } from "./jobsProtocol";

export type PreparedJob = { plan: JobsPlan; address: string; network: BitcoinNetwork; payment: BoostPaymentPsbt; review: ActionReview; destination: string; amountSats: string };
export { sameCodeAddress as sameJobsAddress };
export async function verifyJobsAuthority(plan: JobsPlan, address: string, network: BitcoinNetwork, assertCurrent: () => void) {
  assertCurrent();
  const wallet = window.unisat;
  if (!wallet || !address || network !== "livenet") throw new Error("Connect your mainnet UniSat wallet before publishing a Jobs record.");
  await ensureWalletNetwork(wallet, network, address); await assertActiveWalletAddress(wallet, address);
  let destination = address, amountSats = "546", detail: JobDetail | undefined;
  if (plan.draft.action === "brief") await fetchJobs(network, { fresh: true });
  if (plan.draft.action !== "brief") {
    detail = await fetchJob(network, plan.draft.job, { fresh: true });
    const job = detail.job;
    if (job.headTxid !== plan.draft.expectedHead) throw new Error("The confirmed job changed. Refresh, inspect the latest terms, and prepare a new review.");
    const requester = sameCodeAddress(job.requesterAddress, address, network);
    const worker = sameCodeAddress(job.workerAddress, address, network);
    const active = job.status !== "paid" && job.status !== "cancelled";
    if (!active) throw new Error("This job is already paid or cancelled; no further action was prepared.");
    if (plan.draft.action === "propose") {
      if (job.status !== "open" || requester) throw new Error("Only another wallet can propose work on an open job.");
      destination = job.requesterAddress;
    } else if (plan.draft.action === "assign") {
      if (!requester || job.status !== "open") throw new Error("Only the requester can assign an open job.");
      const proposal = detail.proposals.find(item => item.txid === plan.draft.proposal && item.action === "propose" && item.valid && item.applied);
      if (!proposal || !exactProofs(proposal.metadata.rewardSats, 546n) || typeof proposal.metadata.scope !== "string") throw new Error("The selected confirmed proposal is unavailable.");
      if (sameCodeAddress(proposal.authorAddress, address, network)) throw new Error("The worker must use a different wallet from the requester.");
      destination = proposal.authorAddress;
    } else if (plan.draft.action === "deliver") {
      if (!worker || !["assigned", "delivered"].includes(job.status) || job.assignmentTxid !== plan.draft.assignment) throw new Error("Only the confirmed assigned worker can deliver against this assignment.");
      destination = job.requesterAddress;
      const refs = plan.metadata.artifacts as string[];
      for (let start = 0; start < refs.length; start += 2) {
        await Promise.all(refs.slice(start, start + 2).map(async txid => {
          const transaction = await fetchProofApiJson<{ txid?: string; status?: { confirmed?: boolean } }>(`/api/v1/tx/${txid}`, network);
          if (transaction.txid !== txid || transaction.status?.confirmed !== true) throw new Error(`Artifact reference ${txid} is not a verified confirmed transaction.`);
        }));
        assertCurrent();
      }
    } else if (plan.draft.action === "accept") {
      if (!requester || job.status !== "delivered" || job.deliveryTxid !== plan.draft.delivery) throw new Error("Only the requester can accept the latest confirmed delivery.");
      const delivery = detail.deliveries.find(item => item.txid === plan.draft.delivery && item.action === "deliver" && item.valid && item.applied);
      if (!delivery || !sameCodeAddress(delivery.authorAddress, job.workerAddress, network)) throw new Error("Assigned-worker delivery evidence is unavailable.");
      destination = job.workerAddress; amountSats = job.rewardSats;
    } else if (plan.draft.action === "cancel" && !requester) {
      throw new Error("Only the requester can cancel an unpaid job.");
    }
  }
  assertCurrent();
  if (!exactProofs(amountSats, 546n)) throw new Error("The exact agreed reward is outside supported whole-proof payment bounds.");
  return { destination, amountSats, detail };
}
export async function prepareJobsTransaction(plan: JobsPlan, address: string, network: BitcoinNetwork, assertCurrent: () => void): Promise<PreparedJob> {
  if (!Number.isFinite(plan.draft.feeRate) || plan.draft.feeRate < 0.1) throw new Error("Choose a miner fee of at least 0.1 proofs/vB.");
  const authority = await verifyJobsAuthority(plan, address, network, assertCurrent);
  const excludeOutpoints = await codeReservedAnchors(address, network); assertCurrent();
  const payment = await buildBoostPaymentPsbt({ excludeOutpoints, feeRate: plan.draft.feeRate, fromAddress: address, network, payments: [{ address: authority.destination, amountSats: Number(authority.amountSats) }], protocolPayloads: plan.payloads });
  const evidence = inspectPreparedPayment({ psbtHex: payment.psbtHex, network: bitcoin.networks.bitcoin, paymentCount: 1, registryPaymentCount: 0, feeSats: payment.feeSats, changeSats: payment.changeSats });
  const recipient = evidence.outputs.find(output => output.kind === "payment");
  if (!recipient || !sameCodeAddress(recipient.address, authority.destination, network) || recipient.proofs !== authority.amountSats || JSON.stringify(evidence.records) !== JSON.stringify(plan.payloads)) throw new Error("Prepared job records or payment differ from the reviewed intent.");
  await verifyJobsAuthority(plan, address, network, assertCurrent);
  const self = sameCodeAddress(authority.destination, address, network);
  const terms = authority.detail?.job;
  const fields: [string, string][] = [["Signing wallet", address], ...plan.fields, ["Payment destination", authority.destination], ["Exact payment", `${authority.amountSats} proofs`]];
  if (terms) fields.push(["Requester", terms.requesterAddress], ["Assigned worker", terms.workerAddress || "Not assigned"], ["Current agreed scope", terms.scope], ["Current agreed reward", `${terms.rewardSats} proofs`]);
  if (plan.draft.action === "assign" && authority.detail) {
    const proposal = authority.detail.proposals.find(item => item.txid === plan.draft.proposal)!;
    fields.push(["Assigned proposal scope", String(proposal.metadata.scope)], ["Assigned proposal reward", `${proposal.metadata.rewardSats} proofs`]);
  }
  const review: ActionReview = { title: JOB_ACTION_LABELS[plan.draft.action], networkLabel: "Mainnet", fields, evidence, feeRate: String(plan.draft.feeRate), dustFeeProofs: String(payment.dustFeeSats), paymentLabels: [self ? "Mail self-payment returned to your wallet" : plan.draft.action === "accept" ? "Agreed reward paid directly to the worker" : "Mail payment to the other participant"], walletSpendProofs: self ? evidence.feeProofs : evidence.totalSpendProofs,
    explanation: plan.draft.action === "accept" ? "This transaction publishes your acceptance and pays the exact agreed reward directly to the assigned worker. Acceptance is your attestation; it does not prove objective work quality. There is no escrow or automatic future payment." : "This public, permanent Jobs record uses ordinary Mail/Files. An advertised reward is a promise, not funded escrow. The 546-proof Mail payment and miner fee are shown separately. Jobs adds no registry fee." };
  return { plan, address, network, payment, review, destination: authority.destination, amountSats: authority.amountSats };
}
export async function verifyJobsFunding(prepared: PreparedJob) {
  const [utxos, reserved] = await Promise.all([
    fetchProofApiJson<Array<{ txid: string; vout: number; status?: { confirmed?: boolean } }>>(`/api/v1/address/${encodeURIComponent(prepared.address)}/utxo?fresh=1`, prepared.network),
    codeReservedAnchors(prepared.address, prepared.network),
  ]);
  if (!Array.isArray(utxos)) throw new Error("Fresh confirmed funding evidence is unavailable.");
  const available = new Set(utxos.filter(item => item.status?.confirmed === true).map(item => `${item.txid}:${item.vout}`));
  const exclusions = new Set(reserved.map(item => `${item.txid}:${item.vout}`));
  if (!prepared.review.evidence || prepared.review.evidence.inputs.some(item => !available.has(item.outpoint) || exclusions.has(item.outpoint))) throw new Error("Reviewed funding changed or became reserved by AMO. Prepare a new transaction review.");
}
