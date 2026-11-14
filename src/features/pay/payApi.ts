import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { PAY_ACTIVATION_HEIGHT, PAY_ACTIVATION_PREVIOUS_BLOCK_HASH, normalizePayAmount, type PayAmount } from "../../shared/protocol/pay.mjs";

export const PAY_TXID = /^[a-f0-9]{64}$/u;
export const PAY_STATUSES = ["open", "paid", "cancelled"] as const;
export type PayAction = "invoice" | "pay" | "cancel";
export type PayWorkSettlement = { valid: true; source: "canonical-work-send3-relational-raw-replay"; reward: PayAmount; paymentTxid: string; protocolVout: number; registryVout: number; blockHeight: number; blockHash: string; blockTransactionIndex: number };
export type Invoice = {
  txid: string; headTxid: string; issuerAddress: string; recipientAddress: string;
  title: string; description: string; amount: PayAmount; reference: string | null;
  status: typeof PAY_STATUSES[number]; paymentTxid: string; payerAddress: string;
  paidAmount: PayAmount | null; blockHeight: number; blockHash: string; blockTransactionIndex: number;
  blockTime?: number | string | null; createdAt?: number | string | null; updatedAt?: number | string | null;
  workSettlement?: PayWorkSettlement;
};
export type PayEvent = {
  txid: string; action: PayAction | "invalid"; invoiceTxid: string; authorAddress: string;
  metadata: Record<string, unknown>; confirmed: boolean; valid: boolean; applied: boolean;
  validationErrors: string[]; blockHeight: number; blockHash: string; blockTransactionIndex: number;
  rawBody?: string; [key: string]: unknown;
};
export type PayEvidence = {
  network: BitcoinNetwork; complete: true; source: "proof-indexer-exact-canonical-pay-replay";
  snapshot: { id: string; checkpointHeight: number; checkpointHash: string };
  indexedThroughBlock: number; indexedThroughBlockHash: string;
  activation: { height: number; previousBlockHash: string; ready: boolean };
  admission: { ready: boolean; writesEnabled: boolean; reason?: string };
  pendingEvents: PayEvent[]; pendingComplete?: boolean;
  stats?: { invoices?: number; open?: number; paid?: number; cancelled?: number; paidProofs?: string; paidWorkSubatoms?: string };
};
export type PayList = PayEvidence & { invoices: Invoice[]; pagination: { hasMore: boolean; nextCursor?: string | null; total?: number } };
export type PayDetail = PayEvidence & { invoice: Invoice; events: PayEvent[]; eventsComplete: true; receipt: Record<string, unknown> | null };
export function exactProofs(value: unknown, minimum = 0n): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]{0,15})$/u.test(value) && BigInt(value) >= minimum && BigInt(value) <= 2100000000000000n;
}
export function assertPayEvidence(value: PayEvidence, network: BitcoinNetwork) {
  if (!value || value.network !== network || value.complete !== true || value.source !== "proof-indexer-exact-canonical-pay-replay" ||
      PAY_ACTIVATION_HEIGHT <= 0 || value.activation?.height !== PAY_ACTIVATION_HEIGHT || value.activation.previousBlockHash !== PAY_ACTIVATION_PREVIOUS_BLOCK_HASH ||
      typeof value.activation.ready !== "boolean" || !value.snapshot?.id || !Number.isSafeInteger(value.indexedThroughBlock) || value.indexedThroughBlock < PAY_ACTIVATION_HEIGHT - 1 ||
      (value.activation.ready && value.indexedThroughBlock < PAY_ACTIVATION_HEIGHT) ||
      !PAY_TXID.test(value.indexedThroughBlockHash) || value.snapshot.checkpointHeight !== value.indexedThroughBlock || value.snapshot.checkpointHash !== value.indexedThroughBlockHash ||
      (value.indexedThroughBlock === PAY_ACTIVATION_HEIGHT - 1 && value.indexedThroughBlockHash !== PAY_ACTIVATION_PREVIOUS_BLOCK_HASH) ||
      typeof value.admission?.ready !== "boolean" || typeof value.admission.writesEnabled !== "boolean" || !Array.isArray(value.pendingEvents)) {
    throw new Error("Complete confirmed Pay evidence is unavailable. Refresh before continuing.");
  }
  if (value.pendingEvents.some(event => !event || !PAY_TXID.test(event.txid) || event.confirmed !== false || event.applied === true)) throw new Error("Pending Pay evidence has inconsistent confirmation state.");
}
export function assertInvoice(value: Invoice) {
  if (!value || !PAY_TXID.test(value.txid) || !PAY_TXID.test(value.headTxid) || !PAY_STATUSES.includes(value.status) ||
      !value.issuerAddress || !value.recipientAddress || [value.issuerAddress, value.recipientAddress, value.title, value.description, value.paymentTxid, value.payerAddress].some(item => typeof item !== "string") ||
      !normalizePayAmount(value.amount) || (value.reference !== null && !PAY_TXID.test(value.reference)) ||
      !Number.isSafeInteger(value.blockHeight) || value.blockHeight < PAY_ACTIVATION_HEIGHT || !PAY_TXID.test(value.blockHash) || !Number.isSafeInteger(value.blockTransactionIndex) || value.blockTransactionIndex < 0) throw new Error("Invoice terms or confirmed position are incomplete.");
  if (value.status === "paid" && (!PAY_TXID.test(value.paymentTxid) || !value.payerAddress || JSON.stringify(normalizePayAmount(value.paidAmount)) !== JSON.stringify(normalizePayAmount(value.amount)))) throw new Error("Exact invoice settlement evidence is unavailable.");
  if ((value.status === "open" && value.headTxid !== value.txid) || (value.status === "paid" && value.headTxid !== value.paymentTxid)) throw new Error("Invoice head differs from its confirmed lifecycle.");
  if (value.status !== "paid" && (value.paymentTxid || value.payerAddress || value.paidAmount !== null)) throw new Error("Unpaid invoice contains inconsistent settlement evidence.");
  if (value.status === "paid" && value.amount.asset === "WORK") {
    const settlement = value.workSettlement;
    if (!settlement || settlement.valid !== true || settlement.source !== "canonical-work-send3-relational-raw-replay" || settlement.paymentTxid !== value.paymentTxid ||
      JSON.stringify(normalizePayAmount(settlement.reward)) !== JSON.stringify(normalizePayAmount(value.amount)) ||
      !Number.isSafeInteger(settlement.protocolVout) || !Number.isSafeInteger(settlement.registryVout) || settlement.registryVout < 0 || settlement.protocolVout <= settlement.registryVout ||
      !Number.isSafeInteger(settlement.blockHeight) || settlement.blockHeight <= value.blockHeight || !PAY_TXID.test(settlement.blockHash) || !Number.isSafeInteger(settlement.blockTransactionIndex) || settlement.blockTransactionIndex < 0) throw new Error("Accepted exact WORK settlement evidence is unavailable.");
  }
}
export function requirePayPublication(value: PayEvidence) {
  if (!value.activation.ready || value.admission.ready !== true || value.admission.writesEnabled !== true) throw new Error(value.admission.reason || "Pay publication is closed until activation, complete discovery and the independent write gate are verified.");
}
export async function fetchPayInvoices(network: BitcoinNetwork, params: { q?: string; status?: string; address?: string; fresh?: boolean; cursor?: string; snapshot?: string; signal?: AbortSignal } = {}) {
  const query = new URLSearchParams({ limit: "24" });
  for (const key of ["q", "status", "address", "cursor", "snapshot"] as const) if (params[key]) query.set(key, params[key]!);
  if (params.fresh) query.set("fresh", "1");
  const value = await fetchProofApiJson<PayList>(`/api/v1/pay-invoices?${query}`, network, { signal: params.signal });
  assertPayEvidence(value, network);
  if (!Array.isArray(value.invoices) || typeof value.pagination?.hasMore !== "boolean" || (value.pagination.hasMore && !value.pagination.nextCursor) || (params.snapshot && value.snapshot.id !== params.snapshot)) throw new Error("Invoice page coverage is incomplete or changed. Refresh the list.");
  value.invoices.forEach(item => { assertInvoice(item); if (item.blockHeight > value.indexedThroughBlock || (item.workSettlement && item.workSettlement.blockHeight > value.indexedThroughBlock)) throw new Error("Invoice evidence exceeds its verified checkpoint."); });
  if (new Set(value.invoices.map(item => item.txid)).size !== value.invoices.length) throw new Error("Invoice page contains duplicate records.");
  return value;
}
export async function fetchPayInvoice(network: BitcoinNetwork, invoice: string, params: { fresh?: boolean; signal?: AbortSignal } = {}) {
  if (!PAY_TXID.test(invoice)) throw new Error("Enter a 64-character lowercase invoice transaction ID.");
  const query = new URLSearchParams({ invoice });
  if (params.fresh) query.set("fresh", "1");
  const value = await fetchProofApiJson<PayDetail>(`/api/v1/pay-invoice?${query}`, network, { signal: params.signal });
  assertPayEvidence(value, network); assertInvoice(value.invoice);
  if (value.invoice.blockHeight > value.indexedThroughBlock || (value.invoice.workSettlement && value.invoice.workSettlement.blockHeight > value.indexedThroughBlock)) throw new Error("Invoice evidence exceeds its verified checkpoint.");
  if (value.invoice.txid !== invoice || value.eventsComplete !== true || !Array.isArray(value.events) || (value.invoice.status === "paid" && !value.receipt)) throw new Error("Complete invoice and receipt history is unavailable.");
  for (const event of value.events) if (!event || !PAY_TXID.test(event.txid) || event.invoiceTxid !== invoice || !["invoice", "pay", "cancel", "invalid"].includes(event.action) || event.confirmed !== true || typeof event.valid !== "boolean" || typeof event.applied !== "boolean" || (event.applied && !event.valid) || !Array.isArray(event.validationErrors) || !Number.isSafeInteger(event.blockHeight) || event.blockHeight > value.indexedThroughBlock || !PAY_TXID.test(event.blockHash) || !Number.isSafeInteger(event.blockTransactionIndex) || event.blockTransactionIndex < 0) throw new Error("Confirmed invoice history is inconsistent.");
  if (new Set(value.events.map(event => event.txid)).size !== value.events.length) throw new Error("Confirmed invoice history contains duplicate records.");
  if (!value.events.some(event => event.txid === invoice && event.action === "invoice" && event.valid && event.applied) ||
      (value.invoice.status === "paid" && !value.events.some(event => event.txid === value.invoice.paymentTxid && event.action === "pay" && event.valid && event.applied))) throw new Error("The invoice or settlement is absent from its confirmed history.");
  if (value.invoice.status === "cancelled" && !value.events.some(event => event.txid === value.invoice.headTxid && event.action === "cancel" && event.valid && event.applied && event.authorAddress === value.invoice.issuerAddress)) throw new Error("Invoice cancellation is absent from its confirmed history.");
  if (value.invoice.status !== "paid" && value.receipt !== null) throw new Error("Unpaid invoice has inconsistent receipt evidence.");
  if (value.invoice.status === "paid") {
    const receipt = value.receipt!, payment = value.events.find(event => event.txid === value.invoice.paymentTxid)!;
    if (receipt.invoiceTxid !== invoice || receipt.paymentTxid !== value.invoice.paymentTxid || receipt.payerAddress !== value.invoice.payerAddress ||
      receipt.issuerAddress !== value.invoice.issuerAddress || receipt.recipientAddress !== value.invoice.recipientAddress ||
      JSON.stringify(normalizePayAmount(receipt.amount)) !== JSON.stringify(normalizePayAmount(value.invoice.amount)) ||
      receipt.blockHeight !== payment.blockHeight || receipt.blockHash !== payment.blockHash || receipt.blockTransactionIndex !== payment.blockTransactionIndex || payment.authorAddress !== receipt.payerAddress) {
      throw new Error("Exact receipt fields do not match confirmed invoice settlement.");
    }
    if (value.invoice.amount.asset === "WORK" && JSON.stringify(receipt.workSettlement) !== JSON.stringify(value.invoice.workSettlement)) throw new Error("Receipt WORK settlement differs from the exact accepted invoice payment.");
  }
  return value;
}
