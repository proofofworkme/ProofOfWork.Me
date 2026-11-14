import * as bitcoin from "bitcoinjs-lib";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { inspectPreparedPayment } from "../../shared/wallet/paymentReview";
import type { ActionReview } from "../../shared/components/ActionTransactionReview";
import { assertActiveWalletAddress, assertMainnetP2pkhWallet, buildBoostPaymentPsbt, dataCarrierBytesForPayload, ensureWalletNetwork, scriptForAddress, type BoostPaymentPsbt } from "../boost/boostWallet";
import { requireBoostWorkWriteAdmission, buildBoostWorkSendPayload, BOOST_WORK_REGISTRY_ADDRESS, BOOST_WORK_MUTATION_PROOFS } from "../boost/boostWorkComposer";
import { fetchJobsWorkCapacity } from "../jobs/jobsWorkCapacity";
import { codeReservedAnchors, sameCodeAddress } from "../code/codeWallet";
import { fetchPayInvoice, fetchPayInvoices, requirePayPublication, type PayDetail } from "./payApi";
import { PAY_ACTION_LABELS, type PayPlan } from "./payProtocol";
import { formatPayAmount, type PayAmount } from "../../shared/protocol/pay.mjs";

export { sameCodeAddress as samePayAddress };
export type PreparedPay = { plan: PayPlan; address: string; network: BitcoinNetwork; payment: BoostPaymentPsbt; review: ActionReview; destination: string; amountSats: string; amount: PayAmount | null };
async function requireWorkCapacity(amount: PayAmount, address: string, assertCurrent: () => void, ownSignedTxid?: string) {
  if (amount.asset !== "WORK") return;
  const [capacity] = await Promise.all([fetchJobsWorkCapacity(address, { ownSignedTxid }), requireBoostWorkWriteAdmission()]);
  assertCurrent();
  if (BigInt(amount.amountSubatoms) > capacity.spendableSubatoms) throw new Error("The invoice exceeds your authoritative spendable WORK after reservations and pending transfers.");
  return capacity;
}
export async function verifyPayAuthority(plan: PayPlan, address: string, network: BitcoinNetwork, assertCurrent: () => void, ownSignedTxid?: string) {
  assertCurrent();
  const wallet = window.unisat;
  if (!wallet || !address || network !== "livenet") throw new Error("Connect your mainnet UniSat wallet before signing a Pay transaction.");
  assertMainnetP2pkhWallet(address, network);
  await ensureWalletNetwork(wallet, network, address); await assertActiveWalletAddress(wallet, address);
  if (!wallet.getAccounts || !sameCodeAddress((await wallet.getAccounts())[0] ?? "", address, network)) throw new Error("The active P2PKH signing wallet could not be verified.");
  let destination = address, amountSats = "546", detail: PayDetail | undefined, amount: PayAmount | null = null;
  if (plan.draft.action === "invoice") {
    const inventory = await fetchPayInvoices(network, { fresh: true }); requirePayPublication(inventory);
    scriptForAddress(plan.draft.recipient, network, "Fixed invoice recipient");
    if (plan.draft.reference) {
      const transaction = await fetchProofApiJson<{ txid?: string; status?: { confirmed?: boolean; block_height?: number } }>(`/api/v1/tx/${plan.draft.reference}`, network);
      if (transaction.txid !== plan.draft.reference || transaction.status?.confirmed !== true || !Number.isSafeInteger(transaction.status.block_height) || Number(transaction.status.block_height) > inventory.indexedThroughBlock) throw new Error("The work reference is not confirmed at the verified invoice checkpoint.");
    }
  } else {
    detail = await fetchPayInvoice(network, plan.draft.invoice, { fresh: true }); requirePayPublication(detail);
    const invoice = detail.invoice;
    if (invoice.headTxid !== plan.draft.expectedHead || invoice.status !== "open") throw new Error("The invoice changed, was paid or was cancelled. Refresh and prepare a new review.");
    if (detail.pendingEvents.some(event => event.txid !== ownSignedTxid && event.invoiceTxid === invoice.txid && ["pay", "cancel"].includes(event.action) && event.valid !== false)) throw new Error("An invoice payment or cancellation is visible pending confirmation. Refresh its status before signing another action.");
    if (plan.draft.action === "cancel") {
      if (!sameCodeAddress(invoice.issuerAddress, address, network)) throw new Error("Only the invoice issuer can cancel an unpaid invoice.");
    } else {
      amount = invoice.amount; destination = invoice.recipientAddress;
      if (sameCodeAddress(address, destination, network)) throw new Error("An invoice recipient cannot settle their own invoice with a self-payment.");
      amountSats = amount.asset === "proofs" ? amount.amountSats : "546";
      await requireWorkCapacity(amount, address, assertCurrent, ownSignedTxid);
    }
  }
  assertCurrent();
  return { destination, amountSats, detail, amount };
}
export async function preparePayTransaction(plan: PayPlan, address: string, network: BitcoinNetwork, assertCurrent: () => void): Promise<PreparedPay> {
  if (!Number.isFinite(plan.draft.feeRate) || plan.draft.feeRate < 0.1) throw new Error("Choose a miner fee of at least 0.1 proofs/vB.");
  const authority = await verifyPayAuthority(plan, address, network, assertCurrent);
  const work = authority.amount?.asset === "WORK" ? authority.amount : null;
  const capacity = work ? await requireWorkCapacity(work, address, assertCurrent) : undefined;
  const excludeOutpoints = [...await codeReservedAnchors(address, network), ...(capacity?.anchorOutpoints ?? [])]; assertCurrent();
  const workPayload = work ? buildBoostWorkSendPayload(BigInt(work.amountSubatoms), authority.destination) : undefined;
  const records = [...plan.payloads, ...(workPayload ? [workPayload] : [])];
  const payment = await buildBoostPaymentPsbt({ excludeOutpoints, feeRate: plan.draft.feeRate, fromAddress: address, network,
    payments: [{ address: authority.destination, amountSats: Number(authority.amountSats) }], protocolPayloads: plan.payloads,
    postProtocolPayments: workPayload ? [{ address: BOOST_WORK_REGISTRY_ADDRESS, amountSats: BOOST_WORK_MUTATION_PROOFS }] : [],
    postProtocolPayloads: workPayload ? [workPayload] : [], requireP2pkhAllInputs: true });
  const evidence = inspectPreparedPayment({ psbtHex: payment.psbtHex, network: bitcoin.networks.bitcoin, paymentCount: 1, registryPaymentCount: workPayload ? 1 : 0, feeSats: payment.feeSats, changeSats: payment.changeSats });
  const recipients = evidence.outputs.filter(output => output.kind === "payment"), recipient = recipients[0], registry = recipients[1];
  if (!recipient || recipient.index !== 0 || !sameCodeAddress(recipient.address, authority.destination, network) || recipient.proofs !== authority.amountSats || JSON.stringify(evidence.records) !== JSON.stringify(records) ||
      (workPayload && (!registry || !sameCodeAddress(registry.address, BOOST_WORK_REGISTRY_ADDRESS, network) || registry.proofs !== String(BOOST_WORK_MUTATION_PROOFS)))) throw new Error("Prepared invoice payment or record differs from the reviewed intent.");
  if (workPayload && (evidence.outputs.filter(output => output.kind === "record" && output.index < registry.index).length !== plan.payloads.length || !evidence.outputs.some(output => output.kind === "record" && output.index === registry.index + 1))) throw new Error("WORK settlement output ordering differs from the reviewed invoice.");
  await verifyPayAuthority(plan, address, network, assertCurrent);
  const self = sameCodeAddress(authority.destination, address, network);
  const fields: [string, string][] = [["Signing wallet", address], ...plan.fields.filter(([label]) => label !== "Public record scripts"), ["Public record scripts", `${records.reduce((total, payload) => total + dataCarrierBytesForPayload(payload), 0)} / 100000 bytes`], ["Payment destination", authority.destination], [work ? "Separate Mail signal" : "Exact proof payment", `${authority.amountSats} proofs`]];
  if (authority.detail) fields.push(["Invoice issuer", authority.detail.invoice.issuerAddress], ["Fixed invoice recipient", authority.detail.invoice.recipientAddress], ["Invoice title", authority.detail.invoice.title], ["Exact invoice amount", formatPayAmount(authority.detail.invoice.amount)]);
  if (work) fields.push(["Exact WORK payment", formatPayAmount(work)], ["WORK registry payment", `${BOOST_WORK_MUTATION_PROOFS} proofs to ${BOOST_WORK_REGISTRY_ADDRESS}`]);
  const review: ActionReview = { title: PAY_ACTION_LABELS[plan.draft.action], networkLabel: "Mainnet", fields, evidence,
    feeRate: String(plan.draft.feeRate), dustFeeProofs: String(payment.dustFeeSats), walletSpendProofs: self ? evidence.feeProofs : evidence.totalSpendProofs,
    paymentLabels: work ? ["Separate Mail signal to the invoice recipient", "WORK transfer registry fee"] : [self ? "Mail self-payment returned to your wallet" : "Exact invoice payment"],
    explanation: plan.draft.action === "pay" ? `This transaction references the invoice and pays its fixed recipient. ${work ? "The 546-proof Mail signal, 546-proof WORK registry fee and miner fee are separate from the WORK invoice amount. " : "The miner fee is separate from the invoice amount. "}Paid requires confirmed accepted settlement. Another payer can race this payment; extra payments remain visible and do not settle the invoice again.` : plan.draft.action === "cancel" ? "Cancellation becomes effective after confirmed replay. It cannot recall a payment already signed or broadcast. Your 546-proof Mail self-payment returns to your wallet; the miner fee is spent." : "This publishes permanent public invoice terms. Keep private customer details outside the description. The amount and recipient remain fixed; your 546-proof Mail self-payment returns to your wallet and the miner fee is spent." };
  return { plan, address, network, payment, review, destination: authority.destination, amountSats: authority.amountSats, amount: authority.amount };
}
export async function verifyPayFunding(prepared: PreparedPay, ownSignedTxid?: string) {
  const authority = await verifyPayAuthority(prepared.plan, prepared.address, prepared.network, () => {}, ownSignedTxid);
  if (!sameCodeAddress(authority.destination, prepared.destination, prepared.network) || authority.amountSats !== prepared.amountSats || JSON.stringify(authority.amount) !== JSON.stringify(prepared.amount)) throw new Error("Reviewed invoice terms changed. Prepare a new review.");
  const [utxos, reserved] = await Promise.all([fetchProofApiJson<Array<{ txid: string; vout: number; status?: { confirmed?: boolean } }>>(`/api/v1/address/${encodeURIComponent(prepared.address)}/utxo?fresh=1`, prepared.network), codeReservedAnchors(prepared.address, prepared.network)]);
  if (!Array.isArray(utxos)) throw new Error("Fresh confirmed funding evidence is unavailable.");
  const available = new Set(utxos.filter(item => item.status?.confirmed === true).map(item => `${item.txid}:${item.vout}`));
  const exclusions = new Set(reserved.map(item => `${item.txid}:${item.vout}`));
  if (!prepared.review.evidence || prepared.review.evidence.inputs.some(item => !available.has(item.outpoint) || exclusions.has(item.outpoint))) throw new Error("Reviewed funding changed or became reserved by AMO. Prepare a new invoice review.");
}
