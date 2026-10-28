import {
  buildWorkMailBatchPayload, canonicalWorkMailBatchAddress, workMailBatchMemoIsOrdinary,
  WORK_MAIL_BATCH_MIN_RECIPIENTS, WORK_MAIL_BATCH_MAX_RECIPIENTS,
  WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES, WORK_MAIL_BATCH_MAX_SUBATOMS,
  WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS,
} from "../../shared/protocol/workMailBatch.mjs";

export const LEGACY_MAIL_WORK_MAX_RECIPIENTS = 10;
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const height = value => Number.isSafeInteger(value) && value > 0;

/** An unavailable new capability never authorizes a legacy attachment. */
export function readWorkMailBatchStatus(value) {
  if (!value || value.protocol !== "work-mail-batch-v1" || value.network !== "livenet" ||
      typeof value.active !== "boolean" || typeof value.writeEnabled !== "boolean" || typeof value.ready !== "boolean" ||
      value.registryFeeProofs !== WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS ||
      value.limits?.minRecipients !== WORK_MAIL_BATCH_MIN_RECIPIENTS ||
      value.limits?.maxRecipients !== WORK_MAIL_BATCH_MAX_RECIPIENTS ||
      value.limits?.maxPayloadBytes !== WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES ||
      !height(value.checkedTipHeight) || !hash(value.checkedTipHash) ||
      !(value.reasonCode === null || typeof value.reasonCode === "string") ||
      !(value.declarationTxid === null || hash(value.declarationTxid)) ||
      !(value.activationHeight === null || height(value.activationHeight)) ||
      (value.declarationTxid === null) !== (value.activationHeight === null) ||
      value.active && (!hash(value.declarationTxid) || !height(value.activationHeight) || value.checkedTipHeight < value.activationHeight) ||
      value.ready && (!value.active || !value.writeEnabled)) {
    throw new Error("Verified Mail WORK attachment status is unavailable or inconsistent. Refresh before attaching WORK.");
  }
  return value;
}

export function workMailAttachmentMode(value, previous) {
  const status = readWorkMailBatchStatus(value);
  if (previous && (status.checkedTipHeight < previous.checkedTipHeight ||
      status.checkedTipHeight === previous.checkedTipHeight && status.checkedTipHash !== previous.checkedTipHash ||
      previous.active && (!status.active || status.declarationTxid !== previous.declarationTxid || status.activationHeight !== previous.activationHeight))) {
    throw new Error("Mail WORK activation or its chain checkpoint changed. Refresh and review again.");
  }
  if (!status.active) {
    if (!["work-mail-batch-declaration-unconfigured", "work-mail-batch-activation-not-indexed"].includes(status.reasonCode)) {
      throw new Error("Mail WORK activation has not been verified. No legacy fallback is permitted while its status is unavailable.");
    }
    return { mode: "legacy", status };
  }
  if (!status.ready || !status.writeEnabled) {
    throw new Error(`Mail WORK attachments are paused${status.reasonCode ? ` (${status.reasonCode})` : ""}. No legacy fallback is permitted after activation.`);
  }
  return { mode: "mailbatch1", status };
}

/** This ordered list owns payments, attachment quantities, review and rechecks. */
export function canonicalMailRecipients(to, cc, network = "livenet") {
  const seen = new Set();
  const recipients = [];
  for (const [role, rows] of [["To", to], ["CC", cc]]) {
    for (const item of rows) {
      const address = canonicalWorkMailBatchAddress(item.paymentAddress, { network });
      if (seen.has(address)) continue;
      seen.add(address);
      recipients.push({ address, role, label: item.isId ? item.displayRecipient : address,
        ...(item.id ? { id: item.id } : {}) });
    }
  }
  if (recipients.length < 1 || recipients.length > WORK_MAIL_BATCH_MAX_RECIPIENTS) {
    throw new Error(`Mail requires 1–${WORK_MAIL_BATCH_MAX_RECIPIENTS} unique recipients.`);
  }
  return recipients;
}

export function assertSameMailRoutes(previous, fresh) {
  const key = rows => JSON.stringify(rows.map(row => [row.role, row.id ?? null, row.address]));
  if (key(previous) !== key(fresh)) throw new Error("A Mail recipient route changed. Review the current destinations again.");
}

export function planWorkMailAttachment({ recipients, amountSubatoms, status, previousStatus, legacyPayload, socialMode = false, message = "", parentTxid, hasAttachment = false }) {
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > WORK_MAIL_BATCH_MAX_RECIPIENTS) throw new Error("Mail requires 1–256 unique recipients.");
  if (typeof amountSubatoms !== "string" || amountSubatoms.length > 24 || !/^(?:0|[1-9][0-9]*)$/u.test(amountSubatoms) || BigInt(amountSubatoms) > WORK_MAIL_BATCH_MAX_SUBATOMS) {
    throw new Error("Enter a valid exact WORK attachment amount.");
  }
  const amount = BigInt(amountSubatoms);
  const total = amount * BigInt(recipients.length);
  if (total > WORK_MAIL_BATCH_MAX_SUBATOMS) throw new Error("The total WORK attachment exceeds the WORK supply.");
  if (!amount) return { mode: "none", payloads: [], registryFeeProofs: 0, totalAmountSubatoms: "0", recipientCount: recipients.length, feeLabel: "" };
  const selected = socialMode ? { mode: "legacy" } : workMailAttachmentMode(status, previousStatus);
  if (selected.mode === "legacy") {
    if (recipients.length > LEGACY_MAIL_WORK_MAX_RECIPIENTS) {
      throw new Error("Before Mail batch activation, WORK attachments support at most 10 recipients at 546 proofs each.");
    }
    if (typeof legacyPayload !== "function") throw new Error("Legacy WORK transfer admission is unavailable.");
    const payloads = recipients.map(row => legacyPayload(row.address));
    if (payloads.some(value => typeof value !== "string" || !value)) throw new Error("Legacy WORK transfer admission is unavailable.");
    return { ...selected, payloads, registryFeeProofs: WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS * recipients.length,
      totalAmountSubatoms: total.toString(), recipientCount: recipients.length,
      feeLabel: `Legacy WORK attachment: 546 proofs per recipient · ${WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS * recipients.length} proofs total.` };
  }
  if (!workMailBatchMemoIsOrdinary({ message, parentTxid, hasAttachment })) {
    throw new Error("This record is a Jobs or bond action. Use its dedicated workspace; Mail WORK batches require an ordinary Mail message, reply, or file.");
  }
  return { ...selected,
    payloads: [buildWorkMailBatchPayload(recipients.map(row => ({ recipientAddress: row.address, amountSubatoms })))],
    registryFeeProofs: WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS,
    totalAmountSubatoms: total.toString(), recipientCount: recipients.length,
    feeLabel: "WORK attachment: 546 proofs once for all recipients. Mail payments and the miner fee are separate." };
}
