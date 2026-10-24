import * as bitcoin from "bitcoinjs-lib";
import {
  parseWorkBatchPayload,
  WORK_BATCH_REGISTRY_ADDRESS,
  WORK_BATCH_MUTATION_PAYMENT_PROOFS,
} from "../src/shared/protocol/workBatch.mjs";
import { verifyOwnerOutputCommitment } from "../src/shared/protocol/ownerOutputCommitment.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "./canonical-op-return.mjs";
import { workAmoV5CanonicalPayloadCommitment } from "./work-amo-v5.mjs";
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

// Shared by confirmed replay and admission. Callers independently authenticate
// the spent outputs and declaration. No supplied address or decoded payload is
// authority: the exact signed bytes bind the scripts, fee and complete carrier.
export function validateWorkBatchV1RawTransaction({ transaction, protocolVout, recordOrdinal = 0 } = {}) {
  let parsed = null;
  const invalid = reasonCode => ({ valid: false, reasonCode, parsed });
  try {
    const records = canonicalRawProtocolRecordSetFromTransaction(transaction).records;
    const record = records.find(row => row.protocolVout === protocolVout && row.recordOrdinal === recordOrdinal);
    parsed = parseWorkBatchPayload(record?.message);
    if (!parsed) return invalid("work-batch-v1-payload-invalid");
    const inputs = transaction?.vin;
    const outputs = transaction?.vout;
    const senderAddress = address(inputs?.[0]?.prevout);
    const registryOutputs = Array.isArray(outputs) ? outputs.flatMap((output, vout) =>
      address(output) === WORK_BATCH_REGISTRY_ADDRESS ? [{
        address: WORK_BATCH_REGISTRY_ADDRESS,
        amountSats: proofs(output),
        scriptPubKeyHex: scriptHex(output),
        vout,
      }] : []) : [];
    const registry = registryOutputs[0];
    if (!senderAddress || !Array.isArray(inputs) || inputs.length === 0 || !Array.isArray(outputs) ||
        records.length !== 1 || record.rawDecodeValid === false || recordOrdinal !== 0 ||
        registryOutputs.length !== 1 || registry.amountSats !== BigInt(WORK_BATCH_MUTATION_PAYMENT_PROOFS) ||
        registry.vout >= protocolVout || outputs.some((output, vout) => {
          if (vout === protocolVout) return !scriptHex(output).startsWith("6a") || proofs(output) !== 0n;
          if (vout === registry.vout) return false;
          return address(output) !== senderAddress || scriptHex(output).startsWith("6a");
        })) return invalid("work-batch-v1-transaction-shape-invalid");
    const ownerCommitment = verifyOwnerOutputCommitment({
      rawTransactionHex: transaction.hex,
      txid: transaction.txid,
      prevouts: inputs.map(input => ({
        txid: input.txid,
        vout: input.vout,
        scriptPubKeyHex: scriptHex(input.prevout),
        valueSats: proofs(input.prevout)?.toString(),
      })),
    }, {
      ownerAddress: senderAddress,
      network: "livenet",
      requireAllInputsCommitted: true,
      allowAnyoneCanPay: false,
    });
    if (!ownerCommitment.valid) return invalid(ownerCommitment.reason);
    if (ownerCommitment.outputs.length !== outputs.length ||
        ownerCommitment.outputs.some((output, index) => output.scriptPubKeyHex !== scriptHex(outputs[index]) ||
          output.valueSats !== proofs(outputs[index])?.toString())) {
      return invalid("work-batch-v1-raw-output-witness-mismatch");
    }
    return {
      valid: true,
      reasonCode: "",
      parsed,
      senderAddress,
      registryPayment: { ...registry, amountSats: WORK_BATCH_MUTATION_PAYMENT_PROOFS,
        outputSats: WORK_BATCH_MUTATION_PAYMENT_PROOFS },
      ownerCommitment,
    };
  } catch {
    return invalid("work-batch-v1-transaction-evidence-invalid");
  }
}

// Pending children are observations of one signed carrier, never independent
// raw records or confirmed transition evidence. Validate the complete set before
// persistence so dropping, duplicating or changing a child fails atomically.
export function validateWorkBatchV1PendingDecision({ transaction, items } = {}) {
  const invalid = reasonCode => ({ applicable: true, valid: false, reasonCode });
  const rows = Array.isArray(items) ? items : [];
  if (!rows.some(item => item?.kind === "token-transfer-batch" && item?.valid === true ||
      item?.transferVersion === "batch1" && item?.rawCandidate === false)) {
    return { applicable: false, valid: true, reasonCode: "" };
  }
  const parents = rows.filter(item => item?.kind === "token-transfer-batch" && item?.valid === true);
  if (parents.length !== 1) return invalid("work-batch-v1-pending-parent-set-invalid");
  const parent = parents[0];
  const authority = validateWorkBatchV1RawTransaction({ transaction,
    protocolVout: parent.protocolVout, recordOrdinal: parent.recordOrdinal });
  if (!authority.valid) return invalid(authority.reasonCode);
  const { parsed, senderAddress } = authority;
  const record = canonicalRawProtocolRecordSetFromTransaction(transaction).records[0];
  const commitment = workAmoV5CanonicalPayloadCommitment({ payload: record.message });
  const sameCommitment = value => value?.model === commitment.model && value?.sha256 === commitment.sha256 &&
    value?.payloadBytes === commitment.payloadBytes;
  const common = item => item?.confirmed === false && item?.status === "pending" && item?.valid === true &&
    item?.network === "livenet" && item?.protocol === "pwt1" && item?.tokenId === parsed.tokenId &&
    item?.txid === transaction.txid && item?.senderAddress === senderAddress &&
    item?.amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL &&
    item?.amountVersion === "batch1" && item?.transferVersion === "batch1" &&
    item?.protocolVout === record.protocolVout && item?.payload === record.message &&
    sameCommitment(item.batchPayloadCommitment) && item.parentTransitionChainCommitmentAfter === undefined;
  if (rows.length !== parsed.recipientCount + 1 || !common(parent) || parent.recordOrdinal !== record.recordOrdinal ||
      parent.amountSubatoms !== parsed.totalAmountSubatoms || parent.totalAmountSubatoms !== parsed.totalAmountSubatoms ||
      parent.recipientCount !== parsed.recipientCount || parent.batchRegistryPaymentSats !== WORK_BATCH_MUTATION_PAYMENT_PROOFS ||
      parent.paidSats !== WORK_BATCH_MUTATION_PAYMENT_PROOFS || !Array.isArray(parent.recipients) ||
      parent.recipients.length !== parsed.recipientCount || parent.recipients.some((recipient, index) =>
        recipient.recipientAddress !== parsed.recipients[index].recipientAddress ||
        recipient.amountSubatoms !== parsed.recipients[index].amountSubatoms)) {
    return invalid("work-batch-v1-pending-parent-binding-invalid");
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
      return invalid("work-batch-v1-pending-child-binding-invalid");
    }
    seen.add(index);
  }
  return { applicable: true, valid: true, reasonCode: "", parsed };
}
