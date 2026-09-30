import * as bitcoin from "bitcoinjs-lib";
import { Buffer } from "buffer";

export type PreparedPaymentReview = {
  inputProofs: string;
  feeProofs: string;
  totalPaymentProofs: string;
  changeProofs: string;
  totalSpendProofs: string;
  outputs: { index: number; address: string; proofs: string; kind: "payment" | "change" | "record" }[];
  inputs: { outpoint: string; proofs: string }[];
  records: string[];
};

/** Evidence is decoded from the PSBT being signed, never from compact display values. */
export function inspectPreparedPayment({ psbtHex, network, paymentCount, registryPaymentCount,
  feeSats, changeSats }: {
  psbtHex: string; network: bitcoin.Network; paymentCount: number;
  registryPaymentCount: number; feeSats: number; changeSats: number;
}): PreparedPaymentReview {
  const psbt = bitcoin.Psbt.fromHex(psbtHex, { network });
  const inputs = psbt.txInputs.map((input, index) => {
    const data = psbt.data.inputs[index];
    const previous = data.nonWitnessUtxo ? bitcoin.Transaction.fromBuffer(data.nonWitnessUtxo) : undefined;
    if (previous && !Buffer.from(previous.getHash()).equals(Buffer.from(input.hash))) {
      throw new Error("Prepared transaction input evidence does not match its outpoint.");
    }
    const prevout = previous?.outs[input.index];
    const value = data.witnessUtxo?.value ?? prevout?.value;
    if (value === undefined || value < 0n ||
      (prevout && data.witnessUtxo && prevout.value !== data.witnessUtxo.value)) {
      throw new Error("Prepared transaction input value is unavailable or inconsistent.");
    }
    return { outpoint: `${Buffer.from(input.hash).reverse().toString("hex")}:${input.index}`, proofs: value.toString() };
  });
  let addressedOutputs = 0;
  const records: string[] = [];
  const outputs = psbt.txOutputs.map((output, index) => {
    if (output.script[0] === bitcoin.opcodes.OP_RETURN) {
      if (output.value !== 0n) throw new Error("Unexpected funded record output.");
      const chunks = bitcoin.script.decompile(output.script);
      if (!chunks || chunks.length !== 2 || typeof chunks[1] === "number") throw new Error("Unexpected record encoding.");
      records.push(Buffer.from(chunks[1]).toString("utf8"));
      return { index, address: "On-chain record", proofs: "0", kind: "record" as const };
    }
    const kind = addressedOutputs++ < paymentCount + registryPaymentCount ? "payment" as const : "change" as const;
    return { index, address: bitcoin.address.fromOutputScript(output.script, network), proofs: output.value.toString(), kind };
  });
  const inputTotal = inputs.reduce((sum, input) => sum + BigInt(input.proofs), 0n);
  const outputTotal = outputs.reduce((sum, output) => sum + BigInt(output.proofs), 0n);
  const fee = inputTotal - outputTotal;
  const change = outputs.filter(output => output.kind === "change").reduce((sum, output) => sum + BigInt(output.proofs), 0n);
  const payment = outputs.filter(output => output.kind === "payment").reduce((sum, output) => sum + BigInt(output.proofs), 0n);
  if (!Number.isSafeInteger(feeSats) || !Number.isSafeInteger(changeSats) ||
    fee < 0n || fee !== BigInt(feeSats) || change !== BigInt(changeSats) ||
    addressedOutputs !== paymentCount + registryPaymentCount + (change > 0n ? 1 : 0)) {
    throw new Error("Prepared transaction costs do not match its funding evidence.");
  }
  return { inputs, outputs, records, inputProofs: inputTotal.toString(), feeProofs: fee.toString(),
    changeProofs: change.toString(), totalPaymentProofs: payment.toString(), totalSpendProofs: (payment + fee).toString() };
}
