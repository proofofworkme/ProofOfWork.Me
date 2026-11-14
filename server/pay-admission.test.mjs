import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as bitcoin from 'bitcoinjs-lib';
import { PAY_ACTIVATION_HEIGHT } from '../src/shared/protocol/pay.mjs';
import { assertPayBroadcastAllowed, payReferenceFromCore, replayPayTransactions } from './pay.mjs';
import { payFixture, issuer, payer, fixtureKeys, fixtureOwner, signPermissionFixture, hashForHeight } from './pay-test-fixtures.mjs';

function funded(action = 'invoice', metadata, { key = fixtureKeys[0], recipient, payment, types } = {}) {
  const owner = fixtureOwner(key), funding = new bitcoin.Transaction();
  funding.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from([1,1])); funding.addOutput(Buffer.from(owner.script,'hex'), 1000000n);
  const tx = payFixture({ action, ...(metadata ? { metadata } : {}), key, ...(recipient ? { recipient } : {}), ...(payment ? { payment } : {}), confirmed: false });
  tx.vin[0].txid = funding.getId(); signPermissionFixture(tx, { keys: [key], types });
  return { tx, funding };
}
function harness({ invoices = [], enabled = true, gateChange = false } = {}) {
  const snapshot = { checkpointHeight: PAY_ACTIVATION_HEIGHT + 1, checkpointHash: hashForHeight(PAY_ACTIVATION_HEIGHT + 1) };
  const gate = { available: true, atTip: true, indexedThroughBlock: snapshot.checkpointHeight, canonicalHash: snapshot.checkpointHash };
  let reads = 0;
  return { enabled: () => enabled, readState: async () => ({ snapshot, invoices }),
    readGate: async () => ({ ...gate, ...(gateChange && ++reads > 1 ? { atTip: false } : {}) }) };
}
test('relay allows only explicitly enabled exact-tip publication with supported signed confirmed inputs', async () => {
  const { tx, funding } = funded();
  const rpc = async (method, args) => {
    assert.equal(method, 'getrawtransaction'); assert.equal(args[0], funding.getId());
    return { ok: true, result: { confirmations: 1, hex: funding.toHex() } };
  };
  await assertPayBroadcastAllowed(tx.hex, 'livenet', { ...harness(), rpc });
  await assert.rejects(() => assertPayBroadcastAllowed(tx.hex, 'livenet', { ...harness({ enabled: false }), rpc }), /not enabled/);
  await assert.rejects(() => assertPayBroadcastAllowed(tx.hex, 'livenet', { ...harness({ gateChange: true }), rpc }), /checkpoint changed/);
  await assert.rejects(() => assertPayBroadcastAllowed(tx.hex, 'livenet', { ...harness(), rpc: async () => ({ ok: true, result: { confirmations: 0 } }) }), /confirmed funding/);
  const weak = funded('invoice', undefined, { types: [bitcoin.Transaction.SIGHASH_NONE] });
  await assert.rejects(() => assertPayBroadcastAllowed(weak.tx.hex, 'livenet', { ...harness(), rpc }), /signature-sighash/);
});

test('relay rechecks immutable invoice destination, amount, open state and issuer authority', async () => {
  const invoice = replayPayTransactions([payFixture()]).invoices[0];
  for (const [amount, status, succeeds] of [['1200','open',true], ['1201','open',false], ['1200','paid',false]]) {
    const f = funded('pay', { v: 1, invoice: invoice.txid }, { key: fixtureKeys[1], recipient: issuer, payment: amount });
    const opts = { ...harness({ invoices: [{ ...invoice, status }] }), rpc: async () => ({ ok: true, result: { confirmations: 1, hex: f.funding.toHex() } }) };
    if (succeeds) await assertPayBroadcastAllowed(f.tx.hex, 'livenet', opts);
    else await assert.rejects(() => assertPayBroadcastAllowed(f.tx.hex, 'livenet', opts));
  }
  const cancel = funded('cancel', { v: 1, invoice: invoice.txid, reason: 'Stop' }, { key: fixtureKeys[1] });
  await assert.rejects(() => assertPayBroadcastAllowed(cancel.tx.hex, 'livenet', { ...harness({ invoices: [invoice] }),
    rpc: async () => ({ ok: true, result: { confirmations: 1, hex: cancel.funding.toHex() } }) }), /issuer/);
});

test('non-Pay relay traffic retains its existing admission path', async () => {
  const wire = new bitcoin.Transaction(); wire.addInput(Buffer.alloc(32), 0); wire.addOutput(Buffer.from('51','hex'), 546n);
  await assertPayBroadcastAllowed(wire.toHex(), 'livenet', { enabled: () => { throw new Error('Unrelated gate reached'); } });
});

test('reference membership requires full-node canonical block and a surviving checkpoint', async () => {
  const { funding } = funded(), checkpointHeight = PAY_ACTIVATION_HEIGHT, checkpointHash = hashForHeight(checkpointHeight), blockHash = hashForHeight(checkpointHeight - 1);
  const request = { txid: funding.getId(), checkpointHeight, checkpointHash };
  const rpc = async (method, args) => {
    if (method === 'getrawtransaction') return { ok: true, result: { hex: funding.toHex(), confirmations: 2, blockhash: blockHash } };
    if (method === 'getblockheader') return { ok: true, result: { hash: blockHash, height: checkpointHeight - 1, confirmations: 2 } };
    if (method === 'getblockhash') return { ok: true, result: args[0] === checkpointHeight ? checkpointHash : blockHash };
    throw new Error(method);
  };
  assert.equal((await payReferenceFromCore(request, rpc)).confirmed, true);
  await assert.rejects(() => payReferenceFromCore(request, async (method, args) => method === 'getblockhash'
    ? { ok: true, result: 'f'.repeat(64) } : rpc(method,args)), /checkpoint changed/);
  await assert.rejects(() => payReferenceFromCore(request, async (method,args) => method === 'getrawtransaction'
    ? { ok: false, error: { code: -5 } } : method === 'getindexinfo' ? { ok: true, result: { txindex: { synced: false } } } : rpc(method,args)), /independently verified/);
});
