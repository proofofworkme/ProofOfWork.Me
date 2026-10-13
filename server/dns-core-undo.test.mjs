import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('./proof-api.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function canonicalCoreUndoTransaction(');
const code = source.slice(start, source.indexOf('\nasync function loadCanonicalVerifierContextFromCheckpoint(', start));
const HASH = '11'.repeat(32), PREV = '22'.repeat(32);
const out = { value: 0.00000546, scriptPubKey: { hex: '51', address: 'owner' } };
async function run(useUndo = true, missing = false) {
  const txs = ['other', 'dns-malformed', 'ordinary'].map((kind, i) => ({ txid: String(i + 1).repeat(64), kind,
    vin: [{ txid: PREV, vout: 0, sequence: 1, scriptSig: { hex: '' }, ...(missing ? {} : { prevout: out }) }], vout: [out] }));
  const hydrated = [], rpc = [];
  const context = vm.createContext({ TX_FETCH_CONCURRENCY: 4,
    coreVoutToMempoolVout: output => ({ value: Math.round(output.value * 1e8), scriptpubkey: output.scriptPubKey.hex, scriptpubkey_address: output.scriptPubKey.address }),
    bitcoinRpc: async (method, args) => { rpc.push([method, args]); return { ok: true, result: method === 'getblockhash' ? HASH : method === 'getblockheader' ? '00'.repeat(80) :
      { height: 10, hash: HASH, previousblockhash: PREV, nTx: 3, tx: txs } }; },
    canonicalRawProtocolRecordSetFromTransaction: tx => ({ rawProtocolCandidateCount: tx.kind === 'ordinary' ? 0 : 1, records: [tx.kind] }),
    mapWithConcurrency: async (items, count, fn) => Promise.all(items.map(fn)),
    fetchTransactionFromBitcoinRpc: async txid => { hydrated.push(txid); return { txid, status: { confirmed: true, block_hash: HASH } }; },
    transactionConfirmed: tx => tx.status?.confirmed, transactionTxid: tx => tx.txid, transactionBlockHash: tx => tx.status?.block_hash,
  });
  vm.runInContext(code, context);
  const result = await context.canonicalVerifierCurrentBlock('livenet', 10, PREV, HASH, useUndo);
  return { result, hydrated, txs, rpc, context };
}
test('DNS obtains every protocol prevout through Core undo without per-transaction RPCs', async () => {
  const { result, hydrated, rpc } = await run();
  assert.deepEqual(hydrated, []); assert.equal(rpc[1][1][1], 3);
  assert.equal(result.blockTransactions.length, 3); assert.equal(result.transactions.length, 2);
  for (const tx of result.transactions) {
    assert.equal(tx._powCanonicalRpcHydration, true); assert.equal(tx.vin[0].prevout.value, 546);
    assert.equal(tx.vin[0].prevout.scriptpubkey, '51'); assert.equal(tx.status.block_height, 10);
  }
});
test('missing undo falls back to existing canonical prevout hydration for all protocol carriers', async () => {
  const { hydrated, txs } = await run(true, true);
  assert.deepEqual(hydrated, [txs[0].txid, txs[1].txid]);
});
test('other verifier callers retain verbosity 2 and full transaction hydration', async () => {
  const { hydrated, txs, rpc } = await run(false);
  assert.deepEqual(hydrated, [txs[0].txid, txs[1].txid]); assert.equal(rpc[1][1][1], 2);
});
test('incomplete, malformed and unsafe undo outputs never receive hydration authority', async () => {
  const { context, txs } = await run();
  for (const mutate of [tx => { delete tx.vin[0].prevout; }, tx => { tx.vin[0].prevout.value = null; },
    tx => { tx.vin[0].prevout.scriptPubKey.hex = 'zz'; }, tx => { tx.vout[0].value = -1; },
    tx => { tx.vin[0].prevout.value = 1e20; }, tx => { tx.vin = []; }]) {
    const tx = structuredClone(txs[0]); mutate(tx);
    assert.equal(context.canonicalCoreUndoTransaction(tx, { height: 10, hash: HASH }), null);
  }
});

test('Core undo normalization preserves the exact full-block discovery commitment', async () => {
  const [{ createHash }, bitcoin, raw, work, pages, opreturn] = await Promise.all([
    import('node:crypto'), import('bitcoinjs-lib'), import('./work-amo-v5-raw.mjs'), import('./work-amo-v5.mjs'),
    import('../src/shared/protocol/dnsPages.mjs'), import('./canonical-op-return.mjs'),
  ]);
  const fixture = await readFile(new URL('../scripts/check-dns-page-links-raw.test.mjs', import.meta.url), 'utf8');
  const fixtureContext = vm.createContext({ assert, Buffer, createHash, bitcoin, ...raw, ...work, ...pages, ...opreturn });
  vm.runInContext(fixture.slice(fixture.indexOf('const ACTOR ='), fixture.indexOf('test("page1')), fixtureContext);
  const block = fixtureContext.block([fixtureContext.transaction(['pwdns1:page1:malformed', 'pwm1:m:aGk='])]);
  const { context } = await run();
  const output = value => ({ value: Number(value.value) / 1e8, scriptPubKey: { hex: value.scriptpubkey, address: value.scriptpubkey_address } });
  const normalized = block.blockTransactions.map(tx => {
    const decoded = bitcoin.Transaction.fromHex(tx.hex);
    const core = { ...tx, version: decoded.version, locktime: decoded.locktime,
      vin: tx.vin.map((input, index) => ({ ...input, sequence: decoded.ins[index].sequence,
        scriptSig: { hex: Buffer.from(decoded.ins[index].script).toString('hex') },
        ...(input.prevout ? { prevout: output(input.prevout) } : {}) })), vout: tx.vout.map(output) };
    return context.canonicalCoreUndoTransaction(core, { height: block.blockHeight, hash: block.blockHash });
  });
  const original = raw.workAmoV5RawBlockDiscoveryEnvelope(block);
  const restored = raw.workAmoV5RawBlockDiscoveryEnvelope({ ...block, blockTransactions: normalized });
  assert.deepEqual(restored.blockDescriptorCommitment, original.blockDescriptorCommitment);
  assert.equal(restored.rawProtocolCandidateCount, original.rawProtocolCandidateCount);
});
