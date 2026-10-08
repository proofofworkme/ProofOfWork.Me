/** Invented deterministic signing fixtures only. Never use these keys for funds. */
import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
bitcoin.initEccLib(ecc);
const KEYS = {
  p2pkh: Buffer.from('11'.repeat(32), 'hex'), p2wpkh: Buffer.from('12'.repeat(32), 'hex'),
  'p2sh-p2wpkh': Buffer.from('13'.repeat(32), 'hex'), p2tr: Buffer.from('14'.repeat(32), 'hex'),
};
const NETWORKS = { livenet: bitcoin.networks.bitcoin, testnet: bitcoin.networks.testnet, regtest: bitcoin.networks.regtest };
export function createOwnerOutputCommitmentFixture({
  payload = 'pwdns1:subpage1:fixture', number = 1, spendPath = 'p2pkh', hashTypes,
  network = 'livenet', selfPaymentSats = 546, extraPayloads = [], annex,
} = {}) {
  if (!Number.isSafeInteger(number) || number < 0 || !KEYS[spendPath] || !NETWORKS[network]) throw new Error('Invalid synthetic fixture options');
  const key = KEYS[spendPath], pubkey = ecc.pointFromScalar(key, true), chain = NETWORKS[network];
  const payment = spendPath === 'p2pkh' ? bitcoin.payments.p2pkh({ pubkey, network: chain })
    : spendPath === 'p2wpkh' ? bitcoin.payments.p2wpkh({ pubkey, network: chain })
    : spendPath === 'p2sh-p2wpkh' ? bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network: chain }), network: chain })
    : bitcoin.payments.p2tr({ pubkey: pubkey.subarray(1), network: chain });
  const types = hashTypes ?? [spendPath === 'p2tr' ? 0 : 1];
  const paymentSats = BigInt(selfPaymentSats), fundingSats = paymentSats + 1000n > 20000n ? paymentSats + 1000n : 20000n;
  const tx = new bitcoin.Transaction(); tx.version = 2;
  const prevouts = types.map((_, index) => {
    const txid = Buffer.from(bitcoin.crypto.sha256(Buffer.from(`ProofOfWork.Me/synthetic-owner-output/${number}/${index}/${spendPath}`, 'utf8'))).toString('hex');
    tx.addInput(Buffer.from(txid, 'hex').reverse(), index, 0xfffffffd);
    return { txid, vout: index, scriptPubKeyHex: Buffer.from(payment.output).toString('hex'), valueSats: fundingSats.toString() };
  });
  tx.addOutput(payment.output, paymentSats);
  tx.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(payload, 'utf8')]), 0n);
  for (const additionalPayload of extraPayloads) tx.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(additionalPayload, 'utf8')]), 0n);
  for (const [index, hashType] of types.entries()) {
    if (spendPath === 'p2tr') {
      const annexBytes = annex === undefined ? undefined : Buffer.from(annex);
      const digest = tx.hashForWitnessV1(index, prevouts.map(row => Buffer.from(row.scriptPubKeyHex, 'hex')), prevouts.map(row => BigInt(row.valueSats)), hashType, undefined, annexBytes);
      const signature = Buffer.from(ecc.signSchnorr(digest, key, Buffer.alloc(32)));
      tx.setWitness(index, [hashType === 0 ? signature : Buffer.concat([signature, Buffer.from([hashType])]), ...(annexBytes ? [annexBytes] : [])]);
    } else {
      const code = spendPath === 'p2pkh' ? payment.output : bitcoin.payments.p2pkh({ pubkey }).output;
      const digest = spendPath === 'p2pkh' ? tx.hashForSignature(index, code, hashType) : tx.hashForWitnessV0(index, code, BigInt(prevouts[index].valueSats), hashType);
      const signature = bitcoin.script.signature.encode(ecc.sign(digest, key), hashType);
      if (spendPath === 'p2pkh') tx.setInputScript(index, bitcoin.script.compile([signature, pubkey]));
      else {
        tx.setWitness(index, [signature, pubkey]);
        if (spendPath === 'p2sh-p2wpkh') tx.setInputScript(index, bitcoin.script.compile([payment.redeem.output]));
      }
    }
  }
  const txid = tx.getId(), ownerAddress = payment.address;
  return { ownerAddress, transactionEvidence: { txid, rawTransactionHex: tx.toHex(), prevouts }, txid,
    inputAddresses: prevouts.map(() => ownerAddress),
    outputs: tx.outs.map((out, vout) => ({ vout, scriptPubKeyHex: Buffer.from(out.script).toString('hex'), valueSats: out.value.toString(), address: vout === 0 ? ownerAddress : null })) };
}

/** Test-only wallet callback: the key is invented, and no input/output intent is changed. */
export function signOwnerOutputCommitmentPsbt(psbtHex, { spendPath = 'p2pkh', hashType = 1 } = {}) {
  if (!Object.hasOwn(KEYS, spendPath)) throw new Error('Unsupported synthetic fixture spend path');
  const key = KEYS[spendPath], publicKey = ecc.pointFromScalar(key, true);
  const psbt = bitcoin.Psbt.fromHex(psbtHex);
  const signer = { publicKey, sign: hash => ecc.sign(hash, key),
    signSchnorr: hash => ecc.signSchnorr(hash, key, Buffer.alloc(32)) };
  const unsigned = bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
  const previousOutputs = psbt.data.inputs.map((input, index) => input.witnessUtxo ??
    (input.nonWitnessUtxo ? bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo).outs[psbt.txInputs[index].index] : undefined));
  for (let index = 0; index < psbt.inputCount; index += 1) {
    // Intentionally model a wallet choosing a weak flag despite an ALL request.
    psbt.data.inputs[index].sighashType = hashType;
    if (spendPath === 'p2tr') {
      // Fixtures use a direct invented output key, not a claimed BIP86 internal key.
      if (!previousOutputs[index] || !Buffer.from(previousOutputs[index].script).equals(
        Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.from(publicKey.subarray(1))]))) {
        throw new Error('Prepared PSBT is not funded by the synthetic Taproot output key');
      }
      const digest = unsigned.hashForWitnessV1(index, previousOutputs.map(row => row.script),
        previousOutputs.map(row => row.value), hashType);
      const signature = Buffer.from(signer.signSchnorr(digest));
      psbt.updateInput(index, { tapKeySig: hashType === 0 ? signature : Buffer.concat([signature, Buffer.from([hashType])]) });
    } else psbt.signInput(index, signer, [hashType]);
  }
  psbt.finalizeAllInputs();
  return psbt.toHex();
}
