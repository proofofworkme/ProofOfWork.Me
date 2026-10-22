// Local, read-only planner for the explicitly reported historical tip. The SQL
// changes only application association fields after exact row/replay guards.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { Transaction, address } from 'bitcoinjs-lib';
import { parseBoostWorkTip, BOOST_TIP_WORK_TOKEN_ID } from '../src/shared/protocol/boostTip.mjs';
import { qualifyBoostPaidActions } from '../server/boost-projection.mjs';
import { workAmoV5EventSetCommitment } from '../server/work-amo-v5.mjs';
const TXID = '45986377795f670e33b7173e8d7a4d15d7842e1acfe4a623379af2013692585a';
const HASH = '0000000000000000000121ce41b04ea7a5aee55229f4dfa976a6b1a8da216d8e';
const TARGET = 'd424e548b339c95901581a6381ed1606ee3125707931bfd6c425bcdcb4682c32';
const OWNER = '1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH';
const REGISTRY = '1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV';
const sha = value => createHash('sha256').update(value).digest('hex');
export async function planBoostWorkTipRepair(evidence, core, source, evidenceJson) {
  // PostgreSQL numeric values can exceed JavaScript's exact integer range.
  // Keep original JSON for database guards; parsed objects are validation only.
  assert.equal(typeof evidenceJson, 'string');
  assert.deepEqual(JSON.parse(evidenceJson), evidence);
  const { events, transaction, transition, block, ownership } = evidence;
  assert.equal(ownership.length, 2);
  assert.deepEqual(ownership.map(e => e.kind), ['boost-post', 'mail']);
  for (const row of ownership) {
    assert.equal(row.txid, TARGET); assert.equal(row.status, 'confirmed');
    assert.equal(row.network, 'livenet'); assert.equal(row.valid, true);
    assert.ok(row.block_height < 972381);
  }
  assert.equal(ownership[0].payload.authorAddress, OWNER);
  assert.equal(events.length, 2);
  const tip = events.find(e => e.event_id === 5054119);
  const transfer = events.find(e => e.event_id === 5054120);
  assert.equal(tip.kind, 'boost-tip'); assert.equal(transfer.kind, 'token-transfer');
  for (const event of events) {
    assert.equal(event.txid, TXID); assert.equal(event.network, 'livenet');
    assert.equal(event.status, 'confirmed'); assert.equal(event.valid, true);
    assert.equal(event.block_height, 972381); assert.equal(event.block_index, 1266);
    assert.equal(event.record_ordinal, 0);
  }
  assert.equal(String(tip.amount_sats), '0'); assert.equal(String(transfer.amount_sats), '546');
  assert.equal(tip.payload.targetTxid, TARGET);
  assert.equal(tip.op_return_vout, 0); assert.equal(transfer.op_return_vout, 2);
  assert.equal(transaction.txid, TXID); assert.equal(transaction.status, 'confirmed');
  assert.equal(transaction.block_hash, HASH); assert.equal(transaction.block_height, 972381);
  assert.equal(transaction.block_index, 1266); assert.equal(block.canonical, true);
  assert.equal(block.block_hash, HASH); assert.equal(block.height, 972381);
  assert.equal(core.txid, TXID); assert.equal(core.blockHash, HASH);
  assert.equal(core.blockHeight, 972381); assert.equal(core.blockIndex, 1266);
  assert.equal(core.previousBlockHash, block.previous_block_hash);
  if (transaction.raw_hex !== null) assert.equal(core.hex, transaction.raw_hex);
  assert.equal(core.hex, transaction.raw_tx.hex);
  const tx = Transaction.fromHex(core.hex); assert.equal(tx.getId(), TXID);
  assert.equal(address.fromOutputScript(tx.outs[1].script), REGISTRY);
  assert.equal(tx.outs[1].value, 546n); assert.equal(tx.outs.length, 3);
  const p = transition.payload;
  assert.equal(transition.block_hash, HASH); assert.equal(transition.block_height, 972381);
  assert.equal(p.blockHash, HASH); assert.equal(p.blockHeight, 972381);
  assert.equal(p.previousBlockHash, block.previous_block_hash);
  for (const key of ['complete', 'block_atomic', 'fee_once', 'invalid_zero']) assert.equal(transition[key], true);
  for (const key of ['complete', 'blockAtomic', 'feeOnce', 'invalidZero']) assert.equal(p[key], true);
  const eventSet = workAmoV5EventSetCommitment(p.replayRecords.map(r => ({
    feeSats: r.transactionMinerFeeSats, kind: r.outcome.kind, outcome: r.outcome,
    payload: r.rawWitness, position: r.position, protocol: r.protocol,
    reasonCode: r.outcome.reasonCode, stateDelta: r.stateDelta, txid: r.txid, valid: r.outcome.valid,
  })));
  assert.deepEqual(eventSet, p.eventSetCommitment);
  assert.equal(eventSet.sha256, transition.event_set_sha256);
  assert.equal(eventSet.payloadBytes, transition.event_set_payload_bytes);
  const records = p.replayRecords.filter(r => r.txid === TXID);
  assert.equal(records.length, 2);
  for (const record of records) {
    const row = record.protocol === 'pwb1' ? tip : transfer;
    assert.equal(record.position.protocolVout, row.op_return_vout);
    assert.equal(record.position.blockTransactionIndex, row.block_index);
    assert.equal(record.position.blockHash, HASH);
    assert.equal(record.outcome.valid, true);
    assert.equal(record.rawWitness.rawRecordParts.length, 1);
    const part = record.rawWitness.rawRecordParts[0];
    assert.equal(part.text, row.raw_payload);
    assert.equal(part.scriptPubKeyHex, Buffer.from(tx.outs[row.op_return_vout].script).toString('hex'));
  }
  assert.equal(transfer.payload.recipientAddress, OWNER);
  assert.equal(transfer.payload.amountSubatoms, '10000000000000000');
  assert.equal(tip.payload.tipWorkTransfer, undefined);
  assert.equal(tip.payload.workSignalVerification, undefined);
  const marker = 'function preparedProtocolItemsWithCanonicalWorkTipReplay(';
  const start = source.indexOf(marker), end = source.indexOf('\nasync function preparedProtocolItemsForTx(', start);
  assert.ok(start >= 0 && end > start && source.indexOf(marker, start + 1) < 0);
  const context = vm.createContext({ parseBoostWorkTip, WORK_TOKEN_ID: BOOST_TIP_WORK_TOKEN_ID,
    WORK_TOKEN_REGISTRY_ADDRESS: REGISTRY, WORK_SUBATOM_PROJECTION_MODEL: 'work-subatoms-v2',
    WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL: 'canonical-work-amo-raw-transition-chain-sha256-v1',
    sameCanonicalPaymentAddress: (a,b) => Boolean(a && b && a === b) });
  vm.runInContext(`${source.slice(start,end)}\nthis.repair = preparedProtocolItemsWithCanonicalWorkTipReplay;`, context);
  const after = JSON.parse(JSON.stringify(context.repair([{ item: tip.payload }], p.replayRecords)[0].item));
  assert.equal(after.tipWorkTransfer?.amountSubatoms, '10000000000000000');
  const qualified = qualifyBoostPaidActions([{ ...after, eventId: tip.event_id }], [], new Map([[String(tip.event_id), OWNER]]));
  assert.equal(qualified.rejected.length, 0);
  assert.equal(qualified.accepted[0].applicationBoostOwnerWorkSubatoms, '10000000000000000');
  const mutable = ['recipientAddress', 'workSignalVerification', 'tipWorkTransfer', 'tipWorkVerificationReason'];
  const rest = value => Object.fromEntries(Object.entries(value).filter(([key]) => !mutable.includes(key)));
  assert.deepEqual(rest(after), rest(tip.payload));
  return { format: 'boost-work-tip-association-repair-v1', txid: TXID, eventId: tip.event_id,
    blockHash: HASH, blockHeight: 972381, sourceSha256: sha(source),
    evidenceSha256: sha(evidenceJson), evidenceJson, before: tip.payload, after, evidence };
}
export function repairSql(plan) {
  assert.equal(plan.format, 'boost-work-tip-association-repair-v1'); assert.equal(plan.txid, TXID);
  const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const { events, transaction, transition, block } = plan.evidence;
  assert.equal(sha(plan.evidenceJson), plan.evidenceSha256);
  const guards = [
    ...events.map((row, i) => ['events', `event_id=${row.event_id}`, `expected->'events'->${i}`]),
    ...plan.evidence.ownership.map((row, i) => ['events', `event_id=${row.event_id}`, `expected->'ownership'->${i}`]),
  ];
  guards.push(['transactions', `network='livenet' AND txid='${TXID}'`, `expected->'transaction'`],
    ['work_amo_block_transitions', `network='livenet' AND block_height=972381 AND block_hash='${HASH}'`, `expected->'transition'`],
    ['blocks', `network='livenet' AND height=972381 AND block_hash='${HASH}'`, `expected->'block'`]);
  const guardSql = guards.map(([table, where, row]) => `SELECT to_jsonb(t) INTO actual FROM proof_indexer.${table} t WHERE ${where} FOR UPDATE;\nIF actual IS DISTINCT FROM (${row}) THEN RAISE EXCEPTION 'Repair evidence changed: ${table}'; END IF;`).join('\n');
  return `BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $repair$
DECLARE actual jsonb; changed integer; expected jsonb := '${plan.evidenceJson.replaceAll("'", "''")}'::jsonb;
BEGIN
${guardSql}
IF EXISTS (SELECT 1 FROM proof_indexer.events WHERE network='livenet' AND status='confirmed' AND valid=true AND kind IN ('boost-transfer','boost-buy') AND (block_height,block_index)<=(972381,1266)) THEN RAISE EXCEPTION 'Historical ownership evidence changed'; END IF;
UPDATE proof_indexer.events SET payload=${literal(plan.after)}, updated_at=clock_timestamp()
WHERE event_id=5054119 AND network='livenet' AND txid='${TXID}' AND payload=${literal(plan.before)};
GET DIAGNOSTICS changed = ROW_COUNT;
IF changed <> 1 THEN RAISE EXCEPTION 'Repair must update exactly one tip'; END IF;
SELECT to_jsonb(t)-'payload'-'updated_at' INTO actual FROM proof_indexer.events t WHERE event_id=5054119;
IF actual IS DISTINCT FROM ((expected->'events'->${events.findIndex(e=>e.event_id===5054119)})-'payload'-'updated_at') THEN RAISE EXCEPTION 'Repair changed canonical event fields'; END IF;
END $repair$;
COMMIT;
`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [evidencePath, corePath, output] = process.argv.slice(2); assert.ok(evidencePath && corePath && output);
  const source = await readFile(new URL('./backfill-proof-indexer.mjs', import.meta.url), 'utf8');
  const evidenceJson = await readFile(evidencePath, 'utf8');
  const plan = await planBoostWorkTipRepair(JSON.parse(evidenceJson), JSON.parse(await readFile(corePath)), source, evidenceJson);
  await writeFile(`${output}.json`, JSON.stringify(plan, null, 2)+'\n', { flag:'wx', mode:0o600 });
  await writeFile(`${output}.sql`, repairSql(plan), { flag:'wx', mode:0o600 });
  console.log(JSON.stringify({eventId:plan.eventId, txid:plan.txid, amount:plan.after.tipWorkTransfer.amountSubatoms, output, sourceSha256:plan.sourceSha256}));
}
