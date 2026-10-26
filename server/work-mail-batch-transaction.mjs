import * as bitcoin from "bitcoinjs-lib";
import {
  parseWorkMailBatchPayload, workMailBatchMemoIsOrdinary,
  WORK_MAIL_BATCH_REGISTRY_ADDRESS,
  WORK_MAIL_BATCH_MUTATION_PAYMENT_PROOFS,
} from "../src/shared/protocol/workMailBatch.mjs";
import { verifyOwnerOutputCommitment } from "../src/shared/protocol/ownerOutputCommitment.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "./canonical-op-return.mjs";
import { workAmoV5CanonicalPayloadCommitment, parseWorkAmoV5PwmMessages } from "./work-amo-v5.mjs";
import { WORK_SUBATOM_PROJECTION_MODEL } from "./work-units.mjs";

function scriptHex(output) {
  const sources = [output?.scriptPubKeyHex, output?.scriptPubKey?.hex, output?.scriptpubkey]
    .filter(value => value !== undefined && value !== null);
  return sources.length > 0 && sources.every(value => typeof value === "string" && /^(?:[0-9a-f]{2})+$/iu.test(value)) &&
    new Set(sources.map(value => value.toLowerCase())).size === 1 ? sources[0].toLowerCase() : "";
}

function proofs(output) {
  if (output?.scriptPubKey && typeof output.scriptPubKey === "object") {
    const value = output.value;
    const text = typeof value === "number" ? Number.isFinite(value) ? value.toFixed(8) : "" : String(value ?? "");
    const match = /^([0-9]+)(?:\.([0-9]{0,8}))?$/u.exec(text);
    if (!match) return null;
    const amount = BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0"));
    return amount <= 2_100_000_000_000_000n ? amount : null;
  }
  const value = output?.value ?? output?.amountSats ?? output?.outputSats;
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) return null;
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text) || text.length > 16) return null;
  const amount = BigInt(text);
  return amount <= 2_100_000_000_000_000n ? amount : null;
}

function address(output) {
  try { return bitcoin.address.fromOutputScript(Buffer.from(scriptHex(output), "hex"), bitcoin.networks.bitcoin); }
  catch { return ""; }
}

// Strict envelope validation is local to the new version. The historical PWM
// parser deliberately tolerates unknown/malformed optional parts; mailbatch1
// cannot use those ambiguities to conceal a second action or incomplete file.
function ordinaryEnvelope(parts) {
  const texts = parts.map(part => part.text);
  if (texts.some(text => !/^pwm1:(?:m|s|r|a):/u.test(text))) return null;
  const subjects = texts.filter(text => text.startsWith("pwm1:s:"));
  const replies = texts.filter(text => text.startsWith("pwm1:r:"));
  const attachments = texts.filter(text => text.startsWith("pwm1:a:"));
  const bodies = texts.filter(text => text.startsWith("pwm1:m:"));
  if (!bodies.length || subjects.length > 1 || replies.length > 1 ||
      replies.some(text => !/^pwm1:r:[0-9a-f]{64}$/u.test(text))) return null;
  const decode = value => {
    if (!/^[A-Za-z0-9_-]*$/u.test(value)) throw new Error("Noncanonical base64url.");
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error("Noncanonical base64url.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0") || !Buffer.from(text).equals(bytes)) throw new Error("Invalid text.");
    return text;
  };
  try {
    subjects.forEach(text => decode(text.slice(7)));
    // Bound declared counts before the legacy parser allocates its chunk array.
    let metadata;
    for (const [index, text] of attachments.entries()) {
      const match = /^pwm1:a:([^:]*):([^:]*):([1-9][0-9]*):([0-9a-f]{64}):(0|[1-9][0-9]*)\/([1-9][0-9]*):([A-Za-z0-9_-]+)$/u.exec(text);
      if (!match || Number(match[3]) > 60000 || Number(match[6]) !== attachments.length || Number(match[5]) !== index) return null;
      decode(match[1]); decode(match[2]);
      const current = JSON.stringify(match.slice(1, 5));
      if (metadata !== undefined && current !== metadata) return null;
      metadata = current;
    }
    const parsed = parseWorkAmoV5PwmMessages(texts);
    if (!parsed || !["mail", "reply", "file"].includes(parsed.kind) || parsed.tokenFamily ||
        !workMailBatchMemoIsOrdinary({ message: parsed.memo, parentTxid: parsed.parentTxid, hasAttachment: Boolean(parsed.attachment) }) || (attachments.length > 0 && !parsed.attachment)) return null;
    return parsed;
  } catch { return null; }
}

// Also used by sealed-history readers: they obtain the sender and accepted
// record from the canonical transition, never from an unverified UI payload.
export function validateWorkMailBatchV1TransactionShape({ transaction, protocolVout, recordOrdinal = 0, senderAddress } = {}) {
  let parsed = null;
  const invalid = reasonCode => ({ valid: false, reasonCode, parsed });
  try {
    const { records } = canonicalRawProtocolRecordSetFromTransaction(transaction);
    const record = records.find(row => row.protocolVout === protocolVout && row.recordOrdinal === recordOrdinal);
    parsed = parseWorkMailBatchPayload(record?.message);
    if (!parsed) return invalid("work-mail-batch-v1-payload-invalid");
    const outputs = transaction?.vout;
    const mail = records.find(row => row.protocol === "pwm1");
    const parts = mail?.rawRecordParts ?? [];
    const first = mail?.protocolVout, last = parts.at(-1)?.protocolVout;
    const classification = ordinaryEnvelope(parts);
    // Exactly N ordinary recipient payments, a complete contiguous PWM
    // envelope, its dedicated fee, the sole PWT carrier, then sender change.
    // A recipient may itself be the registry; only the positional fee is owned
    // by this WORK record.
    if (!senderAddress || !Array.isArray(outputs) || records.length !== 2 || recordOrdinal !== 0 ||
        record.rawDecodeValid !== true || mail?.rawDecodeValid !== true || !classification ||
        first !== parsed.recipientCount || last !== first + parts.length - 1 ||
        parts.some((part, index) => part.protocolVout !== first + index || part.decodeValid !== true) ||
        protocolVout !== last + 2 ||
        ![protocolVout + 1, protocolVout + 2].includes(outputs.length) ||
        outputs.some((output, vout) => {
          const value = proofs(output), script = scriptHex(output);
          if (value === null || !script) return true;
          if (vout < first) return value <= 0n || address(output) !== parsed.recipients[vout].recipientAddress;
          if (vout >= first && vout <= last || vout === protocolVout) return value !== 0n || !script.startsWith("6a");
          if (vout === last + 1) return value !== BigInt(WORK_MAIL_BATCH_MUTATION_PAYMENT_PROOFS) || address(output) !== WORK_MAIL_BATCH_REGISTRY_ADDRESS;
          return vout < protocolVout || address(output) !== senderAddress || script.startsWith("6a") || value <= 0n;
        }) || outputs.reduce((sum, output) => sum + (scriptHex(output).startsWith("6a") ? scriptHex(output).length / 2 : 0), 0) > 100000) {
      return invalid("work-mail-batch-v1-transaction-shape-invalid");
    }
    const recipients = parsed.recipients.map(({ recipientAddress }, vout) => ({ recipientAddress, amountSats: proofs(outputs[vout]).toString(), vout }));
    const mailEnvelope = { protocolVout: first, lastProtocolVout: last, recordOrdinal: 0, kind: classification.kind,
      payloadCommitment: workAmoV5CanonicalPayloadCommitment({ parts: parts.map(({ protocolVout, text }) => ({ protocolVout, text })) }), recipients };
    return { valid: true, reasonCode: "", parsed, senderAddress, mailEnvelope,
      registryPayment: { address: WORK_MAIL_BATCH_REGISTRY_ADDRESS, amountSats: WORK_MAIL_BATCH_MUTATION_PAYMENT_PROOFS,
        outputSats: WORK_MAIL_BATCH_MUTATION_PAYMENT_PROOFS, vout: last + 1, scriptPubKeyHex: scriptHex(outputs[last + 1]) } };
  } catch { return invalid("work-mail-batch-v1-transaction-evidence-invalid"); }
}

export function validateWorkMailBatchV1RawTransaction({ transaction, protocolVout, recordOrdinal = 0 } = {}) {
  const inputs = transaction?.vin;
  const senderAddress = address(inputs?.[0]?.prevout);
  const shape = validateWorkMailBatchV1TransactionShape({ transaction, protocolVout, recordOrdinal, senderAddress });
  if (!shape.valid) return shape;
  const invalid = reasonCode => ({ valid: false, reasonCode, parsed: shape.parsed });
  try {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 128) return invalid("work-mail-batch-v1-inputs-invalid");
    const ownerCommitment = verifyOwnerOutputCommitment({ rawTransactionHex: transaction.hex, txid: transaction.txid,
      prevouts: inputs.map(input => ({ txid: input.txid, vout: input.vout, scriptPubKeyHex: scriptHex(input.prevout),
        valueSats: proofs(input.prevout)?.toString() })) },
      { ownerAddress: senderAddress, network: "livenet", requireAllInputsCommitted: true, allowAnyoneCanPay: false });
    if (!ownerCommitment.valid) return invalid(ownerCommitment.reason);
    if (ownerCommitment.outputs.length !== transaction.vout.length || ownerCommitment.outputs.some((output, index) =>
      output.scriptPubKeyHex !== scriptHex(transaction.vout[index]) || output.valueSats !== proofs(transaction.vout[index])?.toString())) {
      return invalid("work-mail-batch-v1-raw-output-witness-mismatch");
    }
    return { ...shape, ownerCommitment };
  } catch { return invalid("work-mail-batch-v1-transaction-evidence-invalid"); }
}

// Pending children are observations of one signed carrier, never independent
// raw records or confirmed transition evidence. Validate the complete set before
// persistence so dropping, duplicating or changing a child fails atomically.
export function validateWorkMailBatchV1PendingDecision({ transaction, items } = {}) {
  const invalid = reasonCode => ({ applicable: true, valid: false, reasonCode });
  const rows = (Array.isArray(items) ? items : []).filter(item => item?.protocol === "pwt1");
  if (!rows.some(item => (item?.transferVersion === "mailbatch1" || item?.amountVersion === "mailbatch1" ||
      String(item?.payload ?? "").startsWith("pwt1:mailbatch1:")) &&
      (item?.valid === true || item?.rawCandidate === false))) {
    return { applicable: false, valid: true, reasonCode: "" };
  }
  const parents = rows.filter(item => item?.kind === "token-transfer-batch" && item?.valid === true);
  if (parents.length !== 1) return invalid("work-mail-batch-v1-pending-parent-set-invalid");
  const parent = parents[0];
  const authority = validateWorkMailBatchV1RawTransaction({ transaction,
    protocolVout: parent.protocolVout, recordOrdinal: parent.recordOrdinal });
  if (!authority.valid) return invalid(authority.reasonCode);
  const { parsed, senderAddress } = authority;
  const mailItems = (Array.isArray(items) ? items : []).filter(item => item?.protocol === "pwm1");
  const mailRecord = canonicalRawProtocolRecordSetFromTransaction(transaction).records.find(row => row.protocol === "pwm1");
  if (mailItems.length > 1 || mailItems.some(item => item.valid !== true || item.kind !== authority.mailEnvelope.kind ||
      item.txid !== transaction.txid || item.protocolVout !== mailRecord.protocolVout || item.recordOrdinal !== 0 ||
      item.payload !== mailRecord.message)) return invalid("work-mail-batch-v1-pending-mail-binding-invalid");
  const record = canonicalRawProtocolRecordSetFromTransaction(transaction).records.find(row => row.protocolVout === parent.protocolVout);
  const commitment = workAmoV5CanonicalPayloadCommitment({ payload: record.message });
  const sameCommitment = value => value?.model === commitment.model && value?.sha256 === commitment.sha256 &&
    value?.payloadBytes === commitment.payloadBytes;
  const common = item => item?.confirmed === false && item?.status === "pending" && item?.valid === true &&
    item?.network === "livenet" && item?.protocol === "pwt1" && item?.tokenId === parsed.tokenId &&
    item?.txid === transaction.txid && item?.senderAddress === senderAddress &&
    item?.amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL &&
    item?.amountVersion === "mailbatch1" && item?.transferVersion === "mailbatch1" &&
    item?.protocolVout === record.protocolVout && item?.payload === record.message &&
    sameCommitment(item.batchPayloadCommitment) &&
    JSON.stringify(item.mailEnvelope) === JSON.stringify(authority.mailEnvelope) && item.parentTransitionChainCommitmentAfter === undefined;
  if (rows.length !== parsed.recipientCount + 1 || !common(parent) || parent.recordOrdinal !== record.recordOrdinal ||
      parent.amountSubatoms !== parsed.totalAmountSubatoms || parent.totalAmountSubatoms !== parsed.totalAmountSubatoms ||
      parent.recipientCount !== parsed.recipientCount || parent.batchRegistryPaymentSats !== WORK_MAIL_BATCH_MUTATION_PAYMENT_PROOFS ||
      parent.paidSats !== WORK_MAIL_BATCH_MUTATION_PAYMENT_PROOFS || !Array.isArray(parent.recipients) ||
      parent.recipients.length !== parsed.recipientCount || parent.recipients.some((recipient, index) =>
        recipient.recipientAddress !== parsed.recipients[index].recipientAddress ||
        recipient.amountSubatoms !== parsed.recipients[index].amountSubatoms)) {
    return invalid("work-mail-batch-v1-pending-parent-binding-invalid");
  }
  const seen = new Set();
  for (const child of rows.filter(item => item !== parent)) {
    const index = child?.batchRecipientIndex;
    if (!Number.isSafeInteger(index) || index < 0 || index >= parsed.recipientCount || seen.has(index) || !common(child) ||
        child.kind !== "token-transfer" || child.rawCandidate !== false || child.economicDelta !== false ||
        child.claimsEconomicOutputs !== false || child.chargesTransactionFee !== false || child.paidSats !== 0 ||
        child.registryMutationFeeSats !== 0 || child.minerFeeSats !== 0 || child.dataBytes !== 0 ||
        child.batchRegistryPaymentSats !== undefined || child.batchRecipientCount !== parsed.recipientCount ||
        child.batchTotalAmountSubatoms !== parsed.totalAmountSubatoms ||
        child.recordOrdinal !== record.recordOrdinal + 1 + index ||
        child.containerPosition?.protocolVout !== record.protocolVout ||
        child.containerPosition?.recordOrdinal !== record.recordOrdinal ||
        child.recipientAddress !== parsed.recipients[index].recipientAddress ||
        child.amountSubatoms !== parsed.recipients[index].amountSubatoms ||
        child.derivedId !== `${transaction.txid}:${record.protocolVout}:${record.recordOrdinal}:${index}`) {
      return invalid("work-mail-batch-v1-pending-child-binding-invalid");
    }
    seen.add(index);
  }
  return { applicable: true, valid: true, reasonCode: "", parsed };
}
