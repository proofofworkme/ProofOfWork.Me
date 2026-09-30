import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalSealTime } from './canonical-seal-time.mjs';

test('confirmed August seal retains canonical chronology after a September refresh', () => {
  const row = { seal_event_block_time: new Date('2026-08-16T21:37:43Z'),
    seal_transaction_block_time: '2026-08-16T21:37:43Z', updated_at: '2026-09-29T15:44:40.675Z' };
  const payload = { sealAt: '2026-09-29T15:44:40.675Z', createdAt: '2026-08-01T00:00:00Z' };
  assert.equal(canonicalSealTime(row, payload, true), '2026-08-16T21:37:43.000Z');
});
test('legacy confirmed seal uses its confirmed transaction time, never listing or observation time', () => {
  assert.equal(canonicalSealTime({seal_transaction_block_time:'2026-07-01T00:00:00Z'}, {}, true), '2026-07-01T00:00:00.000Z');
  assert.equal(canonicalSealTime({updated_at:'2026-09-29T00:00:00Z'}, {sealAt:'2026-09-29T00:00:00Z'}, true), undefined);
});
test('pending seal keeps explicit observation separate and missing/invalid times stay absent', () => {
  assert.equal(canonicalSealTime({seal_event_block_time:'2026-08-16T21:37:43Z'}, {sealAt:'2026-09-29T00:00:00Z'}, false), '2026-09-29T00:00:00.000Z');
  for (const value of [null, undefined, '', 'invalid']) {
    assert.equal(canonicalSealTime({seal_event_block_time:value}, {}, true), undefined);
  }
});
