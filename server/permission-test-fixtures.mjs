import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { encodePermissionRecord } from '../src/shared/protocol/permissions.mjs';
export const fixtureKeys = [1, 2].map(value => { const key = Buffer.alloc(32); key[31] = value; return key; });
export function fixtureOwner(key = fixtureKeys[0], compressed = true) {
  const publicKey = ecc.pointFromScalar(key, compressed);
  const payment = bitcoin.payments.p2pkh({ pubkey: publicKey });
  return { address: payment.address, script: Buffer.from(payment.output).toString('hex'), publicKey };
}
export const fixturePolicy = { signingEnabled: true, allowedActions: ['mail.send', 'boost.post'], maxTransactionProofs: '5000', dailyLimitProofs: '30000', maxMinerFeeProofs: '1000', allowedRecipients: [], workLimits: null };
export function fixtureCarrier(text) {
  return Buffer.from(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(text)])).toString('hex');
}
export function fixtureRaw(tx) {
  const raw = new bitcoin.Transaction(); raw.version = tx.version; raw.locktime = tx.locktime;
  for (const input of tx.vin) raw.addInput(Buffer.from(input.txid, 'hex').reverse(), input.vout, input.sequence, Buffer.from(input.scriptsig ?? '', 'hex'));
  for (const output of tx.vout) raw.addOutput(Buffer.from(output.scriptpubkey, 'hex'), BigInt(output.value));
  return raw;
}
export function signPermissionFixture(tx, { keys = tx.vin.map(() => fixtureKeys[0]), types = tx.vin.map(() => bitcoin.Transaction.SIGHASH_ALL), compressed = true } = {}) {
  const raw = fixtureRaw(tx);
  tx.vin.forEach((input, index) => {
    const key = keys[index], publicKey = ecc.pointFromScalar(key, compressed);
    const digest = raw.hashForSignature(index, Buffer.from(input.prevout.scriptpubkey, 'hex'), types[index]);
    const signature = bitcoin.script.signature.encode(ecc.sign(digest, key), types[index]);
    const script = bitcoin.script.compile([signature, publicKey]); raw.setInputScript(index, script); input.scriptsig = Buffer.from(script).toString('hex');
  });
  tx.txid = raw.getId(); tx.hex = raw.toHex(); return tx;
}
export function permissionFixture({ nonce = 1, action = 'grant', metadata = {}, policy = fixturePolicy, label = 'Daily Computer', height = 101, hash = 'b'.repeat(64), index = 1, key = fixtureKeys[0], types, inputCount = 1, compressed = true } = {}) {
  const owner = fixtureOwner(key, compressed);
  const body = encodePermissionRecord(action, { v: 1, network: 'livenet', ...(action === 'revoke' ? {} : { label, policy }), ...metadata });
  const tx = { version: 2, locktime: 0, vin: Array.from({length:inputCount}, (_, i) => ({ txid: (BigInt(nonce)+BigInt(i)*1000000n).toString(16).padStart(64,'0'), vout: 0, sequence: 0xfffffffd, scriptsig: '', prevout: { scriptpubkey_address: owner.address, scriptpubkey: owner.script, value: '10000' } })),
    vout: [{ scriptpubkey_address: owner.address, scriptpubkey: owner.script, value: '546' }, { scriptpubkey: fixtureCarrier('pwm1:m:'+body), value:'0' }],
    status:{confirmed:true,block_height:height,block_hash:hash},blockTransactionIndex:index };
  return signPermissionFixture(tx,{keys:tx.vin.map(()=>key),types,compressed});
}
