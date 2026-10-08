import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';

bitcoin.initEccLib(ecc);

export const OWNER_OUTPUT_COMMITMENT_MODEL = 'owner-signed-all-outputs-v1';
export const OWNER_OUTPUT_COMMITMENT_MAX_TX_BYTES = 1_000_000;
export const OWNER_OUTPUT_COMMITMENT_MAX_INPUTS = 256;
export const OWNER_OUTPUT_COMMITMENT_MAX_OUTPUTS = 1024;
const TXID = /^[0-9a-f]{64}$/u;
const MAX_MONEY = 2_100_000_000_000_000n;
const NETWORKS = { livenet: bitcoin.networks.bitcoin, testnet: bitcoin.networks.testnet, regtest: bitcoin.networks.regtest };
const REASON = 'owner-output-commitment-';
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const hex = bytes => Buffer.from(bytes).toString('hex');

function bytes(value, maxBytes) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxBytes * 2 ||
      value.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(value)) return null;
  return Buffer.from(value, 'hex');
}
function sats(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  if (typeof value === 'string' && (value.length > 16 || !/^(?:0|[1-9][0-9]*)$/u.test(value))) return null;
  if (!['number', 'string', 'bigint'].includes(typeof value)) return null;
  const amount = BigInt(value);
  return amount >= 0n && amount <= MAX_MONEY ? amount : null;
}
function pathForScript(script) {
  const text = hex(script);
  if (/^76a914[0-9a-f]{40}88ac$/u.test(text)) return 'p2pkh';
  if (/^0014[0-9a-f]{40}$/u.test(text)) return 'p2wpkh';
  if (/^a914[0-9a-f]{40}87$/u.test(text)) return 'p2sh-p2wpkh';
  if (/^5120[0-9a-f]{64}$/u.test(text)) return 'p2tr';
  return null;
}
function outputAddress(script, network) {
  // Future witness outputs remain raw diagnostics without library console warnings.
  if (!pathForScript(script) && !/^0020[0-9a-f]{64}$/u.test(hex(script))) return null;
  try { return bitcoin.address.fromOutputScript(script, network); } catch { return null; }
}
function publicKeyValid(key, compressedOnly) {
  return ((key.length === 33 && (key[0] === 2 || key[0] === 3)) ||
    (!compressedOnly && key.length === 65 && key[0] === 4)) && ecc.isPoint(key);
}
function ecdsaStack(input, spendPath, previousScript) {
  let signatureBytes, publicKey, scriptCode;
  if (spendPath === 'p2pkh') {
    const script = input.script, signatureLength = script[0] ?? 0;
    const publicKeyLength = script[signatureLength + 1] ?? 0;
    if (input.witness.length !== 0 || signatureLength < 9 || signatureLength > 73 ||
        ![33, 65].includes(publicKeyLength) || script.length !== signatureLength + publicKeyLength + 2) return null;
    signatureBytes = script.subarray(1, signatureLength + 1);
    publicKey = script.subarray(signatureLength + 2);
    if (!publicKeyValid(publicKey, false) || !same(bitcoin.crypto.hash160(publicKey), previousScript.subarray(3, 23))) return null;
    scriptCode = previousScript;
  } else {
    if (input.witness.length !== 2) return null;
    [signatureBytes, publicKey] = input.witness;
    if (!publicKeyValid(publicKey, true)) return null;
    const keyHash = bitcoin.crypto.hash160(publicKey);
    if (spendPath === 'p2wpkh') {
      if (input.script.length !== 0 || !same(keyHash, previousScript.subarray(2))) return null;
    } else {
      // The scriptSig is exactly the minimal push of the executed WPKH redeem program.
      if (input.script.length !== 23 || input.script[0] !== 22 || input.script[1] !== 0 || input.script[2] !== 20) return null;
      const redeem = input.script.subarray(1);
      if (!same(keyHash, redeem.subarray(2)) || !same(bitcoin.crypto.hash160(redeem), previousScript.subarray(2, 22))) return null;
    }
    scriptCode = bitcoin.payments.p2pkh({ hash: keyHash }).output;
  }
  const decoded = bitcoin.script.signature.decode(signatureBytes);
  return { publicKey, signature: decoded.signature, hashType: decoded.hashType, scriptCode };
}

/**
 * Verify only recognized executed wallet spend paths from the exact raw bytes.
 * The caller must independently obtain the actual spent outputs (for example
 * from Core). Legacy signatures authenticate outpoints/scripts and outputs,
 * but do not themselves authenticate spent-output amounts. This is an ownership
 * and output-commitment proof, not full transaction/UTXO consensus validation.
 * Replay permits verified weak signatures alongside at least one owner ALL
 * signature. A local prepared transaction should require every input ALL/default
 * and disallow ANYONECANPAY through the two policy options below.
 */
export function verifyOwnerOutputCommitment(evidence, options = {}) {
  const result = { valid: false, reason: null, txid: null, inputAddresses: [], outputs: [], commitments: [] };
  const reject = reason => ({ ...result, reason: REASON + reason });
  try {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) return reject('options-invalid');
    const { ownerAddress, network = 'livenet', requireAllInputsCommitted = false, allowAnyoneCanPay = true } = options;
    const chain = typeof network === 'string' && Object.hasOwn(NETWORKS, network) ? NETWORKS[network] : null;
    if (!chain || typeof ownerAddress !== 'string' || !ownerAddress || ownerAddress.length > 128 ||
        typeof requireAllInputsCommitted !== 'boolean' || typeof allowAnyoneCanPay !== 'boolean') return reject('options-invalid');
    let ownerScript;
    try { ownerScript = bitcoin.address.toOutputScript(ownerAddress, chain); }
    catch { return reject('owner-address-invalid'); }
    const spendPath = pathForScript(ownerScript);
    if (!spendPath) return reject('spend-path-unsupported');
    const raw = bytes(evidence?.rawTransactionHex, OWNER_OUTPUT_COMMITMENT_MAX_TX_BYTES);
    if (!raw) return reject('raw-transaction-invalid');
    let tx;
    try { tx = bitcoin.Transaction.fromBuffer(raw); }
    catch { return reject('raw-transaction-invalid'); }
    // A roundtrip rejects nonminimal compact sizes and any alternate wire form.
    if (!same(tx.toBuffer(), raw) || tx.ins.length === 0 || tx.ins.length > OWNER_OUTPUT_COMMITMENT_MAX_INPUTS ||
        tx.outs.length === 0 || tx.outs.length > OWNER_OUTPUT_COMMITMENT_MAX_OUTPUTS) return reject('transaction-invalid');
    result.txid = tx.getId();
    if (evidence.txid !== undefined && (!TXID.test(evidence.txid) || evidence.txid !== result.txid)) return reject('txid-mismatch');
    for (const [vout, output] of tx.outs.entries()) {
      const amount = sats(output.value);
      if (amount === null || output.script.length > 100_000) return reject('output-invalid');
      result.outputs.push({ vout, scriptPubKeyHex: hex(output.script), valueSats: amount.toString(), address: outputAddress(output.script, chain) });
    }
    if (!Array.isArray(evidence.prevouts) || evidence.prevouts.length !== tx.ins.length) return reject('prevouts-unavailable');
    const previousScripts = [], previousValues = [], outpoints = new Set();
    for (const [index, input] of tx.ins.entries()) {
      const prevout = evidence.prevouts[index];
      const fundingTxid = hex(Buffer.from(input.hash).reverse());
      if (bitcoin.Transaction.isCoinbaseHash(input.hash)) return reject('coinbase-input');
      const outpoint = `${fundingTxid}:${input.index}`;
      if (outpoints.has(outpoint)) return reject('duplicate-input');
      outpoints.add(outpoint);
      if (!prevout || !TXID.test(prevout.txid) || !Number.isSafeInteger(prevout.vout) || prevout.vout < 0 ||
          prevout.vout > 0xffffffff || fundingTxid !== prevout.txid || input.index !== prevout.vout) return reject('prevout-mismatch');
      const previousScript = bytes(prevout.scriptPubKeyHex, 10_000), value = sats(prevout.valueSats);
      if (!previousScript || value === null) return reject('prevout-invalid');
      if (!same(previousScript, ownerScript)) return reject('owner-script-mismatch');
      previousScripts.push(previousScript); previousValues.push(value);
      result.inputAddresses.push(outputAddress(previousScript, chain));
    }
    for (const [inputIndex, input] of tx.ins.entries()) {
      let signature, hashType, digest;
      if (spendPath === 'p2tr') {
        if (input.script.length !== 0) return reject('spend-path-unsupported');
        const witness = [...input.witness];
        const annex = witness.length >= 2 && witness.at(-1)[0] === 0x50 ? witness.pop() : undefined;
        if (witness.length !== 1) return reject('spend-path-unsupported');
        const encoded = witness[0];
        if (encoded.length === 64) hashType = 0;
        else if (encoded.length === 65 && [1, 2, 3, 0x81, 0x82, 0x83].includes(encoded[64])) hashType = encoded[64];
        else return reject('signature-invalid');
        signature = encoded.subarray(0, 64);
        // SINGLE without the corresponding output is invalid for Taproot.
        if ((hashType & 3) === 3 && inputIndex >= tx.outs.length) return reject('signature-invalid');
        digest = tx.hashForWitnessV1(inputIndex, previousScripts, previousValues, hashType, undefined, annex);
        if (!ecc.verifySchnorr(digest, previousScripts[inputIndex].subarray(2), signature)) return reject('signature-invalid');
      } else {
        const checked = ecdsaStack(input, spendPath, previousScripts[inputIndex]);
        if (!checked) return reject('spend-path-unsupported');
        hashType = checked.hashType;
        digest = spendPath === 'p2pkh'
          ? tx.hashForSignature(inputIndex, checked.scriptCode, hashType)
          : tx.hashForWitnessV0(inputIndex, checked.scriptCode, previousValues[inputIndex], hashType);
        // High-S ECDSA remains mathematically verifiable for confirmed legacy history.
        if (!ecc.verify(digest, checked.publicKey, checked.signature, false)) return reject('signature-invalid');
      }
      const commitsAllOutputs = hashType === 0 || (hashType & 0x1f) === bitcoin.Transaction.SIGHASH_ALL;
      const anyoneCanPay = (hashType & bitcoin.Transaction.SIGHASH_ANYONECANPAY) !== 0;
      result.commitments.push({ inputIndex, hashType, spendPath, commitsAllOutputs, anyoneCanPay });
      if ((!allowAnyoneCanPay && anyoneCanPay) || (requireAllInputsCommitted && !commitsAllOutputs)) return reject('sighash-policy-invalid');
    }
    if (!result.commitments.some(item => item.commitsAllOutputs)) return reject('all-output-signature-required');
    return { ...result, valid: true };
  } catch { return reject('signature-invalid'); }
}
