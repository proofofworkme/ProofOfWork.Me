BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SET LOCAL work_mem='16MB';
WITH migration AS MATERIALIZED (
 SELECT * FROM proof_indexer.meta WHERE key='workAmoV5Migration:livenet'
), seed AS MATERIALIZED (
 SELECT * FROM proof_indexer.ledger_snapshots WHERE network='livenet'
 AND payload->>'model'='canonical-work-amo-v5-h-minus-one-seed-evidence-v1'
), refs AS (
 SELECT payload->>'issuanceValueSnapshotId' id,'issuance' origin FROM proof_indexer.events
 WHERE network='livenet' AND COALESCE(payload->>'issuanceValueSnapshotId','')<>''
 UNION
 SELECT entry->'snapshot'->>'snapshotId','witness' FROM proof_indexer.meta rebuild
 JOIN proof_indexer.meta witness ON witness.key=rebuild.value->'verifierBinding'->>'witnessSetMetaKey'
 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(witness.value->'entries','[]'::jsonb)) entry
 WHERE rebuild.key='canonical:rebuild' AND entry->>'disposition'='preserve'
 UNION SELECT snapshot_id,'seed-evidence' FROM seed
 UNION SELECT payload->'canonicalSummary'->>'snapshotId','seed-summary-provenance' FROM seed
 UNION SELECT jsonb_array_elements_text(COALESCE(value->'replayEvidence'->'seed'->'snapshotIds','[]'::jsonb)),'migration-seed-provenance' FROM migration
 UNION SELECT jsonb_array_elements_text(COALESCE(value->'replayEvidence'->'closing'->'snapshotIds','[]'::jsonb)),'migration-closing-provenance' FROM migration
), grouped AS (
 SELECT id,array_agg(DISTINCT origin ORDER BY origin) origins FROM refs
 WHERE COALESCE(id,'')<>'' GROUP BY id
), referenced AS (
 SELECT r.id,r.origins,s.snapshot_id IS NOT NULL resolved,
 CASE WHEN s.snapshot_id IS NULL THEN NULL ELSE encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') END row_sha256
 FROM grouped r LEFT JOIN proof_indexer.ledger_snapshots s ON s.network='livenet' AND s.snapshot_id=r.id
), transitions AS MATERIALIZED (
 SELECT t.*,b.canonical block_canonical,b.previous_block_hash canonical_previous_hash
 FROM proof_indexer.work_amo_block_transitions t
 JOIN proof_indexer.blocks b ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash
 WHERE t.network='livenet' AND t.block_height IN (959621,959804)
)
SELECT jsonb_build_object(
 'format','audit5-historical-summary-authority-v1','database',current_database(),'capturedAt',clock_timestamp(),
 'references',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM referenced r),
 'seedRows',(SELECT jsonb_agg(to_jsonb(s) ORDER BY snapshot_id) FROM seed s),
 'migration',(SELECT jsonb_build_object('rowSha256',encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex'),
   'value',(m.value-'replayEvidence') || jsonb_build_object('replayEvidence',
     ((m.value->'replayEvidence')-'transitionReplay') || jsonb_build_object('transitionReplay',
       (m.value->'replayEvidence'->'transitionReplay')-ARRAY['firstOpeningState','finalTipState']))) FROM migration m),
 'transitions',(SELECT jsonb_agg(jsonb_build_object(
   'rowSha256',encode(sha256(convert_to((to_jsonb(t)-ARRAY['block_canonical','canonical_previous_hash'])::text,'UTF8')),'hex'),
   'network',t.network,'blockHeight',t.block_height,'blockHash',t.block_hash,'previousBlockHash',t.previous_block_hash,
   'blockCanonical',t.block_canonical,'canonicalPreviousHash',t.canonical_previous_hash,
   'model',t.model,'stateCommitmentModel',t.state_commitment_model,
   'openingNetworkValueQ8',t.opening_network_value_q8::text,'closingNetworkValueQ8',t.closing_network_value_q8::text,
   'openingStateSha256',t.opening_state_sha256,'closingStateSha256',t.closing_state_sha256,
   'openingStatePayloadBytes',t.opening_state_payload_bytes,'closingStatePayloadBytes',t.closing_state_payload_bytes,
   'complete',t.complete,'blockAtomic',t.block_atomic,'feeOnce',t.fee_once,'invalidZero',t.invalid_zero,
   'payload',jsonb_build_object('blockDescriptorCommitment',t.payload->'blockDescriptorCommitment',
      'transitionChainCommitment',t.payload->'transitionChainCommitment','bip141Witness',t.payload->'bip141Witness',
      'blockTransactionCount',t.payload->'blockTransactionCount','transitionChainModel',t.payload->'transitionChainModel')) ORDER BY t.block_height) FROM transitions t),
 'blocks',(SELECT jsonb_agg(jsonb_build_object('height',height,'hash',block_hash,'previousHash',previous_block_hash,'canonical',canonical) ORDER BY height,block_hash)
   FROM proof_indexer.blocks WHERE network='livenet' AND height IN(959620,959621,959804) AND canonical=true)
);
COMMIT;
