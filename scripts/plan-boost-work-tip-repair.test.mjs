import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { planBoostWorkTipRepair, repairSql } from './plan-boost-work-tip-repair.mjs';
const read = async name => JSON.parse(await readFile(new URL(`../tests/fixtures/boost-tip-repair/${name}.json`, import.meta.url)));
const evidenceJson = await readFile(new URL('../tests/fixtures/boost-tip-repair/indexed-evidence.json', import.meta.url), 'utf8');
const evidence = JSON.parse(evidenceJson);
const core = await read('core-transaction');
const source = await readFile(new URL('./backfill-proof-indexer.mjs', import.meta.url), 'utf8');
test('reported confirmed tip recovers exactly one WORK without changing canonical fields', async () => {
  const original = structuredClone(evidence);
  const plan = await planBoostWorkTipRepair(evidence, core, source, evidenceJson);
  assert.deepEqual(evidence, original);
  assert.equal(plan.after.tipWorkTransfer.amountSubatoms, '10000000000000000');
  assert.equal(plan.after.recipientAddress, '1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH');
  const sql = repairSql(plan);
  assert.equal((sql.match(/UPDATE proof_indexer\./g) || []).length, 1);
  assert.match(sql, /UPDATE proof_indexer.events SET payload=/);
  assert.match(sql, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(sql, /changed <> 1/);
  assert.ok(sql.includes(evidenceJson.replaceAll("'", "''")), 'SQL preserves exact PostgreSQL numeric JSON');
  assert.ok(sql.includes("expected->'transition'"));
  assert.notEqual(evidenceJson.match(/\"opening_network_value_q8\": (\d+)/)?.[1], String(evidence.transition.opening_network_value_q8));
  for (const table of ['events', 'transactions', 'work_amo_block_transitions', 'blocks']) {
    assert.ok(sql.includes(`Repair evidence changed: ${table}`));
  }
});
for (const [name, mutate] of [
  ['changed historical owner', e => e.ownership[0].payload.authorAddress = 'different'],
  ['intervening ownership change', e => e.ownership.push({...e.ownership[0], kind: 'boost-transfer'})],
  ['unconfirmed transaction', e => e.transaction.status = 'pending'],
  ['wrong canonical block', e => e.block.canonical = false],
  ['different transaction bytes', e => e.transaction.raw_tx.hex += '00'],
  ['different token amount', e => e.events[1].payload.amountSubatoms = '1'],
  ['tampered replay outcome', e => e.transition.payload.replayRecords.find(r => r.txid === core.txid).outcome.valid = false],
  ['duplicate replay', e => e.transition.payload.replayRecords.push(e.transition.payload.replayRecords.find(r => r.txid === core.txid))],
  ['already repaired row', e => e.events[0].payload.tipWorkTransfer = {}],
]) test(`rejects ${name}`, async () => {
  const changed = structuredClone(evidence); mutate(changed);
  await assert.rejects(planBoostWorkTipRepair(changed, core, source, JSON.stringify(changed)));
});
