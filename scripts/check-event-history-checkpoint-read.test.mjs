import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalQ16SummarySnapshotSqlEligibility as eligibility } from '../server/db/proof-index-reader.mjs';
import { WORK_SUBATOM_PROJECTION_MODEL } from '../server/work-units.mjs';

const source = readFileSync(new URL('../server/db/proof-index-reader.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function strictEventHistoryLedgerSnapshot(');
const body = source.slice(start, source.indexOf('\nasync function ledgerSnapshotMetadata(', start));
const queryTemplate = body.match(/await pool\.query\(\s*`([\s\S]*?)`/u)?.[1];
assert.ok(queryTemplate, 'The actual event-history checkpoint query is required.');
const extraction = /\s*-- Keep full SQL eligibility[^\n]*\n\s*-- return only[^\n]*\n\s*CROSS JOIN LATERAL \(\s*SELECT snapshot\.payload->'workSufficientState' AS "workSufficientState"\s*OFFSET 0\s*\) AS history_parts/u;
const projection = /jsonb_build_object\(\s*'indexedThroughBlockHash', snapshot\.payload->'indexedThroughBlockHash',\s*'summaryRefresh', jsonb_build_object\(\s*'indexedThroughBlockHash',\s*snapshot\.payload->'summaryRefresh'->'indexedThroughBlockHash'\s*\)\s*\) AS payload/u;

test('event-history checkpoint extraction preserves the full witness predicate', () => {
  const extracted = eligibility('snapshot', 'history_parts');
  assert.equal(extracted.replaceAll('history_parts."workSufficientState"', "snapshot.payload->'workSufficientState'"), eligibility('snapshot'));
  assert.match(queryTemplate, extraction);
  assert.match(queryTemplate, projection);
});

const pgTest = process.env.POW_EVENT_HISTORY_CHECKPOINT_PG_TESTS === '1' ? test : test.skip;
function sql(legacy = false, pinned = false) {
  let value = queryTemplate;
  if (legacy) value = value.replace(extraction, '').replace(projection, 'snapshot.payload');
  return value.replace('${precisionEligibility}', () => eligibility('snapshot', legacy ? '' : 'history_parts'))
    .replaceAll('$1', "'livenet'").replaceAll('$2', `'${WORK_SUBATOM_PROJECTION_MODEL}'`)
    .replaceAll('$3', pinned ? "'original'" : 'NULL');
}
function psql(query) {
  return JSON.parse(execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=90000' },
  }).trim());
}
function checkpoint(query) {
  return `SELECT jsonb_agg(jsonb_build_object('id', snapshot_id, 'height', indexed_through_block,
    'time', generated_at, 'hash', payload->'indexedThroughBlockHash',
    'refreshHash', payload->'summaryRefresh'->'indexedThroughBlockHash')) FROM (${query}) selected`;
}

pgTest('PostgreSQL retains checkpoint selection and malformed witness rejection without shipping summary bodies', { timeout: 900_000 }, t => {
  const seed = `SELECT network, snapshot_id, generated_at, indexed_through_block, consistency, payload, source_hashes
    FROM proof_indexer.ledger_snapshots WHERE network='livenet'
      AND snapshot_id=(SELECT snapshot_id FROM (${sql()}) authenticated)`;
  const mutations = [
    ['valid', 'payload', 'newer'],
    ['unknown-root', "payload || '{\"unexpected\":true}'::jsonb"],
    ['missing-witness', "payload - 'workSufficientState'"],
    ['array-witness', "jsonb_set(payload,'{workSufficientState}','[]')"],
    ['wrong-witness', "jsonb_set(payload,'{workSufficientState,indexedThroughBlockHash}',to_jsonb(repeat('f',64)))"],
    ['wrong-checkpoint', "jsonb_set(payload,'{indexedThroughBlockHash}',to_jsonb(repeat('f',64)))"],
    ['missing-summary', "payload - 'summaryPayloads'"],
  ];
  for (const [label, mutation, expected = 'original'] of mutations) {
    const fixture = `WITH seed AS MATERIALIZED (${seed}), fixture AS (
      SELECT network, 'original'::text AS snapshot_id, generated_at, indexed_through_block, consistency,
        jsonb_set(payload,'{snapshotId}','\"original\"') AS payload, source_hashes FROM seed
      UNION ALL SELECT network, 'newer'::text, generated_at + interval '1 second', indexed_through_block,
        consistency, jsonb_set(${mutation},'{snapshotId}','\"newer\"'), source_hashes FROM seed)`;
    for (const pinned of [false, true]) {
      const before = sql(true, pinned).replaceAll('proof_indexer.ledger_snapshots snapshot', 'fixture snapshot');
      const after = sql(false, pinned).replaceAll('proof_indexer.ledger_snapshots snapshot', 'fixture snapshot');
      const result = psql(`${fixture} SELECT jsonb_build_object('before', (${checkpoint(before)}), 'after', (${checkpoint(after)}))`);
      assert.deepEqual(result.after, result.before, `${label}, pinned=${pinned}`);
      assert.equal(result.after?.[0]?.id, pinned ? 'original' : expected, `${label}, pinned=${pinned}`);
    }
  }
  const size = psql(`SELECT jsonb_build_object('bytes', octet_length(payload::text),
    'keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(payload) k)) FROM (${sql()}) selected`);
  assert.ok(size.bytes < 1024, 'History checkpoint metadata must remain bounded.');
  assert.deepEqual(size.keys.sort(), ['indexedThroughBlockHash', 'summaryRefresh']);
  t.diagnostic(`${mutations.length} cases, pinned and unpinned, preserved selection; checkpoint payload ${size.bytes} bytes.`);
});
