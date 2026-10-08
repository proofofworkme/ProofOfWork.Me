import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import {
  verifyOwnerOutputCommitment, OWNER_OUTPUT_COMMITMENT_MODEL,
  OWNER_OUTPUT_COMMITMENT_MAX_TX_BYTES, OWNER_OUTPUT_COMMITMENT_MAX_INPUTS,
  OWNER_OUTPUT_COMMITMENT_MAX_OUTPUTS,
} from './ownerOutputCommitment.mjs';
import { createOwnerOutputCommitmentFixture as fixture, signOwnerOutputCommitmentPsbt } from '../../../tests/fixtures/ownerOutputCommitment.mjs';

const PATHS = ['p2pkh', 'p2wpkh', 'p2sh-p2wpkh', 'p2tr'];
const keyHex = { p2pkh: '11', p2wpkh: '12', 'p2sh-p2wpkh': '13', p2tr: '14' };
const reason = value => 'owner-output-commitment-' + value;
const check = (f, options = {}) => verifyOwnerOutputCommitment(f.transactionEvidence, { ownerAddress: f.ownerAddress, ...options });
const strict = f => check(f, { requireAllInputsCommitted: true, allowAnyoneCanPay: false });
function changed(f, change, { pin = true } = {}) {
  const copy = structuredClone(f), tx = bitcoin.Transaction.fromHex(copy.transactionEvidence.rawTransactionHex);
  change(tx, copy.transactionEvidence);
  copy.transactionEvidence.rawTransactionHex = tx.toHex();
  if (pin) copy.transactionEvidence.txid = tx.getId();
  return copy;
}
function alterCarrier(tx) {
  tx.outs[1].script = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from('pwdns1:subpage1:altered')]);
}
function rejection(f, expected, options) {
  const actual = check(f, options);
  assert.equal(actual.valid, false);
  if (expected) assert.equal(actual.reason, reason(expected));
  return actual;
}

test('model and deterministic synthetic fixture bind actual output diagnostics', () => {
  assert.equal(OWNER_OUTPUT_COMMITMENT_MODEL, 'owner-signed-all-outputs-v1');
  const first = fixture({ number: 7, payload: 'carrier', selfPaymentSats: '25000', extraPayloads: ['additional'] });
  const second = fixture({ number: 8, payload: 'carrier' });
  assert.equal(first.ownerAddress, second.ownerAddress);
  assert.notEqual(first.txid, second.txid);
  assert.ok(BigInt(first.transactionEvidence.prevouts[0].valueSats) >= 26000n);
  const actual = strict(first);
  assert.equal(actual.valid, true);
  assert.equal(actual.reason, null);
  assert.equal(actual.txid, first.txid);
  assert.deepEqual(actual.outputs, first.outputs);
  assert.deepEqual(actual.inputAddresses, first.inputAddresses);
  assert.equal(actual.outputs[2].address, null);
});

for (const spendPath of PATHS) {
  test(`${spendPath}: exact ALL/default signatures pass strict local policy`, () => {
    const f = fixture({ spendPath, hashTypes: [spendPath === 'p2tr' ? 0 : 1, 1] });
    const actual = strict(f);
    assert.equal(actual.valid, true);
    assert.deepEqual(actual.outputs, f.outputs);
    assert.equal(actual.commitments.length, 2);
    for (const item of actual.commitments) {
      assert.equal(item.spendPath, spendPath);
      assert.equal(item.commitsAllOutputs, true);
      assert.equal(item.anyoneCanPay, false);
    }
  });
  for (const hashType of [2, 3]) {
    test(`${spendPath}: ${hashType === 2 ? 'NONE' : 'SINGLE'} does not prove carrier commitment, before or after carrier replacement`, () => {
      const f = fixture({ spendPath, hashTypes: [hashType] });
      for (const candidate of [f, changed(f, alterCarrier)]) {
        const actual = rejection(candidate, 'all-output-signature-required');
        // The executed weak signature remains cryptographically valid; the carrier proof fails.
        assert.deepEqual(actual.commitments.map(row => row.hashType), [hashType]);
        assert.equal(actual.commitments[0].commitsAllOutputs, false);
      }
      rejection(f, 'sighash-policy-invalid', { requireAllInputsCommitted: true });
    });
  }
  test(`${spendPath}: ALL|ANYONECANPAY binds all outputs for replay and fails strict local policy`, () => {
    const f = fixture({ spendPath, hashTypes: [0x81] });
    assert.equal(check(f).valid, true);
    assert.equal(check(f).commitments[0].anyoneCanPay, true);
    assert.equal(strict(f).reason, reason('sighash-policy-invalid'));
    rejection(changed(f, alterCarrier), 'signature-invalid');
  });
  test(`${spendPath}: strong and weak owner inputs replay only with an intact ALL signature`, () => {
    const f = fixture({ spendPath, hashTypes: [1, 2, 3], extraPayloads: ['third output'] });
    assert.equal(check(f).valid, true);
    assert.equal(strict(f).reason, reason('sighash-policy-invalid'));
    rejection(changed(f, alterCarrier), 'signature-invalid');
    rejection(changed(f, tx => { tx.outs[0].value += 1n; }), 'signature-invalid');
    rejection(changed(f, tx => { tx.ins[1].sequence -= 1; }), 'signature-invalid');
    rejection(changed(f, tx => { tx.locktime = 1; }), 'signature-invalid');
  });
  test(`${spendPath}: changed ordered outpoint evidence and foreign owner scripts are rejected`, () => {
    const f = fixture({ spendPath, hashTypes: [1, 1] });
    const wrongOwner = fixture({ spendPath: spendPath === 'p2pkh' ? 'p2wpkh' : 'p2pkh' });
    rejection(f, 'owner-script-mismatch', { ownerAddress: wrongOwner.ownerAddress });
    const swapped = structuredClone(f); swapped.transactionEvidence.prevouts.reverse();
    rejection(swapped, 'prevout-mismatch');
    const wrongVout = structuredClone(f); wrongVout.transactionEvidence.prevouts[0].vout += 1;
    rejection(wrongVout, 'prevout-mismatch');
    const wrongTxid = structuredClone(f); wrongTxid.transactionEvidence.prevouts[0].txid = '01'.repeat(32);
    rejection(wrongTxid, 'prevout-mismatch');
    const wrongScript = structuredClone(f); wrongScript.transactionEvidence.prevouts[1].scriptPubKeyHex = wrongOwner.transactionEvidence.prevouts[0].scriptPubKeyHex;
    rejection(wrongScript, 'owner-script-mismatch');
    const repointed = changed(f, (tx, evidence) => {
      tx.ins[0].hash = Buffer.alloc(32, 1); evidence.prevouts[0].txid = '01'.repeat(32);
    });
    rejection(repointed, 'signature-invalid');
  });
  test(`${spendPath}: altered signatures and extra executed stack items fail closed`, () => {
    const f = fixture({ spendPath });
    const signatureMutation = changed(f, tx => {
      const stack = spendPath === 'p2pkh' ? tx.ins[0].script : tx.ins[0].witness[0];
      stack[spendPath === 'p2pkh' ? 10 : 9] ^= 1;
    });
    rejection(signatureMutation);
    const extraItem = changed(f, tx => {
      if (spendPath === 'p2pkh') tx.ins[0].script = Buffer.concat([tx.ins[0].script, Buffer.from([bitcoin.opcodes.OP_TRUE])]);
      else tx.ins[0].witness.push(Buffer.from([1]));
    });
    rejection(extraItem, 'spend-path-unsupported');
  });
}

for (const spendPath of ['p2wpkh', 'p2sh-p2wpkh', 'p2tr']) {
  test(`${spendPath}: witness and independently hydrated amount mutations are authenticated`, () => {
    const f = fixture({ spendPath });
    const wrongAmount = structuredClone(f); wrongAmount.transactionEvidence.prevouts[0].valueSats = '20001';
    rejection(wrongAmount, 'signature-invalid');
    const witnessOnly = changed(f, tx => { tx.ins[0].witness[0][8] ^= 1; });
    assert.equal(witnessOnly.transactionEvidence.txid, f.txid);
    rejection(witnessOnly, 'signature-invalid');
  });
}

test('legacy amount must be independently hydrated; signature proof makes no amount authentication claim', () => {
  const f = fixture({ spendPath: 'p2pkh' });
  const independentAmount = structuredClone(f); independentAmount.transactionEvidence.prevouts[0].valueSats = '20001';
  assert.equal(check(independentAmount).valid, true);
});

test('standard owner paths support livenet, testnet and regtest addresses without cross-network acceptance', () => {
  for (const network of ['livenet', 'testnet', 'regtest']) {
    const f = fixture({ spendPath: 'p2wpkh', network });
    assert.equal(check(f, { network }).valid, true);
    if (network !== 'livenet') rejection(f, 'owner-address-invalid');
  }
});

test('P2PKH requires exact minimal pushes and an actual public key matching the spent script', () => {
  const f = fixture({ spendPath: 'p2pkh' });
  rejection(changed(f, tx => { tx.ins[0].script = Buffer.concat([Buffer.from([bitcoin.opcodes.OP_PUSHDATA1]), tx.ins[0].script]); }), 'spend-path-unsupported');
  rejection(changed(f, tx => { tx.ins[0].witness = [Buffer.from([1])]; }), 'spend-path-unsupported');
  rejection(changed(f, tx => { tx.ins[0].script[tx.ins[0].script.length - 1] ^= 1; }), 'spend-path-unsupported');
  const highS = changed(f, tx => {
    const stack = bitcoin.script.decompile(tx.ins[0].script), decoded = bitcoin.script.signature.decode(stack[0]);
    const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt('0x' + Buffer.from(decoded.signature.subarray(32)).toString('hex'));
    const signature = Buffer.concat([Buffer.from(decoded.signature.subarray(0, 32)), Buffer.from((order - s).toString(16).padStart(64, '0'), 'hex')]);
    tx.ins[0].script = bitcoin.script.compile([bitcoin.script.signature.encode(signature, decoded.hashType), stack[1]]);
  });
  assert.equal(check(highS).valid, true, 'confirmed legacy high-S signatures are mathematically valid');
});

test('P2WPKH and nested SH-WPKH require exactly the executed redeem path', () => {
  const native = fixture({ spendPath: 'p2wpkh' }), nested = fixture({ spendPath: 'p2sh-p2wpkh' });
  rejection(changed(native, tx => { tx.ins[0].script = Buffer.from([0]); }), 'spend-path-unsupported');
  rejection(changed(nested, tx => { tx.ins[0].script[tx.ins[0].script.length - 1] ^= 1; }), 'spend-path-unsupported');
  rejection(changed(nested, tx => { tx.ins[0].script = Buffer.concat([Buffer.from([bitcoin.opcodes.OP_PUSHDATA1]), tx.ins[0].script]); }), 'spend-path-unsupported');
  const uncompressed = changed(native, tx => { tx.ins[0].witness[1] = ecc.pointFromScalar(Buffer.from(keyHex.p2wpkh.repeat(32), 'hex'), false); });
  rejection(uncompressed, 'spend-path-unsupported');
});

test('Taproot default, explicit ALL and authenticated annex pass; explicit DEFAULT and script path fail closed', () => {
  for (const hashTypes of [[0], [1]]) assert.equal(strict(fixture({ spendPath: 'p2tr', hashTypes })).valid, true);
  const annex = fixture({ spendPath: 'p2tr', annex: Buffer.from([0x50, 0x12, 0x34]) });
  assert.equal(strict(annex).valid, true);
  rejection(changed(annex, tx => { tx.ins[0].witness[1][1] ^= 1; }), 'signature-invalid');
  rejection(changed(annex, tx => { tx.ins[0].witness.pop(); }), 'signature-invalid');
  const f = fixture({ spendPath: 'p2tr' });
  rejection(changed(f, tx => { tx.ins[0].witness[0] = Buffer.concat([tx.ins[0].witness[0], Buffer.from([0])]); }), 'signature-invalid');
  rejection(changed(f, tx => { tx.ins[0].witness[0] = Buffer.concat([tx.ins[0].witness[0], Buffer.from([4])]); }), 'signature-invalid');
  rejection(changed(f, tx => { tx.ins[0].script = Buffer.from([0]); }), 'spend-path-unsupported');
  rejection(changed(f, tx => { tx.ins[0].witness.push(Buffer.from([bitcoin.opcodes.OP_TRUE]), Buffer.alloc(33, 0xc0)); }), 'spend-path-unsupported');
  const single = fixture({ spendPath: 'p2tr', hashTypes: [2, 2, 3], extraPayloads: ['third output'] });
  rejection(changed(single, tx => { tx.outs.pop(); }), 'signature-invalid');
});

test('unsupported owner script paths cannot be promoted to wallet key-path proofs', () => {
  const ownerAddress = bitcoin.payments.p2wsh({ redeem: { output: bitcoin.script.compile([bitcoin.opcodes.OP_TRUE]) } }).address;
  rejection(fixture(), 'spend-path-unsupported', { ownerAddress });
  const native = fixture({ spendPath: 'p2wpkh' });
  const fakeNested = bitcoin.payments.p2sh({ redeem: { output: bitcoin.script.compile([bitcoin.opcodes.OP_TRUE]) } });
  native.ownerAddress = fakeNested.address;
  native.transactionEvidence.prevouts[0].scriptPubKeyHex = Buffer.from(fakeNested.output).toString('hex');
  rejection(native, 'spend-path-unsupported');
});

test('raw txid pin, ordered evidence, malformed amounts, coinbase and duplicate inputs are mandatory', () => {
  const f = fixture({ hashTypes: [1, 1] });
  const wrongId = structuredClone(f); wrongId.transactionEvidence.txid = '01'.repeat(32);
  rejection(wrongId, 'txid-mismatch');
  const badId = structuredClone(f); badId.transactionEvidence.txid = 3;
  rejection(badId, 'txid-mismatch');
  for (const prevouts of [undefined, null, [], [f.transactionEvidence.prevouts[0]]]) {
    const candidate = structuredClone(f); candidate.transactionEvidence.prevouts = prevouts;
    rejection(candidate, 'prevouts-unavailable');
  }
  for (const amount of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, '01', ' 20000', '2e4', 2100000000000001n, {}, null]) {
    const candidate = structuredClone(f); candidate.transactionEvidence.prevouts[0].valueSats = amount;
    rejection(candidate, 'prevout-invalid');
  }
  for (const amount of [20000, '20000', 20000n]) {
    const candidate = structuredClone(f); candidate.transactionEvidence.prevouts[0].valueSats = amount;
    assert.equal(check(candidate).valid, true);
  }
  rejection(changed(f, tx => { tx.ins[0].hash = Buffer.alloc(32); }), 'coinbase-input');
  rejection(changed(f, tx => { tx.ins[1].hash = tx.ins[0].hash; tx.ins[1].index = tx.ins[0].index; }), 'duplicate-input');
  const missingPin = structuredClone(f); delete missingPin.transactionEvidence.txid;
  assert.equal(check(missingPin).valid, true);
});

test('alternate wire forms, trailing bytes, malformed options and invalid bounds fail closed without throwing', () => {
  const f = fixture();
  for (const raw of [null, 3, '', '01xz', '0', '00'.repeat(OWNER_OUTPUT_COMMITMENT_MAX_TX_BYTES + 1), f.transactionEvidence.rawTransactionHex + '00']) {
    const candidate = structuredClone(f); candidate.transactionEvidence.rawTransactionHex = raw;
    rejection(candidate, 'raw-transaction-invalid');
  }
  const nonminimal = structuredClone(f), raw = f.transactionEvidence.rawTransactionHex;
  nonminimal.transactionEvidence.rawTransactionHex = raw.slice(0, 8) + 'fd0100' + raw.slice(10);
  rejection(nonminimal, 'transaction-invalid');
  for (const options of [null, [], 'bad', { ownerAddress: f.ownerAddress, network: 'constructor' }, { ownerAddress: f.ownerAddress, network: {} },
    { ownerAddress: f.ownerAddress, requireAllInputsCommitted: 'yes' }, { ownerAddress: f.ownerAddress, allowAnyoneCanPay: 1 }]) {
    assert.equal(verifyOwnerOutputCommitment(f.transactionEvidence, options).reason, reason('options-invalid'));
  }
  rejection(f, 'owner-address-invalid', { ownerAddress: 'invalid' });
  const tooManyInputs = new bitcoin.Transaction(); tooManyInputs.version = 2;
  for (let index = 0; index <= OWNER_OUTPUT_COMMITMENT_MAX_INPUTS; index += 1) tooManyInputs.addInput(Buffer.alloc(32, 1), index);
  tooManyInputs.addOutput(Buffer.from(f.outputs[0].scriptPubKeyHex, 'hex'), 546n);
  const inputCap = structuredClone(f); inputCap.transactionEvidence.rawTransactionHex = tooManyInputs.toHex();
  rejection(inputCap, 'transaction-invalid');
  rejection(changed(f, tx => { while (tx.outs.length <= OWNER_OUTPUT_COMMITMENT_MAX_OUTPUTS) tx.addOutput(Buffer.from([bitcoin.opcodes.OP_RETURN]), 0n); }), 'transaction-invalid');
  rejection(changed(f, tx => { tx.outs.length = 0; }), 'transaction-invalid');
  rejection(changed(f, tx => { tx.outs[0].value = 2100000000000001n; }), 'output-invalid');
  rejection(changed(f, tx => { tx.outs[1].script = Buffer.alloc(100001); }), 'output-invalid');
});


test('P2PKH uncompressed SEC public keys are verified against their exact owner script', () => {
  const f = fixture(), tx = bitcoin.Transaction.fromHex(f.transactionEvidence.rawTransactionHex);
  const key = Buffer.from(keyHex.p2pkh.repeat(32), 'hex'), pubkey = ecc.pointFromScalar(key, false);
  const payment = bitcoin.payments.p2pkh({ pubkey });
  f.ownerAddress = payment.address;
  f.transactionEvidence.prevouts[0].scriptPubKeyHex = Buffer.from(payment.output).toString('hex');
  tx.outs[0].script = payment.output;
  const digest = tx.hashForSignature(0, payment.output, 1);
  tx.ins[0].script = bitcoin.script.compile([bitcoin.script.signature.encode(ecc.sign(digest, key), 1), pubkey]);
  f.transactionEvidence.rawTransactionHex = tx.toHex(); f.transactionEvidence.txid = tx.getId();
  assert.equal(strict(f).valid, true);
});


for (const spendPath of PATHS) {
  test(`${spendPath}: wallet fixture signs the actual prepared PSBT without changing transaction intent`, () => {
    const f = fixture({ spendPath }), script = Buffer.from(f.transactionEvidence.prevouts[0].scriptPubKeyHex, 'hex');
    const funding = new bitcoin.Transaction(); funding.addInput(Buffer.alloc(32, 7), 1); funding.addOutput(script, 20000n);
    const psbt = new bitcoin.Psbt(), input = { hash: funding.getId(), index: 0, sequence: 0xfffffffd, sighashType: 1 };
    if (spendPath === 'p2pkh') input.nonWitnessUtxo = funding.toBuffer();
    else input.witnessUtxo = { script, value: 20000n };
    if (spendPath === 'p2sh-p2wpkh') input.redeemScript = bitcoin.Transaction.fromHex(f.transactionEvidence.rawTransactionHex).ins[0].script.subarray(1);
    psbt.addInput(input);
    for (const output of f.outputs) psbt.addOutput({ script: Buffer.from(output.scriptPubKeyHex, 'hex'), value: BigInt(output.valueSats) });
    for (const hashType of [1, 2, 3, 0x81, ...(spendPath === 'p2tr' ? [0] : [])]) {
      const signed = bitcoin.Psbt.fromHex(signOwnerOutputCommitmentPsbt(psbt.toHex(), { spendPath, hashType })).extractTransaction();
      assert.equal(signed.ins.length, 1); assert.equal(signed.ins[0].index, input.index);
      assert.equal(signed.ins[0].sequence, input.sequence);
      assert.equal(Buffer.from(signed.ins[0].hash).reverse().toString('hex'), funding.getId());
      assert.equal(signed.version, psbt.version); assert.equal(signed.locktime, psbt.locktime);
      assert.deepEqual(signed.outs.map(out => ({ script: Buffer.from(out.script).toString('hex'), value: out.value.toString() })),
        psbt.txOutputs.map(out => ({ script: Buffer.from(out.script).toString('hex'), value: out.value.toString() })));
      const actual = verifyOwnerOutputCommitment({ rawTransactionHex: signed.toHex(), prevouts: [
        { txid: funding.getId(), vout: 0, scriptPubKeyHex: script.toString('hex'), valueSats: '20000' },
      ] }, { ownerAddress: f.ownerAddress, requireAllInputsCommitted: true, allowAnyoneCanPay: false });
      assert.equal(actual.valid, [0, 1].includes(hashType));
      if (!actual.valid) assert.equal(actual.reason, reason('sighash-policy-invalid'));
    }
  });
}
