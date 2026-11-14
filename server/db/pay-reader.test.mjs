import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAY_ACTIVATION_HEIGHT, PAY_ACTIVATION_PREVIOUS_BLOCK_HASH } from '../../src/shared/protocol/pay.mjs';
import { readPaySnapshot, readPayMailEvidence, readPayWorkSettlementEvidence } from './pay-reader.mjs';
import { PAY_DISCOVERY_MODEL, PAY_DISCOVERY_EMPTY_SHA256, advancePayCandidateDigest, payInvoicesPayload } from '../pay.mjs';
import { payFixture, paidFixtures, workAmount, hashForHeight, invoiceMetadata } from '../pay-test-fixtures.mjs';

function rowFor(tx) {
  return { txid: tx.txid, status: tx.status.confirmed ? 'confirmed' : 'pending', block_height: tx.status.block_height,
    block_hash: tx.status.block_hash, block_index: tx.blockTransactionIndex, block_time: tx.timestamp,
    raw_tx: { ...tx, canonicalBlockScan: { height: tx.status.block_height, blockHash: tx.status.block_hash, blockIndex: tx.blockTransactionIndex } },
    outputs: tx.vout.map((output, vout) => ({ vout, value_sats: output.value, scriptpubkey: output.scriptpubkey })) };
}
function fixture(transactions = paidFixtures(), { marker: changes = {}, native = false, mutateRow, mutateMail, mutateWork } = {}) {
  const confirmed = transactions.filter(tx => tx.status.confirmed), checkpoint = confirmed.at(-1)?.status ??
    { block_height: PAY_ACTIVATION_HEIGHT - 1, block_hash: PAY_ACTIVATION_PREVIOUS_BLOCK_HASH };
  const marker = { model: PAY_DISCOVERY_MODEL, network: 'livenet', fromHeight: PAY_ACTIVATION_HEIGHT, complete: true,
    indexedThroughBlock: checkpoint.block_height, indexedThroughBlockHash: checkpoint.block_hash,
    candidateCount: confirmed.length, candidateSha256: confirmed.reduce(advancePayCandidateDigest, PAY_DISCOVERY_EMPTY_SHA256), ...changes };
  const rows = transactions.map(rowFor), queries = [];
  rows.forEach(row => mutateRow?.(row));
  const client = { async query(sql, args) {
    queries.push(sql);
    if (sql.includes('SELECT value FROM')) return { rows: [{ value: marker }] };
    if (sql.includes('SELECT height,block_hash')) return { rows: [...new Set([marker.indexedThroughBlock, ...args[1]])].map(height =>
      ({ height, block_hash: height === PAY_ACTIVATION_HEIGHT - 1 ? PAY_ACTIVATION_PREVIOUS_BLOCK_HASH : hashForHeight(height) })) };
    if (sql.includes('count(*)::text')) return { rows: [{ count: String(confirmed.length) }] };
    if (sql.includes('SELECT t.*')) return { rows };
    if (sql.includes('_transition_storage_accessor')) return { rows: [{ present: native }] };
    if (sql.includes('pay_canonical_mail_closure')) return { rows: confirmed.flatMap(tx => tx._payMailEvidence.rows.map(row => {
      const copy = structuredClone({ ...row, transition: tx._payMailEvidence.transition }); mutateMail?.(copy); return copy;
    })) };
    if (sql.includes('jobs_canonical_work_settlement')) return { rows: confirmed.flatMap(tx => tx._payWorkSettlementEvidence ?? []).map(row => {
      const copy = structuredClone(row); mutateWork?.(copy); return copy;
    }) };
    throw new Error(`Unexpected read: ${sql}`);
  } };
  const verifyCheckpoint = async height => height === PAY_ACTIVATION_HEIGHT - 1 ? PAY_ACTIVATION_PREVIOUS_BLOCK_HASH : hashForHeight(height);
  return { client, marker, rows, queries, verifyCheckpoint };
}

test('complete raw discovery and signatures reconstruct paid invoices from existing tables', async () => {
  const f = fixture(), state = await readPaySnapshot(f.client, 'livenet', new URLSearchParams(), f);
  assert.equal(state.invoices[0].status, 'paid'); assert.equal(payInvoicesPayload(state).stats.paidProofs, '1200');
  assert.ok(state.events.every(event => event.ownerSignatureOutputCommitmentVerified));
  assert.ok(f.queries.every(sql => !/INSERT|UPDATE|DELETE|CREATE/u.test(sql)));
});
test('signature hashes use the verified serialized header instead of stale JSON header projections', async () => {
  for (const mutateRow of [row => { delete row.raw_tx.version; delete row.raw_tx.locktime; },
    row => { row.raw_tx.version = 1; row.raw_tx.locktime = 42; }]) {
    const f = fixture(undefined, { mutateRow }), state = await readPaySnapshot(f.client, 'livenet', new URLSearchParams(), f);
    assert.equal(state.invoices[0].status, 'paid');
    assert.ok(state.events.every(event => event.ownerSignatureOutputCommitmentVerified));
  }
});

test('empty pinned parent is authoritative; incomplete or altered corpus is unavailable', async () => {
  const empty = fixture([]), state = await readPaySnapshot(empty.client, 'livenet', new URLSearchParams(), empty);
  assert.equal(state.invoices.length, 0); assert.equal(payInvoicesPayload(state).activation.ready, false);
  for (const marker of [{ complete: false }, { fromHeight: 1 }, { candidateCount: 0 }, { candidateSha256: 'a'.repeat(64) },
    { indexedThroughBlockHash: 'f'.repeat(64) }]) {
    const f = fixture(undefined, { marker });
    await assert.rejects(() => readPaySnapshot(f.client, 'livenet', new URLSearchParams(), f));
  }
  await assert.rejects(() => readPaySnapshot(empty.client, 'testnet', new URLSearchParams(), empty), /activation/);
});

test('all Pay records require raw Mail closure including invalid candidates', async () => {
  for (const mutateMail of [row => { row.transition.payload.replayRecords = []; }, row => { row.raw_payload += 'x'; },
    row => { row.payload._workAmoV5ReplayBound = false; }, row => { row.transition.complete = false; }]) {
    const f = fixture(undefined, { mutateMail });
    await assert.rejects(() => readPaySnapshot(f.client, 'livenet', new URLSearchParams(), f), error => error.details?.code === 'PAY_MAIL_EVIDENCE_UNAVAILABLE');
  }
});

test('native WORK and Mail witnesses are hydrated through the existing audited accessor', async () => {
  for (const native of [false, true]) {
    const f = fixture(paidFixtures(workAmount('1')), { native });
    const state = await readPaySnapshot(f.client, 'livenet', new URLSearchParams(), f);
    assert.equal(state.invoices[0].paidAmount.amountSubatoms, '1');
    for (const sql of f.queries.filter(sql => sql.includes('canonical_mail_closure') || sql.includes('canonical_work_settlement'))) {
      assert.equal(sql.includes('LEFT JOIN LATERAL'), native);
      if (native) assert.match(sql, /read_work_transition_payload_v1/);
    }
  }
});

test('missing or contradictory WORK witnesses never fabricate an unpaid total', async () => {
  for (const mutateWork of [row => { row.transition.payload.traces = []; }, row => { row.payload.workAmoV5ReplayOutput.projection.amountSubatoms = '2'; },
    row => { row.transition.payload.replayRecords = []; }]) {
    const f = fixture(paidFixtures(workAmount('1')), { mutateWork });
    await assert.rejects(() => readPaySnapshot(f.client, 'livenet', new URLSearchParams(), f), error => error.details?.code === 'PAY_WORK_SETTLEMENT_UNAVAILABLE');
  }
});

test('pending evidence is qualified and never included in confirmed state or payment totals', async () => {
  const records = paidFixtures(); records[1].status = { confirmed: false };
  const f = fixture(records), state = await readPaySnapshot(f.client, 'livenet', new URLSearchParams(), f);
  assert.equal(state.invoices[0].status, 'open'); assert.equal(state.pendingEvents.length, 1); assert.equal(state.pendingEvents[0].applied, false);
  assert.equal(payInvoicesPayload(state).pendingComplete, false);
});

test('optional references are independently read, bound to the requested checkpoint and earlier block', async () => {
  const tx = payFixture({ metadata: invoiceMetadata({ reference: 'e'.repeat(64) }) }), f = fixture([tx]);
  await assert.rejects(() => readPaySnapshot(f.client, 'livenet', new URLSearchParams(), f), /reference verification/);
  const state = await readPaySnapshot(f.client, 'livenet', new URLSearchParams(), { ...f, verifyReference: async request => {
    assert.equal(request.checkpointHeight, PAY_ACTIVATION_HEIGHT); assert.equal(request.txid, 'e'.repeat(64));
    return { txid: request.txid, confirmed: true, blockHeight: PAY_ACTIVATION_HEIGHT - 1, blockHash: PAY_ACTIVATION_PREVIOUS_BLOCK_HASH };
  } });
  assert.equal(state.invoices.length, 1);
});
