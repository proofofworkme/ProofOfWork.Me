import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalQ16SummarySnapshotSqlEligibility as eligibility } from '../server/db/proof-index-reader.mjs';
import { WORK_SUBATOM_PROJECTION_MODEL } from '../server/work-units.mjs';

const source = readFileSync(new URL('../server/db/proof-index-reader.mjs', import.meta.url), 'utf8');
const start = source.indexOf('export async function proofIndexSnapshotPayload(');
const end = source.indexOf('\nexport async function proofIndexValueSummaryPayload(', start);
const body = source.slice(start, end);
const templates = [...body.matchAll(/await pool\.query\(\s*`([\s\S]*?)`/gu)].map(match => match[1]);
const extraction = /\s*-- OFFSET 0[^\n]*\n\s*-- It preserves[^\n]*\n\s*CROSS JOIN LATERAL \(\s*SELECT\s*snapshot\.payload->'workSufficientState' AS "workSufficientState",\s*snapshot\.payload->'summaryPayloads' AS "summaryPayloads",\s*snapshot\.payload->'totals' AS "totals"\s*OFFSET 0\s*\) AS summary_parts/gu;
function beforeExtraction(query) {
  return query.replace(extraction, '')
    .replace(/,\s*summary_parts\."summaryPayloads" AS summary_payloads/gu, '')
    .replaceAll('summary_parts."summaryPayloads"', "payload->'summaryPayloads'")
    .replaceAll('summary_parts."totals"', "payload->'totals'")
    .replaceAll('summary_payloads', "payload->'summaryPayloads'");
}
const legacyTemplates = templates.map(beforeExtraction);
const sqlDigest = sql => createHash('sha256').update(sql.replace(/\s+/gu, ' ').trim()).digest('hex');

test('component extraction preserves the complete primary and fallback SQL contracts', () => {
  assert.equal(templates.length, 2);
  // Pinned before this change: includes every predicate, projection, ordering,
  // and both limits. Only the three field locations and extraction may differ.
  assert.deepEqual(legacyTemplates.map(sqlDigest), [
    '86c17ff80efcb555f9391f8f5a36b56aee4564bda14b2ab500c3952a023cdfa8',
    'b19a0caa22dc925d31fe18c5307bc45bb3166cfdf8a6c26f1b7b9c95db647864',
  ]);
  assert.match(body, /canonicalQ16SummarySnapshotSqlEligibility\("snapshot", "summary_parts"\)/u);
  for (const query of templates) {
    assert.equal([...query.matchAll(/CROSS JOIN LATERAL/gu)].length, 1);
    assert.equal([...query.matchAll(/OFFSET 0/gu)].length, 2); // Comment and barrier.
    assert.doesNotMatch(query, /jsonb_to_record|MATERIALIZED/iu);
  }
  assert.equal(eligibility('snapshot', 'summary_parts').replaceAll(
    'summary_parts."workSufficientState"', "snapshot.payload->'workSufficientState'",
  ), eligibility('snapshot'));
});

const database = process.env.POW_SUMMARY_SQL_TEST_DATABASE;
const postgresTest = database ? test : test.skip;
function psql(sql) {
  assert.match(database, /^[a-z_][a-z0-9_]*$/u);
  return JSON.parse(execFileSync('psql', ['-X', '-q', '-At', '-d', database, '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN READ ONLY; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='1s'; ${sql}; COMMIT;`,
    encoding: 'utf8', maxBuffer: 1_048_576, timeout: 20_000,
  }).trim());
}
function query(template, key = 'marketplaceSummary', legacy = false) {
  return template.replace('${latestSummaryEligibility}', () => eligibility('snapshot', legacy ? '' : 'summary_parts'))
    .replace('${SUMMARY_SNAPSHOT_LOOKBACK_LIMIT}', '5000')
    .replaceAll('$1', "'livenet'").replaceAll('$2', `'${key}'`)
    .replaceAll('$3', `'${WORK_SUBATOM_PROJECTION_MODEL}'`);
}
function rowDigest(sql) {
  return `SELECT jsonb_agg(jsonb_build_object('id', snapshot_id, 'height', indexed_through_block,
    'bytes', octet_length(summary_payload::text), 'digest', md5(summary_payload::text))) FROM (${sql}) selected`;
}

postgresTest('PostgreSQL preserves malformed-shape rejection and older eligible selection', { timeout: 180_000 }, t => {
  // These are read-only CTE fixtures based on one authenticated current row.
  // They write no tables, never return source payloads, and retain the real
  // canonical block/transition witness joins in both versions of the selector.
  const seedQuery = query(legacyTemplates[0], 'marketplaceSummary', true);
  const seed = `SELECT network, snapshot_id, generated_at, indexed_through_block, consistency, payload, source_hashes
    FROM proof_indexer.ledger_snapshots WHERE network='livenet'
      AND snapshot_id=(SELECT snapshot_id FROM (${seedQuery}) authenticated)`;
  const mutations = [
    ['valid-newer', 'payload', 'newer'],
    ['null-root', "'null'::jsonb"], ['array-root', "'[]'::jsonb"],
    ['unknown-root-key', "payload || '{\"unexpected\":true}'::jsonb"],
    ['missing-state', "payload - 'workSufficientState'"],
    ['null-state', "jsonb_set(payload,'{workSufficientState}','null')"],
    ['array-state', "jsonb_set(payload,'{workSufficientState}','[]')"],
    ['scalar-state', "jsonb_set(payload,'{workSufficientState}','7')"],
    ['unknown-state-key', "jsonb_set(payload,'{workSufficientState,unexpected}','true')"],
    ['wrong-state-witness', "jsonb_set(payload,'{workSufficientState,indexedThroughBlockHash}',to_jsonb(repeat('f',64)))"],
    ['bad-commitment', "jsonb_set(payload,'{workSufficientState,tokenStateCommitment}','{}')"],
    ['null-components', "jsonb_set(payload,'{summaryPayloads}','null')"],
    ['array-components', "jsonb_set(payload,'{summaryPayloads}','[]')"],
    ['missing-component', "payload #- '{summaryPayloads,workSummary}'"],
    ['scalar-floor', "jsonb_set(payload,'{summaryPayloads,workFloor}','7')"],
    ['array-actual-value', "jsonb_set(payload,'{summaryPayloads,workFloor,actualValue}','[]')"],
    ['null-totals', "jsonb_set(payload,'{totals}','null')"],
    ['mismatched-q8', "jsonb_set(payload,'{totals,workNetworkValueQ8}','\"1\"')"],
  ];
  for (const [label, payload, expected = 'original'] of mutations) {
    const fixtures = `WITH seed AS MATERIALIZED (${seed}), fixture AS (
      SELECT network, 'original'::text AS snapshot_id, generated_at, indexed_through_block, consistency, payload, source_hashes FROM seed
      UNION ALL SELECT network, 'newer'::text, generated_at + interval '1 second', indexed_through_block,
        consistency, ${payload}, source_hashes FROM seed)`;
    for (let index = 0; index < 2; index++) {
      const before = query(legacyTemplates[index], 'marketplaceSummary', true).replace('proof_indexer.ledger_snapshots snapshot', 'fixture snapshot');
      const after = query(templates[index]).replace('proof_indexer.ledger_snapshots snapshot', 'fixture snapshot');
      const result = psql(`${fixtures} SELECT jsonb_build_object('before', (${rowDigest(before)}), 'after', (${rowDigest(after)}))`);
      assert.deepEqual(result.after, result.before, `${label}, selector ${index}`);
      assert.equal(result.after?.[0]?.id, expected, `${label}, selector ${index}`);
    }
  }
  t.diagnostic(`${mutations.length} adversarial/order cases matched across both selectors; no payloads persisted.`);
});

postgresTest('PostgreSQL extracts one latest candidate without spill and preserves both components', { timeout: 60_000 }, t => {
  for (const key of ['marketplaceSummary', 'workSummary']) {
    const before = query(legacyTemplates[0], key, true);
    const after = query(templates[0], key);
    const results = psql(`SELECT jsonb_build_object('before', (${rowDigest(before)}), 'after', (${rowDigest(after)}))`);
    assert.deepEqual(results.after, results.before, key);
    assert.equal(results.after?.length, 1, 'An authenticated current fixture is required.');
    const original = psql(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${before}`)[0];
    const optimized = psql(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${after}`)[0];
    const nodes = plan => [plan, ...(plan.Plans ?? []).flatMap(nodes)];
    const extractionNodes = nodes(optimized.Plan).filter(node => node['Node Type'] === 'Subquery Scan');
    assert.equal(extractionNodes.length, 1);
    assert.equal(extractionNodes[0]['Actual Loops'], 1);
    assert.equal(extractionNodes[0]['Actual Rows'], 1);
    assert.equal(optimized.Plan['Temp Read Blocks'], 0);
    assert.equal(optimized.Plan['Temp Written Blocks'], 0);
    t.diagnostic(JSON.stringify({ key, beforeMs: original['Execution Time'], afterMs: optimized['Execution Time'],
      beforeHitBlocks: original.Plan['Shared Hit Blocks'], afterHitBlocks: optimized.Plan['Shared Hit Blocks'], tempBlocks: 0 }));
  }
});
