import { encodePayRecord, formatPayAmount, parsePayWorkDecimal, PAY_WORK_TOKEN_ID, type PayAmount } from "../../shared/protocol/pay.mjs";
import { encodeTextBase64Url, sha256Hex } from "../../shared/utils/encoding";
import { dataCarrierBytesForPayload, scriptForAddress } from "../boost/boostWallet";
import { exactProofs, PAY_TXID, type PayAction } from "./payApi";

export type PayDraft = { action: PayAction; title: string; description: string; recipient: string; asset: "proofs" | "WORK"; proofs: string; work: string; reference: string; invoice: string; expectedHead: string; reason: string; feeRate: number };
export const emptyPayDraft: PayDraft = { action: "invoice", title: "", description: "", recipient: "", asset: "proofs", proofs: "546", work: "1", reference: "", invoice: "", expectedHead: "", reason: "", feeRate: 1 };
export type PayPlan = { draft: PayDraft; memo: string; metadata: Record<string, unknown>; payloads: string[]; carrierBytes: number; fields: [string, string][]; key: string };
export const PAY_ACTION_LABELS: Record<PayAction, string> = { invoice: "Publish invoice", pay: "Pay invoice", cancel: "Cancel invoice" };
export function draftPayAmount(draft: PayDraft): PayAmount {
  if (draft.asset === "WORK") {
    const amountSubatoms = parsePayWorkDecimal(draft.work);
    if (!amountSubatoms) throw new Error("Enter exact positive WORK with up to 16 decimal places and no more than 21,000,000 WORK.");
    return { asset: "WORK", token: PAY_WORK_TOKEN_ID, amountSubatoms };
  }
  if (!exactProofs(draft.proofs, 546n)) throw new Error("Enter an exact whole-proof amount of at least 546 proofs.");
  return { asset: "proofs", amountSats: draft.proofs };
}
export function buildPayPlan(draft: PayDraft): PayPlan {
  if (!isPayDraft(draft)) throw new Error("Invoice draft fields are invalid.");
  let metadata: Record<string, unknown>;
  const fields: [string, string][] = [["Action", PAY_ACTION_LABELS[draft.action]]];
  if (draft.action === "invoice") {
    scriptForAddress(draft.recipient, "livenet", "Fixed invoice recipient");
    if (draft.recipient.trim() !== draft.recipient) throw new Error("Enter the exact receiving address without surrounding spaces.");
    const amount = draftPayAmount(draft);
    metadata = { v: 1, title: draft.title, description: draft.description, recipient: draft.recipient, amount, reference: draft.reference || null };
    fields.push(["Invoice title", draft.title], ["Public description", draft.description], ["Fixed receiving address", draft.recipient], ["Exact requested amount", formatPayAmount(amount)], ["Work reference", draft.reference || "None"]);
  } else {
    if (!PAY_TXID.test(draft.invoice) || !PAY_TXID.test(draft.expectedHead)) throw new Error("Select a verified confirmed invoice before preparing this action.");
    metadata = draft.action === "pay" ? { v: 1, invoice: draft.invoice } : { v: 1, invoice: draft.invoice, reason: draft.reason };
    fields.push(["Invoice transaction", draft.invoice], ["Reviewed confirmed head", draft.expectedHead]);
    if (draft.action === "cancel") fields.push(["Cancellation reason", draft.reason]);
  }
  const memo = encodePayRecord(draft.action, metadata);
  const payloads = [`pwm1:s:${encodeTextBase64Url(`${PAY_ACTION_LABELS[draft.action]}${draft.title ? `: ${draft.title}` : ""}`)}`, `pwm1:m:${memo}`];
  const carrierBytes = payloads.reduce((total, payload) => total + dataCarrierBytesForPayload(payload), 0);
  if (carrierBytes > 100000) throw new Error("The invoice exceeds the 100,000-byte on-chain script budget.");
  fields.push(["Public record scripts", `${carrierBytes} / 100000 bytes`]);
  const key = draft.action === "invoice" ? `pay:invoice:${sha256Hex(new TextEncoder().encode(memo))}` : `pay:invoice:${draft.invoice}:${draft.expectedHead}`;
  return { draft: { ...draft }, memo, metadata, payloads, carrierBytes, fields, key };
}
export function isPayDraft(value: unknown): value is PayDraft {
  if (!value || typeof value !== "object") return false;
  const item = value as PayDraft;
  return Object.prototype.hasOwnProperty.call(PAY_ACTION_LABELS, item.action) && [item.title, item.description, item.recipient, item.proofs, item.work, item.reference, item.invoice, item.expectedHead, item.reason].every(field => typeof field === "string") && ["proofs", "WORK"].includes(item.asset) && Number.isFinite(item.feeRate);
}
export function persistPayDraft(storage: Storage, key: string, draft: PayDraft) {
  const encoded = JSON.stringify(draft); storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) throw new Error("Invoice draft autosave could not be verified. Copy your fields before leaving.");
}
export const payDraftFields = (draft: PayDraft): [string, string][] => [["Pay draft", JSON.stringify(draft)]];
export function restorePayDraft(fields: [string, string][]) {
  try { const value: unknown = JSON.parse(Object.fromEntries(fields)["Pay draft"] ?? "null"); return isPayDraft(value) ? value : undefined; } catch { return; }
}
