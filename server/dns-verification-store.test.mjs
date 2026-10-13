import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDnsVerificationStore } from './dns-verification-store.mjs';
import { createDnsPageLinkDiscovery } from './dns-page-link-discovery.mjs';
import { createDnsSubdomainDiscovery } from './dns-subdomain-discovery.mjs';
import { workAmoV5CanonicalPayloadCommitment as commit } from './work-amo-v5.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blockHash = (height, fork = '') => hash([height, fork]);
async function fixture(t, lane = 'root-pages') {
  const directory = await mkdtemp(path.join(tmpdir(), 'dns-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = lane === 'subdomains';
  const model = `dns-${child ? 'subdomain' : 'page-link'}-block-witness-chain-v1`;
  let time = 0, slow = false, forkAt = Infinity, coreReads = [], from = [], hold;
  const canonicalHash = h => blockHash(h, h >= forkAt ? 'fork' : '');
  const rows = () => [10, 11, 12].map(height => ({ height, block_hash: canonicalHash(height),
    previous_block_hash: canonicalHash(height - 1), raw_protocol_candidate_count: 0, protocol_record_count: 0,
    payload: { replayRecords: [], replayDescriptorCommitment: commit([]),
      blockDescriptorCommitment: commit({ height, hash: canonicalHash(height) }), rawProtocolCandidateCount: 0 } }));
  const store = options => createDnsVerificationStore({ directory, lane, model, ...options });
  const discover = options => (child ? createDnsSubdomainDiscovery : createDnsPageLinkDiscovery)({
    store: store(options), now: () => time, readBudgetMs: 25,
    readCoreHash: async h => canonicalHash(h),
    async readCoreBlock(row) {
      coreReads.push(row.height); if (hold) await hold;
      if (slow) time += 26;
      return { descriptor: row.payload.blockDescriptorCommitment, rawProtocolCandidateCount: 0, rawRecords: [],
        [child ? 'childEvents' : 'pageLinkEvents']: [{ txid: hash(row.height), blockHeight: row.height, payload: 'exact evidence' }] };
    },
    async readIndex(network, opts) {
      from.push(opts.fromHeight ?? 10);
      let witness = hash([model, network, 10]);
      for (const row of rows().filter(row => row.height <= opts.expectedHeight)) {
        witness = hash([witness, row.height, row.block_hash, row.payload.blockDescriptorCommitment, row.payload.replayDescriptorCommitment]);
        if (row.height >= (opts.fromHeight ?? 10)) await opts.onBlock(row);
      }
      return { complete: true, activationHeight: 10, indexedThroughBlock: opts.expectedHeight,
        checkpointHash: canonicalHash(opts.expectedHeight), blockCount: opts.expectedHeight - 9, witnessSha256: witness };
    }, hydratePending: async () => [],
  });
  return { directory, model, store, discover, checkpoint: (height = 12) => ({ height, blockHash: canonicalHash(height) }),
    reads: () => coreReads, from: () => from, slow: value => { slow = value; }, fork: height => { forkAt = height; }, hold: value => { hold = value; } };
}
for (const lane of ['root-pages', 'child-pages', 'subdomains']) test(`${lane}: restart resumes durable partial progress and preserves exact events`, async t => {
  const f = await fixture(t, lane); f.slow(true);
  await assert.rejects(f.discover()('livenet', f.checkpoint(), 10), /read budget/);
  assert.deepEqual(f.reads(), [10]);
  f.slow(false);
  const result = await f.discover()('livenet', f.checkpoint(), 10);
  assert.equal(result.coverage.complete, true); assert.deepEqual(f.reads(), [10, 11, 12]);
  const restored = await f.discover()('livenet', f.checkpoint(), 10);
  assert.deepEqual(restored.events, result.events); assert.deepEqual(f.reads(), [10, 11, 12]);
  assert.deepEqual(f.from(), [10, 11, 13]);
});
test('restart plus reorg replays only the fork tail', async t => {
  const f = await fixture(t); await f.discover()('livenet', f.checkpoint(), 10);
  f.fork(12); const result = await f.discover()('livenet', f.checkpoint(), 10);
  assert.equal(result.coverage.complete, true); assert.deepEqual(f.reads(), [10, 11, 12, 12]);
  await f.discover()('livenet', f.checkpoint(), 10); assert.deepEqual(f.reads(), [10, 11, 12, 12]);
});
test('advancing tip and backwards request cannot corrupt the durable prefix', async t => {
  const f = await fixture(t); const d = f.discover();
  await d('livenet', f.checkpoint(11), 10);
  const results = await Promise.all([d('livenet', f.checkpoint(12), 10), d('livenet', f.checkpoint(10), 10)]);
  assert.ok(results.every(r => r.coverage.complete));
  await f.discover()('livenet', f.checkpoint(12), 10);
  assert.deepEqual(f.reads(), [10, 11, 12]);
});
test('interrupted atomic write leaves last durable prefix recoverable', async t => {
  const f = await fixture(t);
  await f.discover()('livenet', f.checkpoint(10), 10);
  const d = f.discover({ beforeRename: async () => { throw new Error('crash before rename'); } });
  await assert.rejects(d('livenet', f.checkpoint(), 10), /crash before rename/);
  assert.equal(d.progress('livenet', 10).verifiedThroughBlock, 10);
  await f.discover()('livenet', f.checkpoint(), 10);
  assert.deepEqual(f.reads(), [10, 11, 11, 12]);
});
test('tampered events cannot be admitted even with a new unkeyed checksum', async t => {
  const f = await fixture(t); await f.discover()('livenet', f.checkpoint(), 10);
  const file = path.join(f.directory, 'root-pages-livenet-10.json');
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  const payload = JSON.parse(envelope.payload); payload.blocks[0].events[0].payload = 'forged';
  envelope.payload = JSON.stringify(payload); envelope.mac = hash(envelope.payload);
  await writeFile(file, JSON.stringify(envelope));
  await assert.rejects(f.discover()('livenet', f.checkpoint(), 10), /authentication failed/);
});
test('missing key, incompatible verifier and unsafe file permissions fail closed', async t => {
  const f = await fixture(t); await f.discover()('livenet', f.checkpoint(), 10);
  await assert.rejects(f.discover({ verifierVersion: 2 })('livenet', f.checkpoint(), 10), /version differs/);
  const file = path.join(f.directory, 'root-pages-livenet-10.json');
  await chmod(file, 0o644);
  await assert.rejects(f.discover()('livenet', f.checkpoint(), 10), /unsafe checkpoint/);
  await chmod(file, 0o600); await rm(path.join(f.directory, 'authentication.key'));
  await assert.rejects(f.discover()('livenet', f.checkpoint(), 10), /key is missing/);
});
test('symlink receipt is never followed', async t => {
  const f = await fixture(t); await f.discover()('livenet', f.checkpoint(), 10);
  const file = path.join(f.directory, 'root-pages-livenet-10.json');
  await rm(file); await symlink('/etc/passwd', file);
  await assert.rejects(f.discover()('livenet', f.checkpoint(), 10));
});
