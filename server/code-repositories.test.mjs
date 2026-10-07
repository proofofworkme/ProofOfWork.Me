import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { encodeCodeRepository, encodeCodeCommit, CODE_EMPTY_SHA256 } from '../src/shared/protocol/codeRepository.mjs';
import { createCodeSnapshot, codeRepositoriesPayload, codeRepositoryPayload, qualifyCodeLogPayload, exactCodeOutputProofs,
  CODE_DISCOVERY_EMPTY_SHA256, advanceCodeCandidateDigest } from './code-repositories.mjs';

const owner = '1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv', hash = 'b'.repeat(64);
const script = Buffer.from(bitcoin.address.toOutputScript(owner)).toString('hex');
const id = value => value.toString(16).padStart(64, '0');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function op(text) {
  const bytes = Buffer.from(text);
  const push = bytes.length < 76 ? Buffer.from([bytes.length]) : Buffer.from([0x4d, bytes.length & 255, bytes.length >> 8]);
  return { value: 0, scriptpubkey: Buffer.concat([Buffer.from([0x6a]), push, bytes]).toString('hex') };
}
function tx(index, text, carriers = []) {
  return { txid: id(index), status: { confirmed: true, block_height: 7, block_hash: hash }, blockTransactionIndex: index,
    vin: [{ prevout: { scriptpubkey_address: owner, scriptpubkey: script, value: 546 } }],
    vout: [{ value: 546, scriptpubkey_address: owner, scriptpubkey: script }, op('pwm1:m:Code'), ...carriers.map(op), op(text)] };
}
function repo() { return tx(1, encodeCodeRepository({ v: 1, name: 'source', description: 'exact source' })); }
function commit(index, parent, path = 'file.txt', content = '') {
  const bytes = Buffer.from(content), sha256 = digest(bytes);
  const attachment = content ? [`pwm1:a:${Buffer.from('text/plain').toString('base64url')}:${Buffer.from('source.txt').toString('base64url')}:${bytes.length}:${sha256}:0/1:${bytes.toString('base64url')}`] : [];
  return tx(index, encodeCodeCommit({ v: 1, repo: id(1), parent: id(parent), op: 'put', path, message: `commit ${index}`, sha256, size: bytes.length }), attachment);
}
function snapshot(transactions) { return createCodeSnapshot({ network: 'livenet', checkpointHeight: 7, checkpointHash: hash, transactions }); }

test('repository history has no arbitrary ceiling and cursor binds query and revision', () => {
  const transactions = [repo(), ...Array.from({ length: 237 }, (_, offset) => commit(offset + 2, offset + 1))];
  const state = snapshot(transactions);
  const first = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), limit: '200' }));
  assert.equal(first.commits.length, 200);
  assert.equal(first.pagination.total, 238);
  const last = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), limit: '200', cursor: first.pagination.nextCursor }));
  assert.equal(last.commits.length, 38);
  assert.equal(last.pagination.hasMore, false);
  assert.equal(last.snapshot.id, first.snapshot.id);
  assert.throws(() => codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), version: id(2), cursor: first.pagination.nextCursor })), /another query/);
  const list = codeRepositoriesPayload(state);
  assert.deepEqual(list.stats, { repositories: 1, acceptedCommits: 237, unappliedCommits: 0, files: 1 });
});
test('source and historical trees retain exact UTF-8 bytes including BOM and CRLF', () => {
  const content = '\ufefffirst\r\nsecond\n';
  const state = snapshot([repo(), commit(2, 1, 'README.md', content), commit(3, 2, 'README.md', '')]);
  const historical = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), version: id(2), path: 'README.md' }));
  assert.equal(historical.file.content, content);
  assert.equal(Buffer.from(historical.file.contentBase64, 'base64').toString('utf8'), content);
  assert.equal(historical.file.verified, true);
  assert.ok(historical.file.evidence.outputs.some(output => output.prefix === 'pwc1:'));
  const head = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), path: 'README.md' }));
  assert.equal(head.file.size, 0);
  assert.equal(head.file.sha256, CODE_EMPTY_SHA256);
  assert.equal(head.file.contentBase64, '');
  assert.equal(codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), version: id(1), path: 'README.md' })).file, null);
});
test('stale and malformed candidates remain visible while pending never mutates confirmed files', () => {
  const pending = commit(5, 2, 'pending.txt', 'pending'); pending.status = { confirmed: false };
  const state = snapshot([repo(), commit(2, 1), commit(3, 1), tx(4, 'pwc1:commit:broken'), pending]);
  const detail = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1) }));
  assert.equal(detail.repository.headTxid, id(2));
  assert.equal(detail.commits.find(event => event.txid === id(3)).applied, false);
  assert.equal(detail.pendingEvents.length, 1);
  assert.equal(detail.files.some(file => file.path === 'pending.txt'), false);
  assert.equal(codeRepositoriesPayload(state).invalidEvents[0].txid, id(4));
  const qualified = qualifyCodeLogPayload({ items: [{ txid: id(3), protocol: 'pwc1', valid: true }] }, state.events, state.snapshot);
  assert.equal(qualified.items[0].structuralValid, true);
  assert.equal(qualified.items[0].valid, false);
  assert.equal(qualified.items[0].codeAuthority.ready, true);
});
test('discovery commitment binds malformed script candidates and canonical position', () => {
  const malformed = tx(4, 'pwc1:commit:broken');
  const first = advanceCodeCandidateDigest(CODE_DISCOVERY_EMPTY_SHA256, malformed);
  assert.notEqual(first, CODE_DISCOVERY_EMPTY_SHA256);
  assert.notEqual(first, advanceCodeCandidateDigest(CODE_DISCOVERY_EMPTY_SHA256, { ...malformed, blockTransactionIndex: 5 }));
});
test('Code proof conversion handles Core decimals exactly and rejects fractional proofs', () => {
  assert.equal(exactCodeOutputProofs({ value: 0.00000546, scriptPubKey: {} }), '546');
  assert.equal(exactCodeOutputProofs({ value: 1e-8, scriptPubKey: {} }), '1');
  assert.equal(exactCodeOutputProofs({ value: '0.30000000', scriptPubKey: {} }), '30000000');
  assert.equal(exactCodeOutputProofs({ value: 0.1 + 0.2, scriptPubKey: {} }), null);
  assert.equal(exactCodeOutputProofs({ value: 1e-9, scriptPubKey: {} }), null);
  assert.equal(exactCodeOutputProofs({ value: Number.MAX_SAFE_INTEGER + 1 }), null);
});
