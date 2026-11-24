import { isDeepStrictEqual } from 'node:util';
import { permissionReadError } from '../permissions.mjs';

const hash = value => /^[a-f0-9]{64}$/u.test(value ?? '');
function authorityFields(row) {
  return [Number(row.height ?? row.block_height), row.block_hash, row.previous_block_hash, row.model,
    row.complete, row.block_atomic, row.fee_once, row.invalid_zero, Number(row.protocol_record_count),
    Number(row.raw_protocol_candidate_count), row.payload?.blockDescriptorCommitment];
}
function fields(row) {
  return [...authorityFields(row), row.storage_commitment ?? row.payload?.__powNativeStorage ?? null,
    row.payload?.replayDescriptorCommitment];
}

// The native encoder checks the qualified replay against its pinned native frames. Permission additionally
// proves that all fields which can affect a carrier, outcome, fee, or position
// survived the change. Compare corresponding array entries on the server so
// neither complete native frame has to be copied into the API process.
const expandedAuthority = `NOT EXISTS (
  WITH records(o,n) AS (
    SELECT * FROM ROWS FROM (jsonb_array_elements(d.original->'replayRecords'),
                             jsonb_array_elements(d.replacement->'replayRecords'))
  ), raw AS MATERIALIZED (
    SELECT * FROM records WHERE o->'rawCandidate'='true'::jsonb AND n->'rawCandidate'='true'::jsonb
  ), traces(o,n) AS (
    SELECT * FROM ROWS FROM (jsonb_array_elements(d.original->'traces'),
                             jsonb_array_elements(d.replacement->'traces'))
  ), projection_fields(field,witness) AS (
    VALUES ('transferBatches','transitionChainCommitmentAfter'), ('transfers','parentTransitionChainCommitmentAfter')
  ), pieces(old_body,new_body,old_chain,new_chain) AS (
    SELECT jsonb_build_array(o-ARRAY['transitionChainCommitmentAfter','derived'], jsonb_array_length(o->'derived')),
           jsonb_build_array(n-ARRAY['transitionChainCommitmentAfter','derived'], jsonb_array_length(n->'derived')),
           o->'transitionChainCommitmentAfter', n->'transitionChainCommitmentAfter'
    FROM raw
    UNION ALL
    SELECT CASE WHEN child.o->'parentTransitionChainCommitmentAfter'=parent.o->'transitionChainCommitmentAfter'
                THEN child.o-'parentTransitionChainCommitmentAfter' END,
           CASE WHEN child.n->'parentTransitionChainCommitmentAfter'=parent.n->'transitionChainCommitmentAfter'
                THEN child.n-'parentTransitionChainCommitmentAfter' END,
           child.o->'parentTransitionChainCommitmentAfter', child.n->'parentTransitionChainCommitmentAfter'
    FROM raw parent CROSS JOIN LATERAL ROWS FROM (
      jsonb_array_elements(parent.o->'derived'), jsonb_array_elements(parent.n->'derived')
    ) AS child(o,n)
    UNION ALL
    SELECT (o-'parentTransitionChainCommitmentAfter') #- '{output,projection,parentTransitionChainCommitmentAfter}'
             #- '{rawWitness,descriptor,parentTransitionChainCommitmentAfter}',
           (n-'parentTransitionChainCommitmentAfter') #- '{output,projection,parentTransitionChainCommitmentAfter}'
             #- '{rawWitness,descriptor,parentTransitionChainCommitmentAfter}',
           o->'parentTransitionChainCommitmentAfter', n->'parentTransitionChainCommitmentAfter'
    FROM records WHERE o->'rawCandidate'='false'::jsonb
    UNION ALL
    SELECT o-'transitionChainCommitmentAfter', n-'transitionChainCommitmentAfter',
           o->'transitionChainCommitmentAfter', n->'transitionChainCommitmentAfter' FROM traces
    UNION ALL
    SELECT work.o-f.witness, work.n-f.witness, work.o->f.witness, work.n->f.witness
    FROM projection_fields f CROSS JOIN LATERAL ROWS FROM (
      jsonb_array_elements(d.original->'closingWorkProjection'->f.field),
      jsonb_array_elements(d.replacement->'closingWorkProjection'->f.field)
    ) AS work(o,n)
    WHERE d.replacement_fields ? 'closingWorkProjection' AND work.o IS DISTINCT FROM work.n
  )
  SELECT 1 FROM pieces WHERE (
    old_body=new_body AND old_chain-ARRAY['sha256','payloadBytes']=new_chain-ARRAY['sha256','payloadBytes']
    AND old_chain->>'model'='canonical-work-amo-raw-transition-chain-sha256-v1'
    AND jsonb_typeof(old_chain->'payloadBytes')='number' AND old_chain->>'payloadBytes' ~ '^[1-9][0-9]*$'
    AND jsonb_typeof(new_chain->'payloadBytes')='number' AND new_chain->>'payloadBytes' ~ '^[1-9][0-9]*$'
    AND old_chain->>'sha256' ~ '^[0-9a-f]{64}$' AND new_chain->>'sha256' ~ '^[0-9a-f]{64}$'
  ) IS NOT TRUE
  UNION ALL
  SELECT 1 FROM projection_fields f WHERE d.replacement_fields ? 'closingWorkProjection' AND (
    jsonb_typeof(d.original->'closingWorkProjection'->f.field) IS DISTINCT FROM
      jsonb_typeof(d.replacement->'closingWorkProjection'->f.field))
  UNION ALL
  SELECT 1 FROM records WHERE (o->'rawCandidate'=n->'rawCandidate' AND CASE o->'rawCandidate'
    WHEN 'true'::jsonb THEN jsonb_typeof(o->'derived')='array' AND jsonb_typeof(n->'derived')='array'
    WHEN 'false'::jsonb THEN o#>'{output,projection,parentTransitionChainCommitmentAfter}'=o->'parentTransitionChainCommitmentAfter'
      AND o#>'{rawWitness,descriptor,parentTransitionChainCommitmentAfter}'=o->'parentTransitionChainCommitmentAfter'
      AND n#>'{output,projection,parentTransitionChainCommitmentAfter}'=n->'parentTransitionChainCommitmentAfter'
      AND n#>'{rawWitness,descriptor,parentTransitionChainCommitmentAfter}'=n->'parentTransitionChainCommitmentAfter'
    ELSE false END) IS NOT TRUE
)`;

function supersessionCte(expanded) {
  const relation = expanded ? 'proof_indexer.work_amo_expanded_liquidity_supersessions_v1'
    : 'proof_indexer.work_batch_transition_supersessions_v1';
  const scalars = expanded
    ? `to_jsonb(t)-ARRAY['payload','created_at','event_set_sha256'] =
         d.old_main-ARRAY['payload','created_at','event_set_sha256']
       AND t.created_at=(d.old_main->>'created_at')::timestamptz
       AND d.old_main->>'event_set_sha256'=d.original#>>'{eventSetCommitment,sha256}'
       AND (d.original->'eventSetCommitment')-'sha256'=(d.replacement->'eventSetCommitment')-'sha256'
       AND (t.event_count>t.protocol_record_count OR t.event_set_sha256=d.old_main->>'event_set_sha256')
       AND d.incident_txid='57eb549372f2318bfc3ade62c62e9e1092cd42702e9ffb5e2733659acc241f33'
       AND d.replacement_fields-ARRAY['expandedLiquidity','transitionChainCommitment','replayRecords','traces',
         'replayDescriptorCommitment','eventSetCommitment','closingWorkProjection']='{}'::jsonb
       AND d.original->'blockDescriptorCommitment'=d.replacement->'blockDescriptorCommitment'
       AND d.original->'rawProtocolCandidateCount'=d.replacement->'rawProtocolCandidateCount'
       AND (NOT (d.replacement_fields ? 'closingWorkProjection') OR
         (d.original->'closingWorkProjection')-ARRAY['transferBatches','transfers'] =
         (d.replacement->'closingWorkProjection')-ARRAY['transferBatches','transfers'])
       AND (d.original->'replayDescriptorCommitment')-ARRAY['sha256','payloadBytes'] =
           (d.replacement->'replayDescriptorCommitment')-ARRAY['sha256','payloadBytes']
       AND jsonb_array_length(d.original->'replayRecords')=t.event_count
       AND jsonb_array_length(d.replacement->'replayRecords')=t.event_count
       AND jsonb_array_length(d.original->'traces')=t.protocol_record_count+t.transaction_count
       AND jsonb_array_length(d.replacement->'traces')=t.protocol_record_count+t.transaction_count
       AND ${expandedAuthority}`
    : `to_jsonb(t)-ARRAY['payload','created_at']=d.new_metadata
       AND t.created_at=(d.old_main->>'created_at')::timestamptz
       AND d.new_metadata-'event_set_sha256'=d.old_main-ARRAY['payload','created_at','event_set_sha256']`;
  return `WITH frames AS MATERIALIZED (
      SELECT s.*, a.payload AS original_manifest,
        proof_indexer.reconstruct_work_transition_payload_v1(a.payload) AS original,
        proof_indexer.reconstruct_work_transition_payload_v1(s.new_manifest) AS replacement
      FROM ${relation} s
      JOIN proof_indexer.work_transition_archive_v1 a USING (network,block_height,block_hash)
      WHERE s.network=$1 AND s.block_height=$2 AND s.block_hash=$3
    ), authenticated AS (
    SELECT d.*, to_jsonb(t) AS selected_main,
      (d.original_manifest->>'sha256'=d.old_archive_sha256 AND
       d.old_main#>>'{payload,__powNativeStorage,sha256}'=d.old_archive_sha256 AND
       encode(sha256(jsonb_send(d.original)),'hex')=d.old_archive_sha256 AND
       proof_indexer.work_transition_metadata_v1(d.original)=(d.old_main->'payload')-'__powNativeStorage' AND
       encode(sha256(jsonb_send(d.replacement)),'hex')=d.new_manifest->>'sha256' AND
       d.replacement=d.original||d.replacement_fields AND
       t.payload->'__powNativeStorage'->>'sha256'=d.new_manifest->>'sha256' AND
       proof_indexer.work_transition_metadata_v1(d.replacement)=t.payload-'__powNativeStorage' AND
       proof_indexer.read_work_transition_payload_v1(t.network,t.block_height,t.block_hash,t.payload)=d.replacement AND
       (${scalars}) AND
       t.event_set_sha256=d.replacement->'eventSetCommitment'->>'sha256') IS TRUE AS verified
    FROM frames d JOIN proof_indexer.work_amo_block_transitions t USING (network,block_height,block_hash)
    JOIN proof_indexer.blocks origin ON origin.network=d.network AND origin.canonical
      AND origin.height=d.block_height AND origin.block_hash=d.block_hash
    JOIN proof_indexer.blocks boundary ON boundary.network=d.network AND boundary.canonical
      AND boundary.height=d.through_height AND boundary.block_hash=d.through_hash
    )`;
}

// $1 network, $2 block height, $3 block hash. Downstream readers select the
// exact parent position from these two frames in the same canonical snapshot.
export const expandedLiquiditySupersessionCte = supersessionCte(true);
const workBatchSupersessionCte = supersessionCte(false);

// Verify both immutable native frames against the old signed receipt and the selected transition.
// The index reader supplies the same repeatable-read transaction that provided the canonical block.
export async function permissionSupersession(client, network, old, row) {
  if (!old || Number(old.height) !== Number(row.height) || old.block_hash !== row.block_hash) {
    throw permissionReadError('Permission journal supersession crosses a fork.');
  }
  if (isDeepStrictEqual(fields(old), fields(row))) return null;
  // The earlier WORK batch instrument ends at 973615. The two publication
  // tables are disjoint and each has its own immutable incident constraints.
  const expanded = Number(row.height) >= 977230;
  if (expanded && !isDeepStrictEqual(authorityFields(old), authorityFields(row))) {
    throw permissionReadError('Permission journal supersession changes canonical carrier authority.');
  }
  const result = await client.query(`/* permission_native_supersession */
    ${expanded ? expandedLiquiditySupersessionCte : workBatchSupersessionCte}
    SELECT old_main, selected_main, source_commit, source_tree, manifest_sha256, qualification_sha256,
      old_archive_sha256, new_manifest->>'sha256' AS replacement_sha256, through_height, through_hash, verified
    FROM authenticated`, [network, row.height, row.block_hash]);
  const proof = result.rows[0];
  if (result.rows.length !== 1 || proof.verified !== true || !isDeepStrictEqual(fields(old), fields(proof.old_main)) ||
      (expanded && (!proof.selected_main || !isDeepStrictEqual(fields(row), fields(proof.selected_main)) ||
        !Number.isSafeInteger(Number(proof.through_height)) || Number(proof.through_height) < Number(row.height))) ||
      !hash(proof.manifest_sha256) || !hash(proof.qualification_sha256) || !hash(proof.through_hash) ||
      !/^[a-f0-9]{40}$/u.test(proof.source_commit) || !/^[a-f0-9]{40}$/u.test(proof.source_tree) ||
      proof.old_archive_sha256 !== old.storage_commitment?.sha256 || proof.replacement_sha256 !== row.storage_commitment?.sha256) {
    throw permissionReadError('Permission native supersession provenance differs from the authenticated journal.');
  }
  const { old_main, selected_main, verified, ...provenance } = proof;
  return provenance;
}
