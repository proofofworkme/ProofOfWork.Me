import { validateWorkMailBatchV1RawTransaction } from "../../server/work-mail-batch-transaction.mjs";
import { workAmoV5CanonicalPayloadCommitment } from "../../server/work-amo-v5.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "../../server/canonical-op-return.mjs";
import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import { createOwnerOutputCommitmentFixture, signOwnerOutputCommitmentPsbt } from "./ownerOutputCommitment.mjs";
import { buildWorkMailBatchPayload, WORK_MAIL_BATCH_REGISTRY_ADDRESS } from "../../src/shared/protocol/workMailBatch.mjs";
export const ACTOR = createOwnerOutputCommitmentFixture().ownerAddress;
export const REGISTRY = WORK_MAIL_BATCH_REGISTRY_ADDRESS;
export const FEE = 47;
export const script = address => bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin);
export const carrier = message => bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(message)]);
export const recipients = (count = 2, amount = "50000001") => Array.from({ length: count }, (_, index) => ({
  recipientAddress: bitcoin.payments.p2wpkh({ hash: createHash("sha256").update(`work-mail-batch:${index}`).digest().subarray(0, 20) }).address,
  amountSubatoms: amount,
}));
export function hydrated(transaction, prevouts = []) {
  return { txid: transaction.getId(), hex: transaction.toHex(),
    vin: transaction.ins.map((input, index) => bitcoin.Transaction.isCoinbaseHash(input.hash)
      ? { coinbase: Buffer.from(input.script).toString("hex") }
      : { txid: Buffer.from(input.hash).reverse().toString("hex"), vout: input.index,
          scriptsig: Buffer.from(input.script).toString("hex"), sequence: input.sequence, prevout: prevouts[index] }),
    vout: transaction.outs.map(output => ({ scriptpubkey: Buffer.from(output.script).toString("hex"), value: output.value.toString() })) };
}
export function transaction({ vector = recipients(), payments = vector.map(row => ({ address: row.recipientAddress, value: 546 })),
  message = buildWorkMailBatchPayload(vector), mail = ["pwm1:m:Hello"], fee = 546,
  extraOutputs = [], hashType = 1, transform = outputs => outputs } = {}) {
  const funding = new bitcoin.Transaction();
  funding.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from("00", "hex"));
  funding.addOutput(script(ACTOR), 1_000_000n);
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: funding.getId(), index: 0, nonWitnessUtxo: funding.toBuffer(), sequence: 0xfffffffd });
  const outputs = transform([
    ...payments.map(payment => ({ script: script(payment.address), value: BigInt(payment.value) })),
    ...mail.map(text => ({ script: carrier(text), value: 0n })),
    { script: script(REGISTRY), value: BigInt(fee) },
    { script: carrier(message), value: 0n }, ...extraOutputs.map(output => ({ ...output, value: BigInt(output.value ?? 0) })),
  ]);
  const spent = outputs.reduce((sum, output) => sum + output.value, 0n);
  outputs.push({ script: script(ACTOR), value: 1_000_000n - spent - BigInt(FEE) });
  outputs.forEach(output => psbt.addOutput(output));
  const signed = bitcoin.Psbt.fromHex(signOwnerOutputCommitmentPsbt(psbt.toHex(), { hashType })).extractTransaction();
  const result = hydrated(signed, [{ scriptpubkey: Buffer.from(script(ACTOR)).toString("hex"), value: "1000000" }]);
  result.feeSats = String(FEE);
  return result;
}
export function batchVout(tx) { return tx.vout.findIndex(output => Buffer.from(output.scriptpubkey, "hex").includes(Buffer.from("pwt1:mailbatch1:"))); }

export function pendingDecisionFixture() {
  const tx = transaction(), authority = validateWorkMailBatchV1RawTransaction({ transaction: tx, protocolVout: batchVout(tx) }), record = canonicalRawProtocolRecordSetFromTransaction(tx).records.find(row => row.protocol === "pwt1");
  const { parsed } = authority;
  const common = { confirmed: false, status: "pending", valid: true, network: "livenet", protocol: "pwt1", tokenId: parsed.tokenId,
    txid: tx.txid, senderAddress: ACTOR, amountStorageModel: "work-subatoms-v2", amountVersion: "mailbatch1", transferVersion: "mailbatch1",
    protocolVout: record.protocolVout, payload: record.message, batchPayloadCommitment: workAmoV5CanonicalPayloadCommitment({ payload: record.message }), mailEnvelope: authority.mailEnvelope };
  const parent = { ...common, kind: "token-transfer-batch", recordOrdinal: 0, amountSubatoms: parsed.totalAmountSubatoms,
    totalAmountSubatoms: parsed.totalAmountSubatoms, recipientCount: parsed.recipientCount, batchRegistryPaymentSats: 546, paidSats: 546, recipients: parsed.recipients };
  const children = parsed.recipients.map((recipient, index) => ({ ...common, ...recipient, kind: "token-transfer", rawCandidate: false,
    economicDelta: false, claimsEconomicOutputs: false, chargesTransactionFee: false, paidSats: 0, registryMutationFeeSats: 0, minerFeeSats: 0, dataBytes: 0,
    batchRecipientIndex: index, batchRecipientCount: parsed.recipientCount, batchTotalAmountSubatoms: parsed.totalAmountSubatoms, recordOrdinal: index + 1,
    containerPosition: { protocolVout: record.protocolVout, recordOrdinal: 0 }, derivedId: `${tx.txid}:${record.protocolVout}:0:${index}` }));
  const mail = canonicalRawProtocolRecordSetFromTransaction(tx).records.find(row => row.protocol === "pwm1");
  return { transaction: tx, items: [{ protocol: "pwm1", kind: "mail", valid: true, txid: tx.txid,
    protocolVout: mail.protocolVout, recordOrdinal: 0, payload: mail.message }, parent, ...children] };
}
