import test from 'node:test';
import assert from 'node:assert/strict';
import * as bitcoin from 'bitcoinjs-lib';
import { recoverCandidateDiscoveryReorg } from './candidate-discovery-reorg.mjs';
import { CODE_DISCOVERY_META_KEY, CODE_DISCOVERY_MODEL, CODE_DISCOVERY_EMPTY_SHA256, advanceCodeCandidateDigest } from './code-repositories.mjs';
import { JOBS_DISCOVERY_META_KEY, JOBS_DISCOVERY_MODEL, JOBS_DISCOVERY_EMPTY_SHA256, advanceJobsCandidateDigest } from './jobs.mjs';
import { JOBS_ACTIVATION_HEIGHT } from '../src/shared/protocol/jobs.mjs';

const products = [
  { key: CODE_DISCOVERY_META_KEY, model: CODE_DISCOVERY_MODEL, from: 1, empty: CODE_DISCOVERY_EMPTY_SHA256, digest: advanceCodeCandidateDigest, text: 'pwc1:broken' },
  { key: JOBS_DISCOVERY_META_KEY, model: JOBS_DISCOVERY_MODEL, from: JOBS_ACTIVATION_HEIGHT, empty: JOBS_DISCOVERY_EMPTY_SHA256, digest: advanceJobsCandidateDigest, text: 'pwm1:m:pwj1:broken' },
];
const height = 974399, grandparent = '42'.repeat(32);
function makeBlock(parent, height, payload, nonce) {
  const coinbase = new bitcoin.Transaction();
  coinbase.addInput(Buffer.alloc(32), 0xffffffff, undefined, Buffer.from([1, 1]));
  coinbase.addOutput(Buffer.from('51', 'hex'), 0n);
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, nonce), 0);
  const script = payload ? bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(payload)]) : Buffer.from('51', 'hex');
  tx.addOutput(script, 0n);
  const transactions = [coinbase, tx];
  const block = new bitcoin.Block();
  block.prevHash = Buffer.from(parent, 'hex').reverse(); block.timestamp = 123456; block.bits = 0x1d00ffff; block.nonce = nonce;
  block.transactions = transactions; block.merkleRoot = bitcoin.Block.calculateMerkleRoot(transactions);
  const hash = block.getId();
  function raw(value) {
    return { txid: value.getId(), hex: value.toHex(), vin: value.ins.map(input => ({
      txid: Buffer.from(input.hash).reverse().toString('hex'), vout: input.index, sequence: input.sequence, scriptSig: { hex: Buffer.from(input.script).toString('hex') } })),
    vout: value.outs.map(output => ({ value: 0, scriptPubKey: { hex: Buffer.from(output.script).toString('hex') } })) };
  }
  const candidate = { ...raw(tx), height, _powBlockHash: hash, _powBlockIndex: 1 };
  const row = { network: 'livenet', txid: tx.getId(), status: 'confirmed', block_height: height, block_hash: hash, block_index: 1,
    raw_tx: { ...raw(tx), canonicalBlockScan: { height, blockHash: hash, blockIndex: 1 } },
    outputs: [{ vout: 0, scriptpubkey: Buffer.from(script).toString('hex'), value_sats: '0' }] };
  return { hash, raw: block.toHex(), candidate, row,
    decoded: { hash, previousblockhash: parent, height, nTx: 2, time: 123456, tx: transactions.map(raw) } };
}
function fixture(product, { detachedCandidate = true } = {}) {
  const ancestor = makeBlock(grandparent, height, product.text, 2);
  const orphan = makeBlock(ancestor.hash, height + 1, detachedCandidate ? product.text : null, 3);
  const canonical = makeBlock(ancestor.hash, height + 1, null, 4);
  const prefix = product.digest(product.empty, ancestor.candidate);
  const old = { model: product.model, network: 'livenet', fromHeight: product.from, complete: true, blockedCandidates: [],
    indexedThroughBlock: height+1, indexedThroughBlockHash: orphan.hash, candidateCount: detachedCandidate ? 2 : 1,
    candidateSha256: detachedCandidate ? product.digest(prefix, orphan.candidate) : prefix };
  const f = { old, marker: structuredClone(old), ancestor, orphan, canonical, prefix, rows: [ancestor.row], sql: [], evidence: new Map(),
    committed: 0, rollbacks: 0, cas: true, sameEvidence: true, oldCanonical: false };
  let receipt, next;
  f.client = { async query(sql, p = []) {
    f.sql.push(sql);
    if (sql.startsWith('BEGIN')) return {};
    if (sql === 'COMMIT') {
      if (receipt) f.evidence.set(receipt[0], receipt[1]);
      if (next) f.marker = next;
      receipt = next = undefined; f.committed++; return {};
    }
    if (sql === 'ROLLBACK') { receipt = next = undefined; f.rollbacks++; return {}; }
    if (sql.startsWith('SELECT 1 FROM proof_indexer.meta')) {
      const observed = p[0] === product.key ? f.marker : (f.evidence.get(p[0]) ?? (f.sameEvidence && receipt?.[1]));
      return { rowCount: JSON.stringify(observed) === p[1] ? 1 : 0 };
    }
    if (sql.startsWith('SELECT block_hash')) {
      if (p[1] === height) return { rows: [{ block_hash: ancestor.hash, previous_block_hash: grandparent, canonical: true }] };
      return { rows: [{ block_hash: orphan.hash, previous_block_hash: ancestor.hash, canonical: f.oldCanonical },
        { block_hash: canonical.hash, previous_block_hash: ancestor.hash, canonical: true }] };
    }
    if (sql.startsWith('SELECT t.*')) return { rows: f.rows };
    if (sql.startsWith('INSERT INTO')) { receipt = [p[0], JSON.parse(p[1])]; return {}; }
    if (sql.startsWith('UPDATE')) { next = JSON.parse(p[0]); return { rowCount: f.cas && JSON.stringify(f.marker) === p[2] ? 1 : 0 }; }
    assert.fail(sql);
  } };
  let siblingReads = 0;
  f.rpc = async (method, args) => {
    if (method === 'getblockhash') {
      if (args[0] === height) return ancestor.hash;
      assert.equal(args[0], height+1);
      return f.switchBranch && ++siblingReads > 1 ? 'f'.repeat(64) : canonical.hash;
    }
    assert.deepEqual([method,args[0]], ['getblock', orphan.hash]);
    return args[1] === 0 ? orphan.raw : orphan.decoded;
  };
  f.run = (dryRun = false) => recoverCandidateDiscoveryReorg({ client: f.client, rpc: f.rpc, network: 'livenet', key: product.key, marker: f.old, dryRun });
  return f;
}
for (const product of products) {
  test(product.key + ' qualifies immutable old and new branches without writing', async () => {
    for (const detachedCandidate of [true,false]) {
      const f = fixture(product, { detachedCandidate });
      const result = await f.run(true);
      assert.equal(result.proof.detached[0].hash, f.orphan.hash); assert.equal(result.proof.detached[0].canonicalHash, f.canonical.hash);
      assert.deepEqual(result.proof.ancestor, { height, hash: f.ancestor.hash });
      assert.equal(result.proof.prefixCount, 1); assert.equal(result.proof.prefixSha256, f.prefix);
      assert.equal(f.sql[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      assert.ok(!f.sql.some(sql => /^(INSERT|UPDATE)|FOR SHARE/.test(sql))); assert.deepEqual(f.marker, f.old);
    }
  });
  test(product.key + ' advances once, retries preserve evidence, and stale proposals refuse', async () => {
    const f = fixture(product); const { next, proof } = await f.run();
    assert.deepEqual(f.evidence.get(next.recoveryEvidenceKey), proof); assert.deepEqual(proof.marker, f.old);
    assert.equal(next.complete, true); assert.equal(next.indexedThroughBlockHash, f.ancestor.hash);
    assert.equal(next.candidateCount, 1); assert.equal(next.candidateSha256, f.prefix);
    await assert.rejects(f.run(), /differs from the proposed input/);
    assert.deepEqual(f.marker, next); assert.equal(f.evidence.size, 1);
  });
  test(product.key + ' closes on corpus changes, malformed old bodies, Core changes, conflicting evidence and concurrent updates', async () => {
    for (const mutate of [
      f => { f.rows = []; }, f => { f.old.candidateSha256 = 'f'.repeat(64); f.marker = structuredClone(f.old); },
      f => { f.orphan.raw += '00'; }, f => { f.orphan.decoded.tx[1].vout[0].scriptPubKey.hex = '51'; },
      f => { f.oldCanonical = true; }, f => { f.switchBranch = true; },
      f => { f.sameEvidence = false; }, f => { f.cas = false; },
      f => { f.old.complete = false; f.marker = structuredClone(f.old); },
    ]) {
      const f = fixture(product); mutate(f); const initial = structuredClone(f.marker);
      await assert.rejects(f.run()); assert.deepEqual(f.marker, initial); assert.equal(f.evidence.size, 0); assert.equal(f.rollbacks, 1);
    }
  });
  test(product.key + ' partial bootstrap only drops unresolved candidates physically present on the old branch', async () => {
    const f = fixture(product);
    const lastGood = { ...f.old, indexedThroughBlock: height, indexedThroughBlockHash: f.ancestor.hash, candidateCount: 1, candidateSha256: f.prefix };
    f.old = { ...f.old, complete: false, blockedCandidates: [f.orphan.candidate.txid], lastGood };
    f.marker = structuredClone(f.old);
    assert.equal((await f.run(true)).next.candidateSha256, f.prefix);
    f.old.blockedCandidates = [f.ancestor.candidate.txid]; f.marker = structuredClone(f.old);
    await assert.rejects(f.run(), /unresolved/); assert.equal(f.evidence.size, 0);
  });
}
