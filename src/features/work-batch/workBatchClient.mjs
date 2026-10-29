import {
  WORK_BATCH_MIN_RECIPIENTS, WORK_BATCH_MAX_RECIPIENTS, WORK_BATCH_MAX_PAYLOAD_BYTES,
  WORK_BATCH_REGISTRY_FEE_PROOFS, WORK_BATCH_MAX_SUBATOMS, validateWorkBatchRecipients,
} from "../../shared/protocol/workBatch.mjs";

const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

export function readWorkBatchStatus(value) {
  if (!value || value.protocol !== "work-batch-v1" || value.network !== "livenet" ||
      typeof value.active !== "boolean" || typeof value.writeEnabled !== "boolean" || typeof value.ready !== "boolean" ||
      value.registryFeeProofs !== WORK_BATCH_REGISTRY_FEE_PROOFS ||
      value.limits?.minRecipients !== WORK_BATCH_MIN_RECIPIENTS || value.limits?.maxRecipients !== WORK_BATCH_MAX_RECIPIENTS ||
      value.limits?.maxPayloadBytes !== WORK_BATCH_MAX_PAYLOAD_BYTES ||
      !(value.reasonCode === null || typeof value.reasonCode === "string")) {
    throw new Error("WORK batch status is unavailable or inconsistent. No transaction can be prepared.");
  }
  if (value.ready && (!value.active || !value.writeEnabled || !hash(value.declarationTxid) ||
      !positiveInteger(value.activationHeight) || !positiveInteger(value.checkedTipHeight) ||
      value.checkedTipHeight < value.activationHeight || !hash(value.checkedTipHash))) {
    throw new Error("WORK batch activation evidence is incomplete. No transaction can be prepared.");
  }
  return value;
}

export function assertWorkBatchReady(value, previous) {
  const status = readWorkBatchStatus(value);
  if (!status.ready || !status.active || !status.writeEnabled) {
    const state = !status.active ? "is not active against its verified declaration"
      : !status.writeEnabled ? "is disabled"
      : "is currently paused";
    throw new Error(`WORK batch sending ${state}${status.reasonCode ? ` (${status.reasonCode})` : ""}. Refresh status and review again when ready. No broadcast was attempted.`);
  }
  if (previous && (status.declarationTxid !== previous.declarationTxid || status.activationHeight !== previous.activationHeight ||
      status.checkedTipHeight < previous.checkedTipHeight ||
      status.checkedTipHeight === previous.checkedTipHeight && status.checkedTipHash !== previous.checkedTipHash)) {
    throw new Error("WORK batch activation or chain checkpoint changed. Refresh and review again.");
  }
  return status;
}

export function workBatchAmountSubatoms(value) {
  const text = String(value).trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,16})?$/u.test(text)) throw new Error("Enter a positive WORK amount with up to 16 decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 10000000000000000n + BigInt(fraction.padEnd(16, "0"));
  if (amount <= 0n || amount > BigInt(WORK_BATCH_MAX_SUBATOMS)) throw new Error("WORK each must be positive and no greater than the WORK supply.");
  return amount.toString();
}

export function splitWorkBatchInputs(value) {
  const inputs = String(value).split(/[,;\n]+/u).map(item => item.trim()).filter(Boolean);
  if (inputs.length < WORK_BATCH_MIN_RECIPIENTS || inputs.length > WORK_BATCH_MAX_RECIPIENTS) {
    throw new Error(`Enter ${WORK_BATCH_MIN_RECIPIENTS}–${WORK_BATCH_MAX_RECIPIENTS} recipient IDs or addresses.`);
  }
  return inputs;
}

export async function resolveWorkBatchDraft(input, amountEach, { validateAddress, resolveId, signal } = {}) {
  const inputs = splitWorkBatchInputs(input);
  const amountSubatoms = workBatchAmountSubatoms(amountEach);
  const resolved = new Array(inputs.length);
  let next = 0;
  // Bound first-party ID reads; keep the signed vector in the user's input order.
  async function worker() {
    while (next < inputs.length) {
      signal?.throwIfAborted();
      const index = next++;
      const value = inputs[index];
      if (validateAddress(value)) {
        resolved[index] = { input: value, id: null, recipientAddress: value, amountSubatoms };
      } else {
        const id = value.toLowerCase().replace(/^@/u, "").replace(/@proofofwork\.me$/u, "").trim();
        if (!id || id.includes("@")) throw new Error(`Invalid recipient: ${value}`);
        const record = await resolveId(id, signal);
        signal?.throwIfAborted();
        if (!record || record.confirmed !== true || record.network !== "livenet" || record.id !== id || !validateAddress(record.receiveAddress)) {
          throw new Error(`No confirmed receiver found for ${id}@proofofwork.me.`);
        }
        resolved[index] = { input: value, id, recipientAddress: record.receiveAddress, amountSubatoms };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, inputs.length) }, worker));
  const validated = validateWorkBatchRecipients(resolved.map(({ recipientAddress, amountSubatoms }) => ({ recipientAddress, amountSubatoms })), { network: "livenet", validateAddress });
  return { ...validated, destinations: resolved.map((row, index) => ({ ...row, recipientAddress: validated.recipients[index].recipientAddress })) };
}

export function assertSameWorkBatchRoutes(previous, fresh) {
  if (previous.totalAmountSubatoms !== fresh.totalAmountSubatoms || JSON.stringify(previous.destinations.map(row => [row.id, row.recipientAddress, row.amountSubatoms])) !==
      JSON.stringify(fresh.destinations.map(row => [row.id, row.recipientAddress, row.amountSubatoms]))) {
    throw new Error("A recipient route or amount changed. Check recipients and review the batch again.");
  }
}
