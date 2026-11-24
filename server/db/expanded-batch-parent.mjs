import { isDeepStrictEqual as equal } from "node:util";
import { normalizeExpandedLiquidityPins } from "../work-amo-expanded-liquidity.mjs";
import { expandedLiquiditySupersessionCte } from "./permission-supersession.mjs";

const declaration = normalizeExpandedLiquidityPins({
  txid: "57eb549372f2318bfc3ade62c62e9e1092cd42702e9ffb5e2733659acc241f33",
  blockHeight: 977229, blockHash: "0000000000000000000113f979011a14bdcecdb509671b763fc60a02ebaccbc9",
  blockTransactionIndex: 591, protocolVout: 1, recordOrdinal: 0, registryPaymentVout: null,
  firstEligibleBlockOffset: 1, firstEligibleTransactionIndex: 0,
});
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const requireProof = ok => { if (!ok) throw new Error("Canonical WORK batch expanded replay provenance differs."); };

export const expandedBatchIdentityColumns = `transition.payload->'expandedLiquidity' AS expanded_declaration,
  transition.payload->'__powNativeStorage' AS selected_storage,
  requested.block_height AS selected_height, block.block_hash AS selected_hash,
  jsonb_build_object('id',parent.event_id::text,'txid',requested.txid,'index',requested.block_index,
    'vout',requested.op_return_vout) AS selected_family`;

// The ordinary lookup may identify several families in a block. Read both native frames only once for
// that block and re-read the requested relational families in this same canonical statement.
export const expandedBatchFamiliesSql = `/* expanded_batch_accepted_families */
${expandedLiquiditySupersessionCte},
current_block AS MATERIALIZED (
  SELECT t.payload, proof_indexer.read_work_transition_payload_v1(t.network,t.block_height,t.block_hash,t.payload) AS selected,
    EXISTS (SELECT 1 FROM proof_indexer.work_amo_expanded_liquidity_supersessions_v1 s
      WHERE s.network=t.network AND s.block_height=t.block_height AND s.block_hash=t.block_hash) AS resealed
  FROM proof_indexer.work_amo_block_transitions t
  JOIN proof_indexer.blocks b ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash
    AND b.previous_block_hash=t.previous_block_hash AND b.canonical
  WHERE t.network=$1 AND t.block_height=$2 AND t.block_hash=$3 AND t.complete AND t.block_atomic AND t.fee_once AND t.invalid_zero
    AND t.payload#>>'{__powNativeStorage,model}'='proof-indexer-native-transition-chunks-v1'
    AND t.payload#>>'{__powNativeStorage,sha256}'=$4 AND t.payload->'expandedLiquidity'=$5::jsonb
), bound AS MATERIALIZED (
  SELECT c.selected, a.original, c.resealed
  FROM current_block c LEFT JOIN authenticated a ON a.verified
    AND a.new_manifest->>'sha256'=$4 AND a.selected_main->'payload'=c.payload AND a.replacement=c.selected
    AND a.incident_txid=$5::jsonb->>'txid'
    AND a.source_commit ~ '^[0-9a-f]{40}$' AND a.source_tree ~ '^[0-9a-f]{40}$'
    AND a.qualification_sha256 ~ '^[0-9a-f]{64}$' AND a.manifest_sha256 ~ '^[0-9a-f]{64}$'
    AND a.through_height >= $2 AND EXISTS (
      SELECT 1 FROM proof_indexer.work_amo_expanded_liquidity_supersessions_v1 anchor
      JOIN proof_indexer.blocks boundary ON boundary.network=anchor.network AND boundary.height=anchor.block_height
        AND boundary.block_hash=anchor.block_hash AND boundary.previous_block_hash=$5::jsonb->>'blockHash' AND boundary.canonical
      JOIN proof_indexer.work_amo_expanded_liquidity_supersessions_v1 terminal ON terminal.network=a.network
        AND terminal.block_height=a.through_height AND terminal.block_hash=a.through_hash
      WHERE anchor.network=a.network AND anchor.block_height=977230
        AND (anchor.incident_txid,anchor.source_commit,anchor.source_tree,anchor.manifest_sha256,anchor.qualification_sha256,
             anchor.through_height,anchor.through_hash) =
            (a.incident_txid,a.source_commit,a.source_tree,a.manifest_sha256,a.qualification_sha256,a.through_height,a.through_hash)
        AND (terminal.incident_txid,terminal.source_commit,terminal.source_tree,terminal.manifest_sha256,terminal.qualification_sha256,
             terminal.through_height,terminal.through_hash) =
            (a.incident_txid,a.source_commit,a.source_tree,a.manifest_sha256,a.qualification_sha256,a.through_height,a.through_hash)
    )
  WHERE c.selected->'expandedLiquidity'=$5::jsonb AND encode(sha256(jsonb_send(c.selected)),'hex')=$4
    AND c.selected->>'network'=$1 AND c.selected->>'blockHash'=$3 AND (c.selected->>'blockHeight')::int=$2
    AND proof_indexer.work_transition_metadata_v1(c.selected)=c.payload-'__powNativeStorage'
    AND (NOT c.resealed OR a.original IS NOT NULL)
), families AS (
  SELECT q.*, tx.raw_tx, p.payload FROM jsonb_to_recordset($6::jsonb) q(id text,txid text,index integer,vout integer)
  JOIN proof_indexer.events p ON p.event_id=q.id::bigint AND p.network=$1 AND p.txid=q.txid AND p.block_height=$2
    AND p.block_index=q.index AND p.op_return_vout=q.vout AND p.record_ordinal=0 AND p.status='confirmed' AND p.valid
    AND p.protocol='pwt1' AND p.kind='token-transfer-batch'
  JOIN proof_indexer.transactions tx ON tx.network=p.network AND tx.txid=p.txid AND tx.block_height=p.block_height
    AND tx.block_index=p.block_index AND tx.block_hash=$3 AND tx.status='confirmed'
)
SELECT f.id AS parent_event_id, f.payload AS parent_payload, f.raw_tx->'vout'->f.vout AS carrier_output,
  f.raw_tx || jsonb_build_object('txid',f.txid) AS transaction, b.selected->'workMailBatchV1' AS activation_context, b.resealed,
  (SELECT jsonb_agg(jsonb_build_object('event_id',e.event_id::text,'payload',e.payload,'position',jsonb_build_object(
     'blockHeight',e.block_height,'blockTransactionIndex',e.block_index,'protocolVout',e.op_return_vout,'recordOrdinal',e.record_ordinal))
    ORDER BY e.record_ordinal)
   FROM proof_indexer.events e WHERE e.network=$1 AND e.txid=f.txid AND e.block_height=$2 AND e.block_index=f.index
    AND e.op_return_vout=f.vout AND e.record_ordinal>0 AND e.status='confirmed' AND e.valid AND e.kind='token-transfer'
    AND e.protocol='pwt1') AS siblings,
  (SELECT jsonb_agg(r ORDER BY (r#>>'{position,protocolVout}')::int) FROM jsonb_array_elements(b.selected->'replayRecords') r
   WHERE r->>'txid'=f.txid AND r->'rawCandidate'='true'::jsonb AND r#>>'{position,recordOrdinal}'='0'
    AND r#>>'{position,blockHash}'=$3 AND (r#>>'{position,blockHeight}')::int=$2 AND (r#>>'{position,blockTransactionIndex}')::int=f.index
    AND (r->>'protocol'='pwm1' OR (r->>'protocol'='pwt1' AND (r#>>'{position,protocolVout}')::int=f.vout))) AS selected_records,
  (SELECT jsonb_agg(r ORDER BY (r#>>'{position,protocolVout}')::int) FROM jsonb_array_elements(b.original->'replayRecords') r
   WHERE r->>'txid'=f.txid AND r->'rawCandidate'='true'::jsonb AND r#>>'{position,recordOrdinal}'='0'
    AND r#>>'{position,blockHash}'=$3 AND (r#>>'{position,blockHeight}')::int=$2 AND (r#>>'{position,blockTransactionIndex}')::int=f.index
    AND (r->>'protocol'='pwm1' OR (r->>'protocol'='pwt1' AND (r#>>'{position,protocolVout}')::int=f.vout))) AS archived_records
FROM families f CROSS JOIN bound b`;

function parentBody(record) {
  const { transitionChainCommitmentAfter: chain, derived, ...body } = record;
  requireProof(chain?.model === "canonical-work-amo-raw-transition-chain-sha256-v1" && hash(chain.sha256) &&
    Number.isSafeInteger(chain.payloadBytes) && chain.payloadBytes > 0 && Object.keys(chain).length === 3 && Array.isArray(derived));
  return { ...body, derived: derived.map(child => {
    const { parentTransitionChainCommitmentAfter, ...descriptor } = child;
    requireProof(equal(parentTransitionChainCommitmentAfter, chain));
    return descriptor;
  }) };
}

function historicalFamily(row) {
  const selected = row.selected_records;
  requireProof(Array.isArray(selected) && selected.length > 0 && typeof row.resealed === "boolean");
  let accepted = selected;
  if (row.resealed) {
    accepted = row.archived_records;
    requireProof(Array.isArray(accepted) && accepted.length === selected.length);
    for (const [i, original] of accepted.entries()) {
      requireProof(equal(parentBody(original), parentBody(selected[i])) &&
        original.transitionChainCommitmentAfter.sha256 !== selected[i].transitionChainCommitmentAfter.sha256);
    }
  } else requireProof(row.archived_records === null);
  const parents = accepted.filter(r => r.protocol === "pwt1");
  requireProof(parents.length === 1 && Array.isArray(row.siblings));
  const parent = parents[0];
  if (Object.hasOwn(row.parent_payload, "transitionChainCommitmentAfter"))
    requireProof(equal(row.parent_payload.transitionChainCommitmentAfter, parent.transitionChainCommitmentAfter));
  for (const { payload } of row.siblings) {
    if (!Object.hasOwn(payload, "workAmoV5ReplayOutput")) continue;
    const descriptor = parent.derived?.[payload.batchRecipientIndex];
    requireProof(descriptor && equal(payload.workAmoV5ReplayOutput, { projection: {
      ...descriptor, derived: true, position: descriptor.projectionPosition, protocol: "pwt1",
      reasonCode: "", txid: parent.txid, valid: true,
    } }));
  }
  return { ...row, parent_records: parents, mail_records: accepted.filter(r => r.protocol === "pwm1") };
}

export async function expandedBatchFamilies(pool, network, rows) {
  const groups = new Map(), verified = new Map();
  for (const row of rows) {
    if (!row.selected_storage || row.expanded_declaration?.txid !== declaration.txid) continue;
    const h = row.selected_height, bh = row.selected_hash, storage = row.selected_storage, target = row.selected_family;
    requireProof(network === "livenet" && equal(row.expanded_declaration, declaration) && Number.isSafeInteger(h) && h >= 977230 &&
      hash(bh) && storage.model === "proof-indexer-native-transition-chunks-v1" && hash(storage.sha256) &&
      target?.id === String(row.parent_event_id) && hash(target.txid) && Number.isSafeInteger(target.index) && target.index >= 0 &&
      Number.isSafeInteger(target.vout) && target.vout >= 0);
    let group = groups.get(h);
    if (!group) groups.set(h, group = { h, bh, sha: storage.sha256, targets: [] });
    requireProof(group.bh === bh && group.sha === storage.sha256);
    group.targets.push(target);
  }
  if (!groups.size) return rows;
  for (const { h, bh, sha, targets } of groups.values()) {
    const found = await pool.query(expandedBatchFamiliesSql, [network, h, bh, sha, JSON.stringify(declaration), JSON.stringify(targets)]);
    const expected = new Map(targets.map(target => [target.id,target]));
    requireProof(found.rows.length === targets.length && expected.size === targets.length);
    for (const family of found.rows) {
      const target = expected.get(String(family.parent_event_id));
      requireProof(target && !verified.has(target.id) && family.parent_payload?.txid === target.txid);
      verified.set(target.id, historicalFamily(family));
    }
  }
  return rows.map(row => verified.get(String(row.parent_event_id)) ?? row);
}
